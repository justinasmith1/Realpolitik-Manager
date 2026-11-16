// Administración de usuarios (HU4.5, ADR-0006 §5 "Autoprotección"): servicios de dominio, sin HTTP.
// Los usa la API administrativa (`usuarios.controller.ts`), detrás de
// `autorizar('usuarios:administrar')`. El actor (`actorId`) es siempre el usuario de la sesión
// autenticada: lo pasa el controlador, nunca sale del cuerpo del pedido.
//
// Operaciones: listar, crear, modificar nombre y rol, desactivar / reactivar y restablecer la
// contraseña. No hay borrado físico, ni edición de email, ni otra vía para tocar el hash, el
// cambio obligatorio, el último acceso, las fechas de auditoría o las sesiones.
//
// Se reutilizan, sin reimplementarlos: `hashearContrasena` + `limiteDeHash` (argon2id con el límite
// de cálculos del proceso), `evaluarContrasenaNueva` (vía `generarContrasenaTemporal`),
// `revocarSesionesDeUsuario` (dentro de la transacción de la operación) y `conLaBaseDeDatos`.
//
// ─── Concurrencia ────────────────────────────────────────────────────────────
//
// Invariante: SIEMPRE queda al menos un ADMINISTRADOR activo. Solo dos operaciones pueden reducir
// ese conjunto: desactivar y cambiar el rol. Ambas, en una transacción READ COMMITTED:
// 1. toman un bloqueo de aviso de transacción (`pg_advisory_xact_lock`) propio de "la composición
//    del conjunto de administradores": las operaciones que lo pueden reducir corren de a una;
// 2. bloquean la fila del usuario afectado (`SELECT … FOR UPDATE`, el mismo bloqueo que toma
//    `crearSesion` y el cambio de contraseña);
// 3. con los dos bloqueos, cuentan los OTROS administradores activos con una consulta nueva (en
//    READ COMMITTED ve todo lo confirmado hasta ese momento) y rechazan si no queda ninguno;
// 4. escriben la fila y revocan sus sesiones en la misma transacción.
// Como toda operación que reduce el conjunto espera el mismo bloqueo, la cuenta del paso 3 no
// puede quedar vieja antes del COMMIT: dos administradores que se desactivan (o se quitan el rol)
// mutuamente a la vez quedan en fila, y el segundo ve el cambio del primero y es rechazado. Lo que
// agrega administradores (crear, reactivar, ascender) no toma el bloqueo: a lo sumo hace que la
// cuenta sea más conservadora, nunca que se confirme un conjunto vacío.
//
// Por qué no SERIALIZABLE, como proponía el ADR: la fila del usuario la escriben también los
// inicios de sesión (`ultimoAccesoEn`) y los cambios de contraseña, en READ COMMITTED. Una
// transacción serializable que lee esa fila y después la actualiza aborta (40001) cada vez que un
// login confirma en el medio, y la garantía de SSI solo vale entre transacciones serializables. Con
// bloqueos explícitos el resultado es determinista, no hay abortos por falsos positivos de los
// predicate locks de una tabla chica, y el mismo criterio ya usa `crearSesion`. El bloqueo de aviso
// no es un bloqueo de la base: solo lo esperan estas dos operaciones, nunca los logins, las lecturas
// ni el resto del sistema.
//
// Orden de bloqueos, igual en todas las operaciones: aviso (si corresponde) → fila del usuario →
// sesiones del usuario. Los logins y los cambios de contraseña toman fila → sesiones, y nada toma el
// aviso después de una fila: no hay ciclos posibles. Igual, un 40001 o un 40P01 se reintenta hasta
// `INTENTOS` (la transacción entera, que se revirtió); agotados, `ConflictoDeConcurrenciaError`.
// Un error de negocio no se reintenta.
//
// Logins concurrentes: el login bloquea la misma fila. Si la operación confirma primero, el login
// encuentra la cuenta inactiva o el hash cambiado y no crea la sesión (`crearSesion`). Si el login
// confirma primero, la operación revoca la sesión recién creada. Un cambio de rol no impide entrar:
// la sesión creada después del COMMIT ya lee el rol nuevo en cada pedido (`validarSesion`), y la
// respuesta del login usa los datos leídos bajo ese bloqueo, no los de antes de verificar.
//
// Confirmación: Prisma 5.22 puede resolver `$transaction` aunque el COMMIT falle (ver
// `CambioNoConfirmadoError`). Cada transacción guarda su id (`pg_current_xact_id`) y, después,
// se consulta su estado (`pg_xact_status`): solo con `committed` se informa éxito, se emite el
// evento y se devuelve la contraseña temporal. Si no, `OperacionNoConfirmadaError`. Si la base deja
// de responder en el medio, `BaseDeDatosNoDisponibleError`: el resultado no se pudo confirmar (puede
// o no haberse guardado) y nunca se reintenta solo.

