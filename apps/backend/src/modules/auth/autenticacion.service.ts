// Inicio de sesión (ADR-0006 §3) y cambio de la propia contraseña (§1, primer acceso de HU4.1).
//
// El inicio de sesión orquesta, en este orden:
// 1. la reserva del intento (`ProteccionDeLogin`, sincrónica y ANTES de cualquier cálculo);
// 2. la búsqueda del usuario por email normalizado;
// 3. la verificación de la contraseña con argon2, siempre a través de `limiteDeHash`;
// 4. la creación de la sesión (`crearSesion`), que reemplaza la que traía el navegador y comprueba,
//    con la fila del usuario bloqueada, que la contraseña verificada siga siendo la vigente.
//
// Sin enumeración: email inexistente, contraseña incorrecta y cuenta desactivada terminan igual
// (`CredencialesInvalidasError`) y con un costo similar: con un email inexistente se verifica contra
// un hash ficticio (calculado una sola vez) y con una cuenta desactivada se verifica igual la
// contraseña. Es una mitigación de las diferencias de tiempo, no una garantía de tiempo constante:
// la consulta a la base y el resto del pedido siguen variando un poco.
//
// No sabe de HTTP: la capa de controladores traduce los errores (401, 429, 503).

import { randomBytes } from 'node:crypto';

import { conLaBaseDeDatos } from '../../lib/baseDeDatosNoDisponible';
import { prisma } from '../../lib/prisma';

import {
  HashDeContrasenaInvalidoError,
  hashearContrasena,
  verificarContrasena,
} from './contrasenas';
import { limiteDeHash } from './limiteDeHash';
import { evaluarContrasenaNueva } from './politicaDeContrasenas';
import type { MotivoDeLimite, ProteccionDeLogin } from './proteccionDeLogin';
import {
  crearSesion,
  CredencialesDesactualizadasError,
  type MotivoDeSesionInvalida,
  revocarSesionesDeUsuario,
  type SesionCreada,
  type SesionValidada,
  type UsuarioDeSesion,
  UsuarioNoHabilitadoError,
} from './sesiones.service';
import { evaluarSesion } from './vigenciaDeSesion';

/** Email inexistente, contraseña incorrecta o cuenta desactivada: hacia afuera, lo mismo. */
export class CredencialesInvalidasError extends Error {
  constructor(readonly motivoInterno: 'credenciales' | 'inactiva' | 'hash-invalido') {
    super('Credenciales inválidas.');
    this.name = 'CredencialesInvalidasError';
  }
}

/** Demora por cuenta, límite por origen o un intento simultáneo de la misma cuenta. */
export class IntentosLimitadosError extends Error {
  constructor(
    readonly motivo: MotivoDeLimite,
    readonly retryAfterMs: number,
  ) {
    super('Demasiados intentos de inicio de sesión.');
    this.name = 'IntentosLimitadosError';
  }
}

/** La contraseña actual escrita al cambiarla no es la vigente. */
export class ContrasenaActualIncorrectaError extends Error {
  constructor() {
    super('La contraseña actual no coincide.');
    this.name = 'ContrasenaActualIncorrectaError';
  }
}

/** La contraseña nueva no cumple la política (lista de bloqueo, contexto o patrones). */
export class ContrasenaNuevaRechazadaError extends Error {
  constructor(readonly mensaje: string) {
    super('La contraseña nueva no cumple la política.');
    this.name = 'ContrasenaNuevaRechazadaError';
  }
}

/** La sesión del pedido dejó de valer mientras se procesaba (revocada, vencida, cuenta inactiva). */
export class SesionNoVigenteError extends Error {
  constructor(readonly motivo: MotivoDeSesionInvalida) {
    super('La sesión dejó de ser válida.');
    this.name = 'SesionNoVigenteError';
  }
}

let hashFicticio: Promise<string> | null = null;

/**
 * Hash argon2id de una contraseña aleatoria que nadie conoce, calculado una vez por proceso (el
 * servidor lo prepara al arrancar). Contra él se verifica cuando el email no existe, para que esa
 * respuesta no sea más rápida que la de una contraseña incorrecta.
 */
export function prepararHashFicticio(): Promise<string> {
  hashFicticio ??= hashearContrasena(randomBytes(24).toString('base64url'));
  return hashFicticio;
}

export interface ResultadoDeInicioDeSesion {
  sesion: SesionCreada;
  usuario: UsuarioDeSesion;
}

