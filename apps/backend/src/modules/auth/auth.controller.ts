// Controladores de `/auth` (Backend 2C y cierre de la etapa 2). Traducen el servicio de inicio de
// sesión, el de cambio de contraseña y el de sesiones a HTTP: cookie, códigos y mensajes. No
// consultan la base por su cuenta.
//
// | Situación                                   | Respuesta                                                      |
// | ------------------------------------------- | -------------------------------------------------------------- |
// | Credenciales incorrectas o cuenta inactiva  | 401 UNAUTHENTICATED, motivo CREDENCIALES_INVALIDAS             |
// | Sin sesión, revocada, inexistente, inactiva | 401 UNAUTHENTICATED, motivo SESION_REQUERIDA (borra la cookie) |
// | Sesión vencida (duración o inactividad)     | 401 UNAUTHENTICATED, motivo SESION_VENCIDA (borra la cookie)   |
// | Demora por cuenta o límite por origen       | 429 TOO_MANY_REQUESTS, motivo DEMASIADOS_INTENTOS, Retry-After |
// | Otro intento de la misma cuenta en curso    | 429 TOO_MANY_REQUESTS, motivo INTENTO_EN_CURSO, Retry-After    |
// | Contraseña actual incorrecta (al cambiarla) | 400 VALIDATION_ERROR en `actual` (nunca 401)                   |
// | Contraseña nueva rechazada por la política  | 400 VALIDATION_ERROR en `nueva`                                |
// | Capacidad de argon2 agotada                 | 503 SERVICE_UNAVAILABLE, Retry-After                           |
// | PostgreSQL no responde                      | 503 SERVICE_UNAVAILABLE (la cookie NO se borra)                |

import type {
  CambiarContrasenaSchema,
  IniciarSesionSchema,
  SesionActual,
} from '@realpolitik/shared';
import type { NextFunction, Request, Response } from 'express';

import {
  type AppError,
  serviceUnavailable,
  tooManyRequests,
  unauthenticated,
  validationError,
} from '../../errors/app-error';
import { BaseDeDatosNoDisponibleError } from '../../lib/baseDeDatosNoDisponible';
import { CapacidadAgotadaError } from '../../lib/limitadorDeConcurrencia';
import type { ValidatedLocals } from '../../middleware/validate';

import {
  cambiarContrasena,
  ContrasenaActualIncorrectaError,
  ContrasenaNuevaRechazadaError,
  CredencialesInvalidasError,
  iniciarSesion,
  IntentosLimitadosError,
  SesionNoVigenteError,
} from './autenticacion.service';
import type { LocalsDeSesion } from './autorizacion';
import { borrarCookieDeSesion, emitirCookieDeSesion, leerTokenDeSesion } from './cookieDeSesion';
import type { ProteccionDeLogin } from './proteccionDeLogin';
import { registrarEventoDeAuth } from './registroDeEventos';
import {
  revocarSesionPorToken,
  validarSesion,
  type MotivoDeSesionInvalida,
} from './sesiones.service';

export const MENSAJE_CREDENCIALES_INVALIDAS = 'Email o contraseña incorrectos.';
export const MENSAJE_SESION_REQUERIDA = 'Iniciá sesión para continuar.';
export const MENSAJE_SESION_VENCIDA = 'Tu sesión venció. Iniciá sesión de nuevo.';
export const MENSAJE_SERVICIO_NO_DISPONIBLE =
  'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.';
export const MENSAJE_SERVICIO_OCUPADO =
  'El servicio está ocupado. Probá de nuevo en unos segundos.';
export const MENSAJE_INTENTO_EN_CURSO =
  'Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo.';
export const MENSAJE_CONTRASENA_ACTUAL_INCORRECTA = 'La contraseña actual no es correcta.';

/** Espera sugerida cuando la base no responde o argon2 no tiene capacidad. */
export const REINTENTO_POR_SATURACION_SEGUNDOS = 5;

type IniciarSesionLocals = ValidatedLocals<{ body: typeof IniciarSesionSchema }>;