import { Prisma, type PrismaClient, type RolUsuario } from '@prisma/client';

import { conLaBaseDeDatos } from '../../lib/baseDeDatosNoDisponible';
import { escaparComodinesDeLike } from '../../lib/like';
import { hashearContrasena } from '../auth/contrasenas';
import { limiteDeHash } from '../auth/limiteDeHash';
import { registrarEventoAdministrativo } from '../auth/registroDeEventos';
import { revocarSesionesDeUsuario } from '../auth/sesiones.service';

import { generarContrasenaTemporal } from './contrasenaTemporal';
import {
  type CambiosValidados,
  type ErrorDeCampo,
  validarCambiosDeUsuario,
  validarFiltrosDeUsuarios,
  validarUsuarioNuevo,
} from './validacionDeUsuarios';

/** Clave del bloqueo de aviso de la composición del conjunto de administradores activos. */
export const BLOQUEO_DE_ADMINISTRADORES = 41_002;

/** Intentos de una transacción ante un conflicto de serialización o un deadlock. */
export const INTENTOS = 3;

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQLSTATE de un conflicto que PostgreSQL resuelve revirtiendo la transacción entera. */
const SQLSTATE_DE_CONFLICTO = new Set(['40001', '40P01']);
const SQLSTATE_EN_EL_MENSAJE = /PostgresError \{ code: "([0-9A-Z]{5})"/;

// ─── Contrato ────────────────────────────────────────────────────────────────

/**
 * Lo único que sale de una cuenta hacia la administración. Selección explícita: nunca se leen el
 * hash, las sesiones ni otras columnas para descartarlas después.
 */
export const SELECCION_DE_USUARIO = {
  id: true,
  nombre: true,
  email: true,
  rol: true,
  activo: true,
  debeCambiarPassword: true,
  ultimoAccesoEn: true,
} as const satisfies Prisma.UsuarioSelect;

export type UsuarioAdministrado = Prisma.UsuarioGetPayload<{ select: typeof SELECCION_DE_USUARIO }>;

export type OperacionSobreCuentaPropia = 'cambiar-rol' | 'desactivar' | 'restablecer-password';

/** Datos inválidos (un 400 por campo). */
export class DatosDeUsuarioInvalidosError extends Error {
  constructor(readonly errores: ErrorDeCampo[]) {
    super('Los datos del usuario no son válidos.');
    this.name = 'DatosDeUsuarioInvalidosError';
  }
}

/** La cuenta no existe (un 404). También para un id sin formato de UUID. */
export class UsuarioInexistenteError extends Error {
  constructor() {
    super('El usuario no existe.');
    this.name = 'UsuarioInexistenteError';
  }
}

/** El email ya pertenece a otra cuenta, activa o no (un 409 en el campo `email`). */
export class EmailEnUsoError extends Error {
  readonly campo = 'email';
  constructor() {
    super('El email ya pertenece a otra cuenta.');
    this.name = 'EmailEnUsoError';
  }
}

/** Nadie cambia su propio rol, se desactiva ni restablece su contraseña por acá (un 409). */
export class OperacionSobreCuentaPropiaError extends Error {
  constructor(readonly operacion: OperacionSobreCuentaPropia) {
    super('La operación no se puede hacer sobre la propia cuenta.');
    this.name = 'OperacionSobreCuentaPropiaError';
  }
}

/** La operación dejaría sin ningún ADMINISTRADOR activo (un 409). */
export class UltimoAdministradorError extends Error {
  constructor(readonly operacion: 'cambiar-rol' | 'desactivar') {
    super('Tiene que quedar al menos un administrador activo.');
    this.name = 'UltimoAdministradorError';
  }
}

/** Conflictos de concurrencia que no se resolvieron en `INTENTOS` intentos. Nada se confirmó. */
export class ConflictoDeConcurrenciaError extends Error {
  constructor() {
    super('La operación chocó con otra simultánea. No se guardó ningún cambio.');
    this.name = 'ConflictoDeConcurrenciaError';
  }
}

/** La transacción terminó sin error pero PostgreSQL no la confirmó (el COMMIT falló). */
export class OperacionNoConfirmadaError extends Error {
  constructor() {
    super('La operación no quedó confirmada en la base.');
    this.name = 'OperacionNoConfirmadaError';
  }
}

// ─── Transacciones ───────────────────────────────────────────────────────────

function sqlstateDe(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2034') return '40001';
    const code = (error.meta as { code?: unknown } | undefined)?.code;
    return error.code === 'P2010' && typeof code === 'string' ? code : undefined;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return SQLSTATE_EN_EL_MENSAJE.exec(error.message)?.[1];
  }
  return undefined;
}

