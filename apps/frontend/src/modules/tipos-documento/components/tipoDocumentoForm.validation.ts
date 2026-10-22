// Validación del formulario de tipo de documento. Las reglas son las de
// `CreateTipoDocumentoSchema` (shared): nombre obligatorio de hasta 100 caracteres, descripción
// opcional de hasta 500, sin caracteres de control, recortados. Acá solo se adapta el resultado a
// un formulario: sus mensajes ya están en español, así que no hacen falta textos propios.

import {
  CreateTipoDocumentoSchema,
  type CreateTipoDocumentoDto,
  type TipoDocumento,
} from '@realpolitik/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

import type { CambiosTipoDocumento } from '@/modules/tipos-documento/api/tipos-documento.api';

/** Valores del formulario: los dos campos como texto (descripción vacía = "sin descripción"). */
export interface TipoDocumentoFormValues {
  nombre: string;
  descripcion: string;
}

export type CampoTipoDocumentoForm = keyof TipoDocumentoFormValues;

/** El formulario del alta arranca vacío. */
export const valoresInicialesTipoDocumentoForm: TipoDocumentoFormValues = {
  nombre: '',
  descripcion: '',
};

/** Valores iniciales de la edición: los del tipo, con `null` como descripción vacía. */
export function tipoDocumentoAValoresForm(tipo: TipoDocumento): TipoDocumentoFormValues {
  return { nombre: tipo.nombre, descripcion: tipo.descripcion ?? '' };
}

/**
 * Valida con el schema compartido. Si es válido entrega los datos ya normalizados por shared
 * (recortados; una descripción vacía como `null`); si no, el primer error de cada campo.
 */
export const tipoDocumentoFormResolver: Resolver<
  TipoDocumentoFormValues,
  unknown,
  CreateTipoDocumentoDto
> = (valores) => {
  const resultado = CreateTipoDocumentoSchema.safeParse(valores);
  if (resultado.success) {
    return { values: resultado.data, errors: {} };
  }
  const errores: FieldErrors<TipoDocumentoFormValues> = {};
  for (const issue of resultado.error.issues) {
    const campo = issue.path[0];
    if (campo === 'nombre' || campo === 'descripcion') {
      errores[campo] ??= { type: 'validate', message: issue.message };
    }
  }
  // Shared rechazó algo que el formulario no muestra: sin un error, RHF lo daría por válido.
  if (Object.keys(errores).length === 0) {
    errores.root = { type: 'validate', message: 'Revisá los datos.' } as NonNullable<
      FieldErrors<TipoDocumentoFormValues>['root']
    >;
  }
  return { values: {}, errors: errores };
};

/**
 * ¿El formulario sigue igual a como se abrió? Compara lo que se enviaría (los bordes no cuentan,
 * igual que en shared) contra los valores iniciales. Modificar un campo y volverlo a su valor
 * original cuenta como "sin cambios". Mayúsculas y acentos sí cuentan: renombrar "Constancia
 * ARCA" a "constancia arca" es un cambio válido (la unicidad la decide el backend).
 */
export function sinCambiosRespectoDe(
  valores: TipoDocumentoFormValues,
  iniciales: TipoDocumentoFormValues,
): boolean {
  return (
    valores.nombre.trim() === iniciales.nombre.trim() &&
    valores.descripcion.trim() === iniciales.descripcion.trim()
  );
}

/**
 * El PATCH de la edición: solo lo que cambió respecto del tipo guardado. Una descripción que se
 * vació viaja como `null` (borrarla); un campo sin cambios no viaja. `{}` si no cambió nada (quien
 * lo usa no debe enviar el pedido).
 *
 * @param datos el formulario completo, ya validado y normalizado por shared.
 * @param tipo el tipo tal como estaba al abrir la edición.
 */
export function cambiosDeTipoDocumento(
  datos: CreateTipoDocumentoDto,
  tipo: TipoDocumento,
): CambiosTipoDocumento {
  return {
    ...(datos.nombre !== tipo.nombre && { nombre: datos.nombre }),
    ...(datos.descripcion !== tipo.descripcion && { descripcion: datos.descripcion }),
  };
}

/** ¿Hay algo para enviar? */
export const hayCambios = (cambios: CambiosTipoDocumento) => Object.keys(cambios).length > 0;