type CambiarContrasenaLocals = LocalsDeSesion &
  ValidatedLocals<{ body: typeof CambiarContrasenaSchema }>;

/** Segundos de `Retry-After`: redondea hacia arriba, nunca 0. */
const segundos = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** El mensaje dice la misma espera que `Retry-After` (en segundos, o en minutos redondeados hacia arriba). */
export function mensajeDeEspera(segundosDeEspera: number): string {
  if (segundosDeEspera < 60) {
    const cuanto = segundosDeEspera === 1 ? '1 segundo' : `${segundosDeEspera} segundos`;
    return `Demasiados intentos. Probá de nuevo en ${cuanto}.`;
  }
  const minutos = Math.ceil(segundosDeEspera / 60);
  return minutos === 1
    ? 'Demasiados intentos. Probá de nuevo en un minuto.'
    : `Demasiados intentos. Probá de nuevo en ${minutos} minutos.`;
}

/**
 * 429 de un intento limitado. La concurrencia no es una sanción: el otro intento de la misma
 * cuenta termina en milisegundos, así que lo dice y no habla de "demasiados intentos".
 */
function intentosLimitados({ motivo, retryAfterMs }: IntentosLimitadosError): AppError {
  const espera = segundos(retryAfterMs);
  return motivo === 'concurrencia'
    ? tooManyRequests('INTENTO_EN_CURSO', MENSAJE_INTENTO_EN_CURSO, espera)
    : tooManyRequests('DEMASIADOS_INTENTOS', mensajeDeEspera(espera), espera);
}

const baseNoDisponible = () =>
  serviceUnavailable(MENSAJE_SERVICIO_NO_DISPONIBLE, REINTENTO_POR_SATURACION_SEGUNDOS);

const servicioOcupado = () =>
  serviceUnavailable(MENSAJE_SERVICIO_OCUPADO, REINTENTO_POR_SATURACION_SEGUNDOS);

/** Traduce los errores comunes a las operaciones de sesión; el resto sigue su curso (500). */
function traducirFallaDeSesion(error: unknown): unknown {
  return error instanceof BaseDeDatosNoDisponibleError ? baseNoDisponible() : error;
}

function sesionInvalida(motivo: MotivoDeSesionInvalida) {
  return motivo === 'VENCIDA_POR_DURACION' || motivo === 'VENCIDA_POR_INACTIVIDAD'
    ? unauthenticated('SESION_VENCIDA', MENSAJE_SESION_VENCIDA)
    : unauthenticated('SESION_REQUERIDA', MENSAJE_SESION_REQUERIDA);
}

/**
 * Exige una sesión válida y la deja en `res.locals.sesion`. Sin cookie: 401 sin tocar nada. Cookie
 * inválida: la borra y responde 401. Base caída: 503 y la cookie queda (la falla no es de la sesión).
 * La usan `GET /auth/sesion`, `PUT /auth/password` y, en `createApp`, toda la API de negocio.
 */
export async function requerirSesion(
  req: Request,
  res: Response<unknown, Partial<LocalsDeSesion>>,
  next: NextFunction,
): Promise<void> {
  const token = leerTokenDeSesion(req);
  if (token === undefined) throw unauthenticated('SESION_REQUERIDA', MENSAJE_SESION_REQUERIDA);

  let resultado;
  try {
    resultado = await validarSesion(token);
  } catch (error) {
    throw traducirFallaDeSesion(error);
  }
  if (!resultado.valida) {
    borrarCookieDeSesion(res);
    throw sesionInvalida(resultado.motivo);
  }
  res.locals.sesion = resultado.sesion;
  next();
}