/**
 * Conflicto de serialización (40001) o deadlock (40P01): PostgreSQL revirtió la transacción entera,
 * así que repetirla es seguro. Prisma lo informa como P2034, como P2010 en una consulta raw o, en una
 * consulta del cliente dentro de una transacción interactiva, como `PrismaClientUnknownRequestError`.
 */
export function esConflictoDeConcurrencia(error: unknown): boolean {
  const sqlstate = sqlstateDe(error);
  return sqlstate !== undefined && SQLSTATE_DE_CONFLICTO.has(sqlstate);
}

/**
 * Corre `trabajo` en una transacción READ COMMITTED y solo devuelve su resultado si PostgreSQL la
 * confirmó (`pg_xact_status`). Reintenta la transacción entera ante un conflicto hasta `INTENTOS`.
 * @throws {ConflictoDeConcurrenciaError} agotados los intentos.
 * @throws {OperacionNoConfirmadaError} si el COMMIT no se confirmó.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde (resultado sin confirmar).
 */
export async function enTransaccionConfirmada<T>(
  db: PrismaClient,
  trabajo: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let intento = 1; ; intento += 1) {
    let salida: { valor: T; xid: string };
    try {
      salida = await conLaBaseDeDatos(() =>
        db.$transaction(async (tx) => {
          const [fila] = await tx.$queryRaw<{ xid: string }[]>`
            SELECT pg_current_xact_id()::text AS "xid"`;
          if (fila === undefined) throw new Error('PostgreSQL no informó el id de la transacción.');
          return { valor: await trabajo(tx), xid: fila.xid };
        }),
      );
    } catch (error) {
      if (!esConflictoDeConcurrencia(error)) throw error;
      if (intento >= INTENTOS) throw new ConflictoDeConcurrenciaError();
      continue;
    }

    const { xid } = salida;
    const [estado] = await conLaBaseDeDatos(
      () => db.$queryRaw<{ estado: string | null }[]>`
        SELECT pg_xact_status(${xid}::xid8)::text AS "estado"`,
    );
    if (estado?.estado !== 'committed') throw new OperacionNoConfirmadaError();
    return salida.valor;
  }
}

/** Bloquea la fila del usuario y la lee. `null` si no existe. */
async function bloquearUsuario(
  tx: Prisma.TransactionClient,
  usuarioId: string,
): Promise<UsuarioAdministrado | null> {
  // El comentario identifica la consulta en pg_stat_activity (tests de concurrencia).
  const [fila] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" /* usuarios:bloquear-usuario */ FROM "Usuario"
    WHERE "id" = ${usuarioId}::uuid FOR UPDATE`;
  if (fila === undefined) return null;
  return tx.usuario.findUnique({ where: { id: usuarioId }, select: SELECCION_DE_USUARIO });
}

/** Ordena entre sí las operaciones que pueden reducir el conjunto de administradores activos. */
async function bloquearComposicionDeAdministradores(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(${BLOQUEO_DE_ADMINISTRADORES}) /* usuarios:bloquear-administradores */`;
}

