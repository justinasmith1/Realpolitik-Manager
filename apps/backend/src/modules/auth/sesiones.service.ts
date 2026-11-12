// Servicio persistente de sesiones (ADR-0006 §1). Lo usarán los endpoints `/auth/*` y el
// middleware de sesión (Backend 2C). No depende de Express: no lee cookies ni arma respuestas.
//
// Responsabilidades que NO están acá y se reutilizan:
// - token y su SHA-256: `tokenDeSesion.ts`;
// - reglas temporales (vigencia, inactividad, actividad): `vigenciaDeSesion.ts`;
// - verificar la contraseña antes de crear la sesión: `contrasenas.ts` + `limiteDeHash.ts`.
//
// Concurrencia (comprobada contra PostgreSQL en `sesiones.service.integration.test.ts`):
// - Crear una sesión bloquea la fila del usuario (`SELECT … FOR UPDATE`) en una transacción READ
//   COMMITTED. Las creaciones del mismo usuario quedan en fila: cada una ve las anteriores ya
//   confirmadas, así el límite de vigentes no se supera sin reintentos ni conflictos de
//   serialización. Una desactivación que actualice la fila del usuario (HU4.5) también espera.
// - Bajo ese bloqueo, la creación compara el hash de contraseña con el que se verificó. Un cambio de
//   contraseña bloquea la misma fila: si confirma mientras un login espera el bloqueo, el login
//   encuentra otro hash y no crea la sesión; si el login confirmó antes, el cambio revoca su sesión.
//   Ninguna sesión nacida de la contraseña vieja sobrevive al cambio.
// - Actividad y revocación son UNA escritura condicional cada una: PostgreSQL vuelve a evaluar el
//   WHERE sobre la fila ya actualizada por otra transacción, así una escritura tardía no pisa una
//   más reciente, una sesión revocada o vencida no revive y revocar dos veces escribe una sola.
// - Un pedido que ya validó su sesión termina aunque otro la revoque en el medio; los pedidos
//   siguientes la encuentran revocada.
//
// El token nunca se registra ni viaja en un error; el hash tampoco sale de este módulo.

import { Prisma, type RolUsuario } from '@prisma/client';

import { conLaBaseDeDatos } from '../../lib/baseDeDatosNoDisponible';
import { prisma } from '../../lib/prisma';

import {
  generarTokenDeSesion,
  hashDeTokenDeSesion,
  tieneFormatoDeTokenDeSesion,
} from './tokenDeSesion';
import {
  debeRegistrarActividad,
  evaluarSesion,
  fechasDeSesionNueva,
  RETENCION_DE_SESIONES_CERRADAS_MS,
  umbralesDeActividad,
} from './vigenciaDeSesion';

/**
 * Sesiones vigentes por usuario. **Propuesta técnica del ADR (10), sin aprobación funcional
 * registrada.** Al crear una más, se revoca la que lleva más tiempo sin actividad.
 */
export const LIMITE_DE_SESIONES_VIGENTES = 10;

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El usuario no existe o está desactivado: no se le crea una sesión. */
export class UsuarioNoHabilitadoError extends Error {
  constructor() {
    super('El usuario no está habilitado para iniciar sesión.');
    this.name = 'UsuarioNoHabilitadoError';
  }
}

/**
 * La contraseña cambió entre la verificación y la creación de la sesión: la que se verificó ya no es
 * la vigente. Para quien intenta entrar es lo mismo que una contraseña incorrecta.
 */
export class CredencialesDesactualizadasError extends Error {
  constructor() {
    super('La contraseña cambió después de verificarla.');
    this.name = 'CredencialesDesactualizadasError';
  }
}

/** Datos vigentes del usuario, leídos de la base en cada validación (nunca del cliente). */
export interface UsuarioDeSesion {
  id: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  debeCambiarPassword: boolean;
}

export interface SesionValidada {
  sesionId: string;
  expiraEn: Date;
  usuario: UsuarioDeSesion;
}

/** Por qué una sesión no vale. La capa HTTP lo traduce a 401 sin dar detalles. */
export type MotivoDeSesionInvalida =
  | 'TOKEN_MAL_FORMADO'
  | 'INEXISTENTE'
  | 'REVOCADA'
  | 'VENCIDA_POR_DURACION'
  | 'VENCIDA_POR_INACTIVIDAD'
  | 'USUARIO_INACTIVO';

export type ResultadoDeValidacion =
  { valida: true; sesion: SesionValidada } | { valida: false; motivo: MotivoDeSesionInvalida };

/** Lo único que devuelve la creación: el token va a la cookie y no se vuelve a ver. */
export interface SesionCreada {
  token: string;
  sesionId: string;
  expiraEn: Date;
}

type ClienteDeBase = Prisma.TransactionClient | typeof prisma;