export function crearLoginController(proteccion: ProteccionDeLogin) {
  return async function loginController(
    req: Request,
    res: Response<SesionActual, IniciarSesionLocals>,
  ): Promise<void> {
    const { email, password } = res.locals.validated.body;
    let resultado;
    try {
      // La sesión que traía el navegador se reemplaza en la misma transacción que crea la nueva, y
      // solo si estas credenciales son correctas: un intento fallido no la toca.
      resultado = await iniciarSesion(
        { email, password, ip: req.ip, tokenAnterior: leerTokenDeSesion(req) },
        proteccion,
      );
    } catch (error) {
      if (error instanceof CredencialesInvalidasError) {
        registrarEventoDeAuth('auth.login.fallo', { motivo: error.motivoInterno, ip: req.ip });
        throw unauthenticated('CREDENCIALES_INVALIDAS', MENSAJE_CREDENCIALES_INVALIDAS);
      }
      if (error instanceof IntentosLimitadosError) {
        registrarEventoDeAuth('auth.login.limitado', { motivo: error.motivo, ip: req.ip });
        throw intentosLimitados(error);
      }
      if (error instanceof CapacidadAgotadaError) {
        registrarEventoDeAuth('auth.login.limitado', { motivo: 'capacidad', ip: req.ip });
        throw servicioOcupado();
      }
      throw traducirFallaDeSesion(error);
    }

    registrarEventoDeAuth('auth.login.ok', { usuarioId: resultado.usuario.id, ip: req.ip });
    emitirCookieDeSesion(res, resultado.sesion.token);
    res.status(200).json({ usuario: resultado.usuario });
  };
}

/** Va detrás de `requerirSesion`: los datos del usuario son los recién leídos de la base. */
export function sesionController(_req: Request, res: Response<SesionActual, LocalsDeSesion>): void {
  res.status(200).json({ usuario: res.locals.sesion.usuario });
}

/**
 * `PUT /auth/password`, detrás de `requerirSesion` y de la validación del cuerpo. Con éxito revoca
 * todas las sesiones (también esta), borra la cookie y responde 204: hay que volver a iniciar
 * sesión con la contraseña nueva. Si la base falla, no se borra la cookie ni se afirma nada.
 */
export function crearCambioDeContrasenaController(proteccion: ProteccionDeLogin) {
  return async function cambioDeContrasenaController(
    req: Request,
    res: Response<unknown, CambiarContrasenaLocals>,
  ): Promise<void> {
    const { sesion } = res.locals;
    const { actual, nueva } = res.locals.validated.body;
    const usuarioId = sesion.usuario.id;
    try {
      await cambiarContrasena({ sesion, actual, nueva, ip: req.ip }, proteccion);
    } catch (error) {
      if (error instanceof ContrasenaNuevaRechazadaError) {
        throw validationError([{ campo: 'nueva', mensaje: error.mensaje }]);
      }
      if (error instanceof ContrasenaActualIncorrectaError) {
        registrarEventoDeAuth('auth.password.fallo', {
          usuarioId,
          motivo: 'credenciales',
          ip: req.ip,
        });
        throw validationError([{ campo: 'actual', mensaje: MENSAJE_CONTRASENA_ACTUAL_INCORRECTA }]);
      }
      if (error instanceof IntentosLimitadosError) {
        registrarEventoDeAuth('auth.password.fallo', {
          usuarioId,
          motivo: error.motivo,
          ip: req.ip,
        });
        throw intentosLimitados(error);
      }
      if (error instanceof SesionNoVigenteError) {
        borrarCookieDeSesion(res);
        throw sesionInvalida(error.motivo);
      }
      if (error instanceof CapacidadAgotadaError) {
        registrarEventoDeAuth('auth.password.fallo', {
          usuarioId,
          motivo: 'capacidad',
          ip: req.ip,
        });
        throw servicioOcupado();
      }
      throw traducirFallaDeSesion(error);
    }

    registrarEventoDeAuth('auth.password.cambiada', { usuarioId, ip: req.ip });
    borrarCookieDeSesion(res);
    res.status(204).end();
  };
}

export async function logoutController(req: Request, res: Response): Promise<void> {
  const token = leerTokenDeSesion(req);
  if (token !== undefined) {
    try {
      // Sin confirmación de la base no se dice que se cerró la sesión ni se borra la cookie.
      await revocarSesionPorToken(token);
    } catch (error) {
      throw traducirFallaDeSesion(error);
    }
    registrarEventoDeAuth('auth.logout', { ip: req.ip });
  }
  borrarCookieDeSesion(res);
  res.status(204).end();
}