/**
 * Con los dos bloqueos tomados: rechaza si `usuario` es un ADMINISTRADOR activo y no hay otro.
 * Una cuenta que no es administradora activa no cuenta, así que quitarla no cambia nada.
 */
async function exigirOtroAdministrador(
  tx: Prisma.TransactionClient,
  usuario: UsuarioAdministrado,
  operacion: 'cambiar-rol' | 'desactivar',
): Promise<void> {
  if (usuario.rol !== 'ADMINISTRADOR' || !usuario.activo) return;
  const otros = await tx.usuario.count({
    where: { rol: 'ADMINISTRADOR', activo: true, id: { not: usuario.id } },
  });
  if (otros === 0) throw new UltimoAdministradorError(operacion);
}

function exigirId(usuarioId: unknown): asserts usuarioId is string {
  if (typeof usuarioId !== 'string' || !FORMATO_UUID.test(usuarioId)) {
    throw new UsuarioInexistenteError();
  }
}

/** El actor viene de la sesión: un id sin forma de UUID es un error de programación. */
function exigirActor(actorId: unknown): asserts actorId is string {
  if (typeof actorId !== 'string' || !FORMATO_UUID.test(actorId)) {
    throw new TypeError('actorId tiene que ser el id del usuario de la sesión.');
  }
}

const mismoId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Contraseña temporal y su hash, calculado con el límite de argon2 del proceso. */
async function credencialTemporal(contexto: { email: string; nombre: string }) {
  const contrasenaTemporal = generarContrasenaTemporal(contexto);
  const passwordHash = await limiteDeHash.ejecutar(() => hashearContrasena(contrasenaTemporal));
  return { contrasenaTemporal, passwordHash };
}

// ─── Listar ──────────────────────────────────────────────────────────────────

export interface FiltrosDeUsuarios {
  /** Texto que se busca, sin distinguir mayúsculas, dentro del nombre o del email. */
  busqueda?: string;
  rol?: RolUsuario;
  /** Por defecto `false`: solo las cuentas activas. */
  incluirDesactivados?: boolean;
}

/**
 * Cuentas para la administración, filtradas en PostgreSQL y ordenadas por nombre y email (el email
 * es único: el orden es total y no depende del orden físico). Sin paginación: son pocas cuentas.
 * @throws {DatosDeUsuarioInvalidosError} si un filtro no es válido.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde.
 */
export async function listarUsuarios(
  db: PrismaClient,
  filtros: FiltrosDeUsuarios = {},
): Promise<UsuarioAdministrado[]> {
  const validos = validarFiltrosDeUsuarios(filtros);
  if (!validos.ok) throw new DatosDeUsuarioInvalidosError(validos.errores);
  const { busqueda, rol, incluirDesactivados } = validos.datos;

  const texto = busqueda === undefined ? undefined : escaparComodinesDeLike(busqueda);
  return conLaBaseDeDatos(() =>
    db.usuario.findMany({
      where: {
        ...(incluirDesactivados ? {} : { activo: true }),
        ...(rol ? { rol } : {}),
        ...(texto === undefined
          ? {}
          : {
              OR: [
                { nombre: { contains: texto, mode: 'insensitive' } },
                { email: { contains: texto, mode: 'insensitive' } },
              ],
            }),
      },
      select: SELECCION_DE_USUARIO,
      orderBy: [{ nombre: 'asc' }, { email: 'asc' }],
    }),
  );
}

// ─── Crear ───────────────────────────────────────────────────────────────────

export interface DatosDeUsuarioNuevo {
  nombre: string;
  email: string;
  rol: string;
}

/** La contraseña temporal sale solo de acá, una vez. No se guarda en ningún lado en claro. */
export interface UsuarioCreado {
  usuario: UsuarioAdministrado;
  contrasenaTemporal: string;
}

function esEmailDuplicado(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes('email');
  return typeof target === 'string' && target.includes('Usuario_email_key');
}