/**
 * Inicia sesión con email (ya normalizado por el schema) y contraseña. `tokenAnterior` es el token
 * de la cookie que traía el navegador: su sesión se revoca en la misma transacción que crea la
 * nueva, y solo si las credenciales nuevas son correctas.
 * @throws {IntentosLimitadosError} si un límite no permite el intento (no se verifica nada).
 * @throws {CredencialesInvalidasError} si el email no existe, la contraseña no coincide o la cuenta
 *   está desactivada.
 * @throws {CapacidadAgotadaError} si no hay lugar para calcular el hash (no cuenta como fallo).
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde (no cuenta como fallo).
 */
export async function iniciarSesion(
  {
    email,
    password,
    ip,
    tokenAnterior,
  }: {
    email: string;
    password: string;
    ip: string | undefined;
    tokenAnterior?: string | undefined;
  },
  proteccion: ProteccionDeLogin,
  ahora: Date = new Date(),
): Promise<ResultadoDeInicioDeSesion> {
  const reserva = proteccion.reservar(email, ip);
  if (!reserva.permitido) throw new IntentosLimitadosError(reserva.motivo, reserva.retryAfterMs);
  const { intento } = reserva;

  try {
    const usuario = await conLaBaseDeDatos(() =>
      prisma.usuario.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          nombre: true,
          rol: true,
          activo: true,
          debeCambiarPassword: true,
          passwordHash: true,
        },
      }),
    );

    const hash = usuario?.passwordHash ?? (await prepararHashFicticio());
    let coincide: boolean;
    try {
      coincide = await limiteDeHash.ejecutar(() => verificarContrasena(hash, password));
    } catch (error) {
      if (!(error instanceof HashDeContrasenaInvalidoError)) throw error;
      // Un hash guardado corrupto es un problema de datos, no del que intenta entrar: no cuenta
      // como fallo, y hacia afuera responde igual que una contraseña incorrecta.
      intento.liberar();
      throw new CredencialesInvalidasError('hash-invalido');
    }

    if (usuario === null || !coincide) {
      intento.fallo();
      throw new CredencialesInvalidasError('credenciales');
    }
    if (!usuario.activo) {
      intento.fallo();
      throw new CredencialesInvalidasError('inactiva');
    }

    let sesion: SesionCreada;
    try {
      sesion = await crearSesion(usuario.id, usuario.passwordHash, ahora, {
        reemplazaA: tokenAnterior,
      });
    } catch (error) {
      // Se desactivó, o cambió la contraseña, entre la verificación y la creación.
      if (error instanceof UsuarioNoHabilitadoError) {
        intento.fallo();
        throw new CredencialesInvalidasError('inactiva');
      }
      if (error instanceof CredencialesDesactualizadasError) {
        intento.fallo();
        throw new CredencialesInvalidasError('credenciales');
      }
      throw error;
    }

    intento.exito();
    const { id, nombre, rol, debeCambiarPassword } = usuario;
    return { sesion, usuario: { id, email: usuario.email, nombre, rol, debeCambiarPassword } };
  } finally {
    // Base caída, capacidad agotada o cualquier error sin veredicto: libera sin contar un fallo.
    // Si ya se cerró con `fallo` o `exito`, no hace nada.
    intento.liberar();
  }
}

/**
 * Cambia la contraseña de la persona de una sesión ya validada (`PUT /auth/password`). Sirve para el
 * cambio obligatorio del primer acceso (`debeCambiarPassword`) y para un cambio voluntario.
 *
 * 1. La nueva pasa por la política completa (con el email y el nombre como contexto) antes de
 *    cualquier cálculo: rechazarla no consume la protección ni argon2.
 * 2. Reserva un intento en la misma `ProteccionDeLogin` que el login, con el email de la cuenta: la
 *    contraseña actual incorrecta cuenta para la demora por cuenta y el límite por origen, y dos
 *    cambios simultáneos de la misma cuenta no se calculan a la vez.
 * 3. Verifica la actual y calcula el hash de la nueva, ambos por `limiteDeHash`, FUERA de la
 *    transacción (no se bloquea la fila durante argon2).
 * 4. En UNA transacción, con la fila del usuario bloqueada (`FOR UPDATE`, el mismo bloqueo que
 *    `crearSesion`): comprueba que la cuenta siga activa, que la sesión del pedido siga vigente y que
 *    el hash siga siendo el verificado; guarda el hash nuevo con `debeCambiarPassword = false` y
 *    `passwordActualizadaEn`, y revoca TODAS las sesiones del usuario, incluida la del pedido. Si
 *    algo falla, no cambia nada.
 *
 * El indicador de primer acceso solo lo apaga este cambio: nunca llega del cliente.
 * @returns cuántas sesiones se revocaron (al menos la del pedido).
 * @throws {ContrasenaNuevaRechazadaError} si la nueva no cumple la política.
 * @throws {IntentosLimitadosError} si un límite no permite el intento.
 * @throws {ContrasenaActualIncorrectaError} si la actual no es la vigente.
 * @throws {SesionNoVigenteError} si la sesión o la cuenta dejaron de valer en el medio.
 * @throws {CapacidadAgotadaError} si no hay lugar para argon2 (no cuenta como fallo).
 * @throws {BaseDeDatosNoDisponibleError} si PostgreSQL no responde: no se confirma nada.
 */
