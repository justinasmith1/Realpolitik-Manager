import {
  hoyEnBuenosAires,
  RegistrarCobroSchema,
  type Cobro,
  type RegistrarCobroDto,
} from '@realpolitik/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

/** Valores del formulario del cobro: lo que muestran los controles (todo texto; nota '' = sin nota). */
export interface RegistrarCobroFormValues {
  /** Un día, `AAAA-MM-DD`, como lo entrega `<input type="date">`. */
  fecha: string;
  nota: string;
}

export type CampoCobro = keyof RegistrarCobroFormValues;

/** Orden en pantalla: el foco va al primero con error. */
export const ordenDeCamposCobro: readonly CampoCobro[] = ['fecha', 'nota'];

const esCampoCobro = (campo: unknown): campo is CampoCobro =>
  typeof campo === 'string' && (ordenDeCamposCobro as readonly string[]).includes(campo);

/**
 * Los valores iniciales: los del cobro guardado o, si no hay, hoy (Buenos Aires) y sin nota. Hoy se
 * lee al llamar, no al importar el módulo.
 */
export function valoresInicialesCobro(cobro: Cobro | null): RegistrarCobroFormValues {
  return cobro === null
    ? { fecha: hoyEnBuenosAires(), nota: '' }
    : { fecha: cobro.fecha, nota: cobro.nota ?? '' };
}

/**
 * Valida con `RegistrarCobroSchema` de shared, la misma regla que aplica el backend (fecha válida y
 * no posterior a hoy, nota de 1 a `COBRO_NOTA_MAX` caracteres). Una nota vacía se manda como `null`.
 */
export const registrarCobroResolver: Resolver<
  RegistrarCobroFormValues,
  unknown,
  RegistrarCobroDto
> = (valores) => {
  const nota = valores.nota.trim();
  const resultado = RegistrarCobroSchema.safeParse({
    fecha: valores.fecha,
    nota: nota === '' ? null : nota,
  });
  if (resultado.success) {
    return { values: resultado.data, errors: {} };
  }
  const errors: FieldErrors<RegistrarCobroFormValues> = {};
  for (const issue of resultado.error.issues) {
    const campo = issue.path[0];
    if (esCampoCobro(campo) && errors[campo] === undefined) {
      errors[campo] = { type: issue.code, message: issue.message };
    }
  }
  return { values: {}, errors };
};