/**
 * Crea una cuenta activa, con una contraseña temporal generada por el servidor y el cambio
 * obligatorio en el primer ingreso. No crea sesiones.
 *
 * La comprobación previa del email evita calcular argon2 en vano; la garantía es el índice único de
 * PostgreSQL: dos altas simultáneas con el mismo email crean una sola cuenta y la otra recibe
 * `EmailEnUsoError`. Cualquier otro error de la base sigue su curso.
 * @throws {DatosDeUsuarioInvalidosError} nombre, email o rol inválidos.
 * @throws {EmailEnUsoError} el email ya es de otra cuenta, activa o desactivada.
 * @throws {CapacidadAgotadaError} si no hay lugar para calcular el hash.
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde.
 */
export async function crearUsuario(
  db: PrismaClient,
  { actorId, datos }: { actorId: string; datos: DatosDeUsuarioNuevo },
  ahora: Date = new Date(),
): Promise<UsuarioCreado> {
  exigirActor(actorId);
  const validos = validarUsuarioNuevo(datos);
  if (!validos.ok) throw new DatosDeUsuarioInvalidosError(validos.errores);
  const { nombre, email, rol } = validos.datos;

  const existente = await conLaBaseDeDatos(() =>
    db.usuario.findUnique({ where: { email }, select: { id: true } }),
  );
  if (existente !== null) throw new EmailEnUsoError();

  const { contrasenaTemporal, passwordHash } = await credencialTemporal({ email, nombre });

  let usuario: UsuarioAdministrado;
  try {
    usuario = await conLaBaseDeDatos(() =>
      db.usuario.create({
        data: {
          nombre,
          email,
          rol,
          passwordHash,
          activo: true,
          debeCambiarPassword: true,
          passwordActualizadaEn: ahora,
          ultimoAccesoEn: null,
        },
        select: SELECCION_DE_USUARIO,
      }),
    );
  } catch (error) {
    if (esEmailDuplicado(error)) throw new EmailEnUsoError();
    throw error;
  }

  registrarEventoAdministrativo('usuarios.creado', { actorId, usuarioId: usuario.id, rol });
  return { usuario, contrasenaTemporal };
}

// ─── Modificar nombre y rol ──────────────────────────────────────────────────

export interface ResultadoDeModificacion {
  usuario: UsuarioAdministrado;
  /** Lo que cambió de verdad. Vacío: no había nada distinto y no se escribió nada. */
  modificados: ('nombre' | 'rol')[];
  /** Sesiones revocadas: solo un cambio real de rol revoca. */
  sesionesRevocadas: number;
}

/**
 * Modifica el nombre y/o el rol. Solo esas dos claves: cualquier otra (email incluido) es un error
 * de validación. En una transacción, con la fila bloqueada:
 * - nombre: se guarda si es distinto; no revoca sesiones. Se puede cambiar el propio.
 * - rol: si es distinto, se rechaza sobre la propia cuenta y si quitaría el último ADMINISTRADOR
 *   activo; si no, se guarda y se revocan todas las sesiones de la cuenta, en la misma transacción.
 * Un valor igual al actual no es un cambio: no escribe, no revoca y no emite eventos. Si se rechaza
 * el rol, tampoco se guarda el nombre del mismo pedido.
 * @throws {DatosDeUsuarioInvalidosError}, {UsuarioInexistenteError},
 *   {OperacionSobreCuentaPropiaError}, {UltimoAdministradorError}, {ConflictoDeConcurrenciaError},
 *   {OperacionNoConfirmadaError}, {BaseDeDatosNoDisponibleError}.
 */