export async function cambiarContrasena(
  {
    sesion,
    actual,
    nueva,
    ip,
  }: { sesion: SesionValidada; actual: string; nueva: string; ip: string | undefined },
  proteccion: ProteccionDeLogin,
  ahora: Date = new Date(),
): Promise<{ sesionesRevocadas: number }> {
  const { usuario, sesionId } = sesion;
  const politica = evaluarContrasenaNueva(nueva, { email: usuario.email, nombre: usuario.nombre });
  if (!politica.aceptada) throw new ContrasenaNuevaRechazadaError(politica.mensaje);

  const reserva = proteccion.reservar(usuario.email, ip);
  if (!reserva.permitido) throw new IntentosLimitadosError(reserva.motivo, reserva.retryAfterMs);
  const { intento } = reserva;

  try {
    const guardado = await conLaBaseDeDatos(() =>
      prisma.usuario.findUnique({
        where: { id: usuario.id },
        select: { activo: true, passwordHash: true },
      }),
    );
    if (!guardado?.activo) throw new SesionNoVigenteError('USUARIO_INACTIVO');

    let coincide: boolean;
    try {
      coincide = await limiteDeHash.ejecutar(() =>
        verificarContrasena(guardado.passwordHash, actual),
      );
    } catch (error) {
      if (!(error instanceof HashDeContrasenaInvalidoError)) throw error;
      // Hash guardado ilegible: problema de datos, no de la persona. No cuenta como fallo.
      intento.liberar();
      throw new ContrasenaActualIncorrectaError();
    }
    if (!coincide) {
      intento.fallo();
      throw new ContrasenaActualIncorrectaError();
    }

    const hashNuevo = await limiteDeHash.ejecutar(() => hashearContrasena(nueva));

    const sesionesRevocadas = await conLaBaseDeDatos(() =>
      prisma.$transaction(async (tx) => {
        const [fila] = await tx.$queryRaw<{ activo: boolean; passwordHash: string }[]>`
          SELECT "activo", "passwordHash" FROM "Usuario" WHERE "id" = ${usuario.id}::uuid FOR UPDATE`;
        if (!fila?.activo) throw new SesionNoVigenteError('USUARIO_INACTIVO');

        // Otro cambio de contraseña o un cierre de sesión pudo revocarla mientras se calculaba.
        const delPedido = await tx.sesion.findUnique({
          where: { id: sesionId },
          select: { createdAt: true, ultimaActividadEn: true, expiraEn: true, revocadaEn: true },
        });
        if (delPedido === null) throw new SesionNoVigenteError('INEXISTENTE');
        const estado = evaluarSesion(delPedido, ahora);
        if (estado !== 'VIGENTE') throw new SesionNoVigenteError(estado);

        if (fila.passwordHash !== guardado.passwordHash)
          throw new ContrasenaActualIncorrectaError();

        await tx.usuario.update({
          where: { id: usuario.id },
          data: {
            passwordHash: hashNuevo,
            debeCambiarPassword: false,
            passwordActualizadaEn: ahora,
          },
        });
        return revocarSesionesDeUsuario(usuario.id, { ahora, tx });
      }),
    );

    intento.exito();
    return { sesionesRevocadas };
  } finally {
    // Sin veredicto (base caída, capacidad agotada, sesión que dejó de valer): no cuenta como fallo.
    intento.liberar();
  }
}
