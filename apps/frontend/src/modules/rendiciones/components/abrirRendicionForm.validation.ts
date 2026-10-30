import {
  ANIO_MIN,
  CreateRendicionSchema,
  Emisor,
  mesActual,
  type CreateRendicionDto,
  type EmisorType,
} from '@realpolitik/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

import type { SelectOption } from '@/components/ui/select';
import { etiquetasEmisor, nombresDeMes } from '@/modules/clientes/clientes.etiquetas';
import { MENSAJE_EMISOR_OBLIGATORIO } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Valores del formulario: lo que muestran los controles (los selects trabajan con texto). */
export interface AbrirRendicionFormValues {
  mes: string;
  anio: string;
  /** '' = sin elegir: es obligatorio, y arranca vacío si el cliente no tiene emisor habitual. */
  emisor: EmisorType | '';
  numeroFactura: string;
}

export type CampoAbrirRendicion = keyof AbrirRendicionFormValues;

/** Orden en pantalla: el foco va al primero con error. */
export const ordenDeCampos: readonly CampoAbrirRendicion[] = [
  'mes',
  'anio',
  'emisor',
  'numeroFactura',
];

const esCampo = (campo: unknown): campo is CampoAbrirRendicion =>
  typeof campo === 'string' && (ordenDeCampos as readonly string[]).includes(campo);

/**
 * Arranca en el mes actual (horario de Buenos Aires, como el backend), con el emisor habitual del
 * cliente (vacío si no tiene) y sin factura.
 */
export function valoresInicialesAbrirRendicion(
  ahora: Date = new Date(),
  emisorDelCliente: EmisorType | null | undefined = null,
): AbrirRendicionFormValues {
  const { anio, mes } = mesActual(ahora);
  return {
    mes: String(mes),
    anio: String(anio),
    emisor: emisorDelCliente ?? '',
    numeroFactura: '',
  };
}

/** Un emisor por tipo, con el nombre que se ve en pantalla (`etiquetasEmisor`). */
export const opcionesDeEmisor: readonly SelectOption[] = Emisor.options.map((valor) => ({
  value: valor,
  label: etiquetasEmisor[valor],
}));

export const opcionesDeMes: readonly SelectOption[] = nombresDeMes.map((nombre, indice) => ({
  value: String(indice + 1),
  label: nombre,
}));

/**
 * Años elegibles, del más reciente al más viejo: desde 2020 hasta el año del mes siguiente al
 * actual, que es el período máximo que se puede abrir (en diciembre, incluye el año que viene).
 */
export function opcionesDeAnio(ahora: Date = new Date()): SelectOption[] {
  const { anio, mes } = mesActual(ahora);
  const ultimo = mes === 12 ? anio + 1 : anio;
  return Array.from({ length: ultimo - ANIO_MIN + 1 }, (_, indice) => {
    const valor = String(ultimo - indice);
    return { value: valor, label: valor };
  });
}

/**
 * Valida con `CreateRendicionSchema` de shared, la misma regla que aplica el backend: período
 * hasta el mes siguiente y número de factura recortado y en mayúsculas. Entrega los datos ya
 * normalizados. Cada error va a su campo (el del período cae en `mes`).
 */
export const abrirRendicionResolver: Resolver<
  AbrirRendicionFormValues,
  unknown,
  CreateRendicionDto
> = (valores) => {
  const resultado = CreateRendicionSchema.safeParse({
    anio: Number(valores.anio),
    mes: Number(valores.mes),
    numeroFactura: valores.numeroFactura,
    ...(valores.emisor === '' ? {} : { emisor: valores.emisor }),
  });
  const errors: FieldErrors<AbrirRendicionFormValues> = {};
  // El emisor es obligatorio al abrir: en shared es opcional porque el servidor completa el del
  // cliente, pero acá el formulario siempre lo manda y no deja el campo vacío.
  if (valores.emisor === '') {
    errors.emisor = { type: 'required', message: MENSAJE_EMISOR_OBLIGATORIO };
  }
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      const campo = issue.path[0];
      if (esCampo(campo) && errors[campo] === undefined) {
        errors[campo] = { type: issue.code, message: issue.message };
      }
    }
  }
  if (resultado.success && Object.keys(errors).length === 0) {
    return { values: resultado.data, errors: {} };
  }
  return { values: {}, errors };
};
