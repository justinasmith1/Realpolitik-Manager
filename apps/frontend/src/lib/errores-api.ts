// Piezas genéricas para leer los errores de la API. `http()` entrega el cuerpo de un error sin
// interpretar; acá se lee el formato común del contrato (`{ error: { code, message, details } }`)
// y se clasifica el fallo. Cada módulo arma encima su propio intérprete con los motivos de su
// dominio (CUIT duplicado, tipo de documento duplicado…). No produce texto de interfaz.

import { ApiClientError } from '@/lib/http';

/** Un objeto de JSON (ni `null` ni un array): lo único en lo que tiene sentido buscar claves. */
export const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/** `{ error: { code, details } }` del contrato, o `null` si el cuerpo no tiene esa forma. */
export function leerCuerpoDeError(payload: unknown): { code: unknown; details: unknown } | null {
  if (!esObjeto(payload) || !esObjeto(payload.error)) {
    return null;
  }
  return { code: payload.error.code, details: payload.error.details };
}

/** Un dato que el servidor rechazó: el campo (notación de puntos) y su mensaje, si lo informó. */
export interface DetalleInvalido {
  campo: string;
  mensaje: string | null;
}

/**
 * Los `details` de un `VALIDATION_ERROR`. Descarta lo que no tenga la forma `{ campo, mensaje }`
 * en vez de fallar: un detalle raro no impide mostrar los demás.
 */
export function leerDetallesInvalidos(details: unknown): DetalleInvalido[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.flatMap((detalle) =>
    esObjeto(detalle) && typeof detalle.campo === 'string'
      ? [
          {
            campo: detalle.campo,
            mensaje: typeof detalle.mensaje === 'string' ? detalle.mensaje : null,
          },
        ]
      : [],
  );
}

// Mensajes por defecto de Zod, en inglés ("Required", "Expected string, received number"...).
// El contrato avisa que pueden llegar cuando `shared` no define el texto: esos no se muestran.
const MENSAJE_POR_DEFECTO_DE_ZOD =
  /^(Required|Invalid |Expected |Unrecognized key|String must|Number must|Array must|Too (small|big))/;

/**
 * El `mensaje` de un detalle de validación, solo si está pensado para personas (los de shared,
 * en español). Vacío o un texto por defecto de Zod: `null`, y quien lo muestra usa uno propio.
 * Mismo criterio que el formulario de clientes.
 */
export function mensajeDelServidor(mensaje: string | null): string | null {
  const texto = mensaje?.trim() ?? '';
  return texto === '' || MENSAJE_POR_DEFECTO_DE_ZOD.test(texto) ? null : texto;
}

/**
 * Código técnico, sin datos personales, para mostrar a soporte cuando falla la carga.
 */
export function diagnosticoDeError(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return 'ERROR_INESPERADO';
  }
  switch (error.kind) {
    case 'network':
      return 'NETWORK_ERROR';
    case 'configuration':
      return 'CONFIG_ERROR';
    case 'http':
      return `HTTP_${error.status ?? 'ERROR'}`;
  }
}

/** Por qué falló la carga de un listado, para decirlo con precisión en la interfaz. */
export type CausaDeFalloDeCarga = 'conexion' | 'servidor' | 'configuracion' | 'inesperado';

export function causaDeError(error: unknown): CausaDeFalloDeCarga {
  if (!(error instanceof ApiClientError)) {
    return 'inesperado';
  }
  switch (error.kind) {
    case 'network':
      return 'conexion';
    case 'configuration':
      return 'configuracion';
    case 'http':
      return (error.status ?? 0) >= 500 ? 'servidor' : 'inesperado';
  }
}