/**
 * Revoca las sesiones que cumplen `condicion` y no estaban revocadas. `revocadaEn` es `ahora`, pero
 * nunca anterior al inicio de la sesión (`GREATEST`): así se cumple `ck_sesion_fechas_coherentes`
 * aunque el reloj retroceda. Las fechas se guardan en UTC, como las escribe Prisma.
 */
function revocar(db: ClienteDeBase, condicion: Prisma.Sql, ahora: Date): Promise<number> {
  return db.$executeRaw`
    UPDATE "Sesion"
    SET "revocadaEn" = GREATEST((${ahora.toISOString()}::timestamptz AT TIME ZONE 'UTC'), "createdAt")
    WHERE "revocadaEn" IS NULL AND ${condicion}`;
}

/**
 * Crea una sesión para un usuario cuya identidad ya se verificó contra `passwordHashVerificado` (el
 * hash leído de la base antes de verificar la contraseña). Todo en una transacción con la fila del
 * usuario bloqueada:
 * 1. el usuario tiene que existir y estar activo (si no, `UsuarioNoHabilitadoError`);
 * 2. su hash tiene que seguir siendo el verificado (si no, `CredencialesDesactualizadasError`);
 * 3. borra sus sesiones revocadas o vencidas hace más de `RETENCION_DE_SESIONES_CERRADAS_MS`;
 * 4. revoca la sesión de `reemplazaA` (el token que traía el navegador), si la hay: el reemplazo es
 *    atómico, o quedan la nueva y no la vieja, o queda la vieja y no la nueva;
 * 5. si ya tiene `LIMITE_DE_SESIONES_VIGENTES` vigentes, revoca las de actividad más vieja;
 * 6. guarda la sesión nueva (solo el hash del token) y el último acceso del usuario.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde: no se crea ni se revoca nada.
 */