export async function modificarUsuario(
  db: PrismaClient,
  {
    actorId,
    usuarioId,
    cambios,
  }: { actorId: string; usuarioId: string; cambios: { nombre?: string; rol?: string } },
  ahora: Date = new Date(),
): Promise<ResultadoDeModificacion> {
  exigirActor(actorId);
  const validos = validarCambiosDeUsuario(cambios);
  if (!validos.ok) throw new DatosDeUsuarioInvalidosError(validos.errores);
  exigirId(usuarioId);
  const pedidos: CambiosValidados = validos.datos;

  const resultado = await enTransaccionConfirmada(
    db,
    async (tx): Promise<ResultadoDeModificacion & { rolAnterior: RolUsuario }> => {
      if (pedidos.rol !== undefined) await bloquearComposicionDeAdministradores(tx);
      const actual = await bloquearUsuario(tx, usuarioId);
      if (actual === null) throw new UsuarioInexistenteError();

      // Solo lo que difiere del valor guardado; `null` es "sin cambio".
      const nombre =
        pedidos.nombre !== undefined && pedidos.nombre !== actual.nombre ? pedidos.nombre : null;
      const rol = pedidos.rol !== undefined && pedidos.rol !== actual.rol ? pedidos.rol : null;
      if (rol !== null) {
        if (mismoId(actorId, usuarioId)) throw new OperacionSobreCuentaPropiaError('cambiar-rol');
        await exigirOtroAdministrador(tx, actual, 'cambiar-rol');
      }
      if (nombre === null && rol === null) {
        return { usuario: actual, rolAnterior: actual.rol, modificados: [], sesionesRevocadas: 0 };
      }

      const usuario = await tx.usuario.update({
        where: { id: usuarioId },
        data: { ...(nombre === null ? {} : { nombre }), ...(rol === null ? {} : { rol }) },
        select: SELECCION_DE_USUARIO,
      });
      const sesionesRevocadas =
        rol === null ? 0 : await revocarSesionesDeUsuario(usuarioId, { ahora, tx });
      const modificados: ResultadoDeModificacion['modificados'] = [];
      if (nombre !== null) modificados.push('nombre');
      if (rol !== null) modificados.push('rol');
      return { usuario, rolAnterior: actual.rol, modificados, sesionesRevocadas };
    },
  );

  const { usuario, rolAnterior, modificados, sesionesRevocadas } = resultado;
  if (modificados.includes('nombre')) {
    registrarEventoAdministrativo('usuarios.nombre_cambiado', { actorId, usuarioId: usuario.id });
  }
  if (modificados.includes('rol')) {
    registrarEventoAdministrativo('usuarios.rol_cambiado', {
      actorId,
      usuarioId: usuario.id,
      rolAnterior,
      rol: usuario.rol,
      sesionesRevocadas,
    });
  }
  return { usuario, modificados, sesionesRevocadas };
}

// ─── Desactivar y reactivar ──────────────────────────────────────────────────

export interface ResultadoDeCambioDeEstado {
  usuario: UsuarioAdministrado;
  /** `false`: la cuenta ya estaba en ese estado; no se escribió, no se revocó ni se registró nada. */
  cambio: boolean;
  sesionesRevocadas: number;
}

/**
 * Desactiva (`activo: false`) o reactiva (`activo: true`) una cuenta. Nunca la borra.
 * - Desactivar: no sobre la propia cuenta; no al último ADMINISTRADOR activo; revoca todas sus
 *   sesiones en la misma transacción. La cuenta sigue en la base y en el listado con
 *   `incluirDesactivados`.
 * - Reactivar: conserva la contraseña, el rol y `debeCambiarPassword`; no crea sesiones ni revive
 *   las revocadas (una sesión revocada nunca se "desrevoca"). Si la cuenta necesita una contraseña
 *   nueva, se usa `restablecerContrasena`.
 * Repetir la operación (desactivar una desactivada, reactivar una activa) no es un error: devuelve
 * `cambio: false` sin escribir, sin revocar y sin eventos. Desactivarse a uno mismo se rechaza
 * siempre, aunque no cambiara nada.
 * @throws {DatosDeUsuarioInvalidosError}, {UsuarioInexistenteError},
 *   {OperacionSobreCuentaPropiaError}, {UltimoAdministradorError}, {ConflictoDeConcurrenciaError},
 *   {OperacionNoConfirmadaError}, {BaseDeDatosNoDisponibleError}.
 */
