// Clasificación de los errores de la API que tienen que ver con la sesión y el acceso (ADR-0006
// §4). Un solo lugar decide qué significa cada respuesta; las pantallas y el manejo global leen
// la clase, nunca el status suelto. Los textos son propios de la interfaz: jamás se muestra el
// mensaje interno de un error que no sea del contrato.

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  mensajeDelServidor,
  type DetalleInvalido,
} from '@/lib/errores-api';
import { ApiClientError } from '@/lib/http';

export type ErrorDeAuth =
  /** 401 sin sesión válida. `vencida`: por tiempo; si no, revocada o inexistente. */
  | { clase: 'sin-sesion'; vencida: boolean }
  /** 401 solo del login. */
  | { clase: 'credenciales' }
  /** 403: hay sesión, con contraseña temporal sin cambiar. */
  | { clase: 'cambio-requerido' }
  /** 403: hay sesión, pero el rol todavía no entra al sistema (CONSULTA, hasta HU4.3). */
  | { clase: 'rol-no-habilitado' }
  /** 403: hay sesión, sin el permiso de esa operación. */
  | { clase: 'permiso-insuficiente' }
  /** 403: el servidor no aceptó el origen del pedido. */
  | { clase: 'origen' }
  /** 429: hay que esperar. `enCurso`: otro intento de la misma cuenta, no una sanción. */
  | { clase: 'demasiados-intentos'; enCurso: boolean; esperaSegundos: number | undefined }
  /** 400 de validación: datos rechazados, por campo. */
  | { clase: 'validacion'; detalles: DetalleInvalido[] }
  /** 503, otro 5xx o un 502/504 del proxy: el servicio no responde. La sesión NO terminó. */
  | { clase: 'no-disponible' }
  /** No hubo respuesta: sin conexión. La sesión NO terminó. */
  | { clase: 'red' }
  | { clase: 'inesperado' };

function motivoDe(details: unknown): string | null {
  return esObjeto(details) && typeof details.motivo === 'string' ? details.motivo : null;
}

export function clasificarErrorDeAuth(error: unknown): ErrorDeAuth {
  if (!(error instanceof ApiClientError)) {
    return { clase: 'inesperado' };
  }
  if (error.kind === 'network') {
    return { clase: 'red' };
  }
  if (error.kind !== 'http' || error.status === undefined) {
    return { clase: 'inesperado' };
  }

  const cuerpo = leerCuerpoDeError(error.payload);
  const motivo = motivoDe(cuerpo?.details);
  const status = error.status;

  if (status === 401) {
    return motivo === 'CREDENCIALES_INVALIDAS'
      ? { clase: 'credenciales' }
      : { clase: 'sin-sesion', vencida: motivo === 'SESION_VENCIDA' };
  }
  if (status === 403) {
    switch (motivo) {
      case 'CAMBIO_DE_PASSWORD_REQUERIDO':
        return { clase: 'cambio-requerido' };
      case 'ROL_NO_HABILITADO':
        return { clase: 'rol-no-habilitado' };
      case 'ORIGEN_NO_PERMITIDO':
        return { clase: 'origen' };
      default:
        return { clase: 'permiso-insuficiente' };
    }
  }
  if (status === 429) {
    return {
      clase: 'demasiados-intentos',
      enCurso: motivo === 'INTENTO_EN_CURSO',
      esperaSegundos: error.retryAfterSegundos,
    };
  }
  if (status === 400 && cuerpo?.code === 'VALIDATION_ERROR') {
    return { clase: 'validacion', detalles: leerDetallesInvalidos(cuerpo.details) };
  }
  if (status >= 500) {
    return { clase: 'no-disponible' };
  }
  return { clase: 'inesperado' };
}

// ─── Textos ───────────────────────────────────────────────────────────────────

export const MENSAJE_CREDENCIALES_INVALIDAS = 'Email o contraseña incorrectos.';
export const MENSAJE_SERVICIO_NO_DISPONIBLE =
  'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.';
export const MENSAJE_SIN_CONEXION = 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.';
export const MENSAJE_INTENTO_EN_CURSO =
  'Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo.';
export const MENSAJE_ORIGEN = 'No pudimos validar el pedido. Recargá la página y probá de nuevo.';
export const MENSAJE_INESPERADO = 'Algo salió mal. Probá de nuevo.';
export const MENSAJE_PERMISO_INSUFICIENTE = 'No tenés permiso para esta acción.';
export const MENSAJE_ROL_NO_HABILITADO = 'Tu cuenta todavía no tiene acceso al sistema.';

/** La misma frase que el servidor (segundos, o minutos redondeados hacia arriba). */
export function mensajeDeEspera(esperaSegundos: number | undefined): string {
  if (esperaSegundos === undefined || esperaSegundos <= 0) {
    return 'Demasiados intentos. Probá de nuevo en unos minutos.';
  }
  if (esperaSegundos < 60) {
    const cuanto = esperaSegundos === 1 ? '1 segundo' : `${esperaSegundos} segundos`;
    return `Demasiados intentos. Probá de nuevo en ${cuanto}.`;
  }
  const minutos = Math.ceil(esperaSegundos / 60);
  return minutos === 1
    ? 'Demasiados intentos. Probá de nuevo en un minuto.'
    : `Demasiados intentos. Probá de nuevo en ${minutos} minutos.`;
}

/**
 * Texto general de un error para un aviso (los errores por campo y la pérdida de sesión se tratan
 * aparte). `variante` dice cómo mostrarlo: la espera es una advertencia, no un error.
 */
export function avisoDeErrorDeAuth(error: ErrorDeAuth): {
  variante: 'destructive' | 'warning';
  texto: string;
} {
  switch (error.clase) {
    case 'credenciales':
      return { variante: 'destructive', texto: MENSAJE_CREDENCIALES_INVALIDAS };
    case 'demasiados-intentos':
      return {
        variante: 'warning',
        texto: error.enCurso ? MENSAJE_INTENTO_EN_CURSO : mensajeDeEspera(error.esperaSegundos),
      };
    case 'no-disponible':
      return { variante: 'destructive', texto: MENSAJE_SERVICIO_NO_DISPONIBLE };
    case 'red':
      return { variante: 'destructive', texto: MENSAJE_SIN_CONEXION };
    case 'origen':
      return { variante: 'destructive', texto: MENSAJE_ORIGEN };
    case 'permiso-insuficiente':
      return { variante: 'destructive', texto: MENSAJE_PERMISO_INSUFICIENTE };
    case 'rol-no-habilitado':
      return { variante: 'destructive', texto: MENSAJE_ROL_NO_HABILITADO };
    default:
      return { variante: 'destructive', texto: MENSAJE_INESPERADO };
  }
}

/** El mensaje de un campo rechazado por el servidor, si está pensado para personas. */
export function mensajeDeCampo(detalles: DetalleInvalido[], campo: string): string | null {
  const detalle = detalles.find((d) => d.campo === campo);
  return detalle ? mensajeDelServidor(detalle.mensaje) : null;
}
