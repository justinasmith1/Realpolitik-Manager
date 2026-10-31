import {
  ActualizarRendicionSchema,
  type ActualizarRendicionDto,
  type UltimaOc,
} from '@realpolitik/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

/** Valores del formulario de la OC: lo que muestran los controles (todo texto; '' = sin dato). */
export interface EditarOcFormValues {
  numeroOc: string;
  montoMensual: string;
  montoTotal: string;
}

export type CampoOc = keyof EditarOcFormValues;

/** Orden en pantalla: el foco va al primero con error. */
export const ordenDeCamposOc: readonly CampoOc[] = ['numeroOc', 'montoMensual', 'montoTotal'];

const esCampoOc = (campo: unknown): campo is CampoOc =>
  typeof campo === 'string' && (ordenDeCamposOc as readonly string[]).includes(campo);

/** Un monto como lo escribe la operadora: coma decimal, sin separador de miles. */
const textoDeMonto = (monto: number | null): string =>
  monto === null ? '' : String(monto).replace('.', ',');

/** Los valores iniciales del formulario: los de la OC de la rendición (vacíos si no tiene). */
export function valoresInicialesOc(oc: {
  numeroOc: string | null;
  montoMensual: number | null;
  montoTotal: number | null;
}): EditarOcFormValues {
  return {
    numeroOc: oc.numeroOc ?? '',
    montoMensual: textoDeMonto(oc.montoMensual),
    montoTotal: textoDeMonto(oc.montoTotal),
  };
}

/** Los valores del formulario que completa la sugerencia "Repetir última OC". */
export function valoresDeSugerencia(ultima: NonNullable<UltimaOc>): EditarOcFormValues {
  return valoresInicialesOc(ultima);
}

/** El formulario no tiene ningún dato: es cuando se ofrece la sugerencia. */
export const ocVacia = (valores: EditarOcFormValues): boolean =>
  valores.numeroOc.trim() === '' &&
  valores.montoMensual.trim() === '' &&
  valores.montoTotal.trim() === '';

/**
 * Un monto escrito a número. Acepta `1250000`, `1250000,50`, `1250000.50` y `1.250.000,50`. Vacío
 * es `null` (sin monto). Lo que no es un número da `NaN`, que el schema rechaza con su mensaje.
 * Solo se aceptan dígitos, puntos y comas: `Number()` solo también aceptaría `1e5` o `0x10`.
 */
export function montoEscrito(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, '');
  if (limpio === '') return null;
  if (!/^[\d.,]+$/.test(limpio)) return Number.NaN;
  const conMiles = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio) || limpio.includes(',');
  return Number(conMiles ? limpio.replace(/\./g, '').replace(',', '.') : limpio);
}

/**
 * Valida con `ActualizarRendicionSchema` de shared, la misma regla que aplica el backend. Un campo
 * vacío se manda como `null`: guardar el formulario deja la OC exactamente como se ve, así que
 * vaciar un campo lo borra. Entrega los datos ya normalizados (número recortado, montos números).
 */
export const editarOcResolver: Resolver<EditarOcFormValues, unknown, ActualizarRendicionDto> = (
  valores,
) => {
  const numeroOc = valores.numeroOc.trim();
  const resultado = ActualizarRendicionSchema.safeParse({
    numeroOc: numeroOc === '' ? null : numeroOc,
    montoMensual: montoEscrito(valores.montoMensual),
    montoTotal: montoEscrito(valores.montoTotal),
  });
  if (resultado.success) {
    return { values: resultado.data, errors: {} };
  }
  const errors: FieldErrors<EditarOcFormValues> = {};
  for (const issue of resultado.error.issues) {
    const campo = issue.path[0];
    if (esCampoOc(campo) && errors[campo] === undefined) {
      errors[campo] = { type: issue.code, message: issue.message };
    }
  }
  return { values: {}, errors };
};