export async function cambiarEstadoDeUsuario(
  db: PrismaClient,
  { actorId, usuarioId, activo }: { actorId: string; usuarioId: string; activo: boolean },
  ahora: Date = new Date(),
): Promise<ResultadoDeCambioDeEstado> {
  exigirActor(actorId);
  if (typeof activo !== 'boolean') {
    throw new DatosDeUsuarioInvalidosError([
      { campo: 'activo', mensaje: 'Indicá si la cuenta queda activa o desactivada.' },
    ]);
  }
  exigirId(usuarioId);
  if (!activo && mismoId(actorId, usuarioId)) {
    throw new OperacionSobreCuentaPropiaError('desactivar');
  }

  const resultado = await enTransaccionConfirmada(db, async (tx) => {
    if (!activo) await bloquearComposicionDeAdministradores(tx);
    const actual = await bloquearUsuario(tx, usuarioId);
    if (actual === null) throw new UsuarioInexistenteError();
    if (actual.activo === activo) return { usuario: actual, cambio: false, sesionesRevocadas: 0 };

    if (!activo) await exigirOtroAdministrador(tx, actual, 'desactivar');
    const usuario = await tx.usuario.update({
      where: { id: usuarioId },
      data: { activo },
      select: SELECCION_DE_USUARIO,
    });
    const sesionesRevocadas = activo ? 0 : await revocarSesionesDeUsuario(usuarioId, { ahora, tx });
    return { usuario, cambio: true, sesionesRevocadas };
  });

  if (resultado.cambio) {
    registrarEventoAdministrativo(activo ? 'usuarios.reactivado' : 'usuarios.desactivado', {
      actorId,
      usuarioId: resultado.usuario.id,
      ...(activo ? {} : { sesionesRevocadas: resultado.sesionesRevocadas }),
    });
  }
  return resultado;
}

// ─── Restablecer la contraseña ───────────────────────────────────────────────

export interface ContrasenaRestablecida {
  usuario: UsuarioAdministrado;
  contrasenaTemporal: string;
  sesionesRevocadas: number;
}

/**
 * Genera una contraseña temporal nueva para OTRA cuenta: guarda solo su hash argon2id, prende
 * `debeCambiarPassword`, actualiza `passwordActualizadaEn` y revoca todas sus sesiones, todo en una
 * transacción con la fila bloqueada (un login que verificó la contraseña anterior y espera ese
 * bloqueo encuentra otro hash y no crea la sesión). Conserva nombre, email, rol y estado: una
 * cuenta desactivada se puede restablecer y sigue desactivada hasta que se la reactive.
 *
 * La propia contraseña no se restablece por acá (se usa el cambio voluntario, HU4.2). La contraseña
 * temporal se devuelve solo si la transacción quedó confirmada. Ante un error que no permite saber
 * si se guardó (`BaseDeDatosNoDisponibleError`), no se reintenta sola: un restablecimiento nuevo
 * genera otra contraseña y deja sin valor la anterior.
 * @throws {UsuarioInexistenteError}, {OperacionSobreCuentaPropiaError},
 *   {ConflictoDeConcurrenciaError}, {OperacionNoConfirmadaError}, {CapacidadAgotadaError},
 *   {BaseDeDatosNoDisponibleError}.
 */
export async function restablecerContrasena(
  db: PrismaClient,
  { actorId, usuarioId }: { actorId: string; usuarioId: string },
  ahora: Date = new Date(),
): Promise<ContrasenaRestablecida> {
  exigirActor(actorId);
  exigirId(usuarioId);
  if (mismoId(actorId, usuarioId))
    throw new OperacionSobreCuentaPropiaError('restablecer-password');

  // Fuera de la transacción: la política usa el email y el nombre como contexto, y argon2 no corre
  // con la fila bloqueada.
  const cuenta = await conLaBaseDeDatos(() =>
    db.usuario.findUnique({ where: { id: usuarioId }, select: { email: true, nombre: true } }),
  );
  if (cuenta === null) throw new UsuarioInexistenteError();
  const { contrasenaTemporal, passwordHash } = await credencialTemporal(cuenta);

  const { usuario, sesionesRevocadas } = await enTransaccionConfirmada(db, async (tx) => {
    if ((await bloquearUsuario(tx, usuarioId)) === null) throw new UsuarioInexistenteError();
    const actualizado = await tx.usuario.update({
      where: { id: usuarioId },
      data: { passwordHash, debeCambiarPassword: true, passwordActualizadaEn: ahora },
      select: SELECCION_DE_USUARIO,
    });
    const revocadas = await revocarSesionesDeUsuario(usuarioId, { ahora, tx });
    return { usuario: actualizado, sesionesRevocadas: revocadas };
  });

  registrarEventoAdministrativo('auth.password.restablecida', {
    actorId,
    usuarioId: usuario.id,
    sesionesRevocadas,
  });
  return { usuario, contrasenaTemporal, sesionesRevocadas };
}