export async function crearSesion(
  usuarioId: string,
  passwordHashVerificado: string,
  ahora: Date = new Date(),
  { reemplazaA }: { reemplazaA?: unknown } = {},
): Promise<SesionCreada> {
  if (!FORMATO_UUID.test(usuarioId)) throw new UsuarioNoHabilitadoError();

  return conLaBaseDeDatos(() =>
    prisma.$transaction(async (tx) => {
      const [usuario] = await tx.$queryRaw<{ activo: boolean; passwordHash: string }[]>`
        SELECT "activo", "passwordHash" FROM "Usuario" WHERE "id" = ${usuarioId}::uuid FOR UPDATE`;
      if (!usuario?.activo) throw new UsuarioNoHabilitadoError();
      if (usuario.passwordHash !== passwordHashVerificado) {
        throw new CredencialesDesactualizadasError();
      }

      const cerradasAntesDe = new Date(ahora.getTime() - RETENCION_DE_SESIONES_CERRADAS_MS);
      await tx.sesion.deleteMany({
        where: {
          usuarioId,
          OR: [{ revocadaEn: { lt: cerradasAntesDe } }, { expiraEn: { lt: cerradasAntesDe } }],
        },
      });

      if (tieneFormatoDeTokenDeSesion(reemplazaA)) {
        const hashAnterior = hashDeTokenDeSesion(reemplazaA);
        await revocar(tx, Prisma.sql`"tokenHash" = ${hashAnterior}`, ahora);
      }

      const abiertas = await tx.sesion.findMany({
        where: { usuarioId, revocadaEn: null, expiraEn: { gt: ahora } },
        select: {
          id: true,
          createdAt: true,
          ultimaActividadEn: true,
          expiraEn: true,
          revocadaEn: true,
        },
        orderBy: [{ ultimaActividadEn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      });
      const vigentes = abiertas.filter((sesion) => evaluarSesion(sesion, ahora) === 'VIGENTE');
      const sobrantes = vigentes.slice(
        0,
        Math.max(0, vigentes.length - LIMITE_DE_SESIONES_VIGENTES + 1),
      );
      if (sobrantes.length > 0) {
        const ids = sobrantes.map((sesion) => sesion.id);
        await revocar(tx, Prisma.sql`"id" = ANY(${ids}::uuid[])`, ahora);
      }

      const { token, tokenHash } = generarTokenDeSesion();
      const sesion = await tx.sesion.create({
        data: { usuarioId, tokenHash, ...fechasDeSesionNueva(ahora) },
        select: { id: true, expiraEn: true },
      });
      await tx.usuario.update({ where: { id: usuarioId }, data: { ultimoAccesoEn: ahora } });

      return { token, sesionId: sesion.id, expiraEn: sesion.expiraEn };
    }),
  );
}

/**
 * Registra actividad con una sola escritura condicional: solo si la sesión sigue sin revocar, no
 * venció (ni por duración ni por inactividad) y pasó más de un minuto desde la última. Devuelve si
 * escribió. Normalmente la llama `validarSesion`.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde.
 */
export async function registrarActividad(
  sesionId: string,
  ahora: Date = new Date(),
): Promise<boolean> {
  if (!FORMATO_UUID.test(sesionId)) return false;
  const { registrarSiAnteriorA, vigenteDesde } = umbralesDeActividad(ahora);
  const { count } = await conLaBaseDeDatos(() =>
    prisma.sesion.updateMany({
      where: {
        id: sesionId,
        revocadaEn: null,
        expiraEn: { gt: ahora },
        ultimaActividadEn: { gt: vigenteDesde, lt: registrarSiAnteriorA },
      },
      data: { ultimaActividadEn: ahora },
    }),
  );
  return count === 1;
}

/**
 * Valida el token de una cookie: forma, existencia, revocación, vencimientos (`evaluarSesion`) y
 * usuario activo, con los datos del usuario leídos en la misma consulta. Si vale, registra
 * actividad cuando corresponde. No lanza por una sesión inválida: devuelve el motivo.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde: nunca se concede acceso.
 */
export async function validarSesion(
  token: unknown,
  ahora: Date = new Date(),
): Promise<ResultadoDeValidacion> {
  if (!tieneFormatoDeTokenDeSesion(token)) return { valida: false, motivo: 'TOKEN_MAL_FORMADO' };

  const sesion = await conLaBaseDeDatos(() =>
    prisma.sesion.findUnique({
      where: { tokenHash: hashDeTokenDeSesion(token) },
      select: {
        id: true,
        createdAt: true,
        ultimaActividadEn: true,
        expiraEn: true,
        revocadaEn: true,
        usuario: {
          select: {
            id: true,
            email: true,
            nombre: true,
            rol: true,
            activo: true,
            debeCambiarPassword: true,
          },
        },
      },
    }),
  );
  if (sesion === null) return { valida: false, motivo: 'INEXISTENTE' };

  const estado = evaluarSesion(sesion, ahora);
  if (estado !== 'VIGENTE') return { valida: false, motivo: estado };
  const { activo, ...usuario } = sesion.usuario;
  if (!activo) return { valida: false, motivo: 'USUARIO_INACTIVO' };

  if (debeRegistrarActividad(sesion, ahora)) await registrarActividad(sesion.id, ahora);
  return { valida: true, sesion: { sesionId: sesion.id, expiraEn: sesion.expiraEn, usuario } };
}

/**
 * Revoca la sesión de un token (el cierre de sesión). Idempotente y sin revelar nada: devuelve si
 * revocó una sesión vigente, pero la capa HTTP responde igual en todos los casos.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde.
 */
export async function revocarSesionPorToken(
  token: unknown,
  ahora: Date = new Date(),
): Promise<boolean> {
  if (!tieneFormatoDeTokenDeSesion(token)) return false;
  const hash = hashDeTokenDeSesion(token);
  const revocadas = await conLaBaseDeDatos(() =>
    revocar(prisma, Prisma.sql`"tokenHash" = ${hash}`, ahora),
  );
  return revocadas === 1;
}

/**
 * Revoca una sesión SOLO si pertenece a ese usuario: nunca la de otro. Quién puede pedirlo (la
 * persona sobre sus sesiones, un administrador sobre las de otro) lo decide la autorización HTTP.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde.
 */
export async function revocarSesionDeUsuario(
  usuarioId: string,
  sesionId: string,
  ahora: Date = new Date(),
): Promise<boolean> {
  if (!FORMATO_UUID.test(usuarioId) || !FORMATO_UUID.test(sesionId)) return false;
  const revocadas = await conLaBaseDeDatos(() =>
    revocar(
      prisma,
      Prisma.sql`"id" = ${sesionId}::uuid AND "usuarioId" = ${usuarioId}::uuid`,
      ahora,
    ),
  );
  return revocadas === 1;
}

/**
 * Revoca todas las sesiones vigentes de un usuario y devuelve cuántas. Con `tx`, corre dentro de
 * una transacción del llamador, para combinarla atómicamente con otro cambio: el cambio de
 * contraseña (`cambiarContrasena`), la desactivación o el cambio de rol (HU4.5). En ese caso el
 * llamador bloquea o actualiza primero la fila del usuario, para ordenarse con `crearSesion`.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde.
 */
export async function revocarSesionesDeUsuario(
  usuarioId: string,
  { ahora = new Date(), tx }: { ahora?: Date; tx?: Prisma.TransactionClient } = {},
): Promise<number> {
  if (!FORMATO_UUID.test(usuarioId)) return 0;
  return conLaBaseDeDatos(() =>
    revocar(tx ?? prisma, Prisma.sql`"usuarioId" = ${usuarioId}::uuid`, ahora),
  );
}
