import { z } from 'zod';

import { exigirAlgunCampo, sinCaracteresDeControl, textoOpcional } from './campos.js';

// Largos de las columnas de `TipoDocumento` (`apps/backend/prisma/schema.prisma`).
const NOMBRE_MAX = 100;
const DESCRIPCION_MAX = 500;

/** Nombre del tipo: recortado, de 1 a 100 caracteres y sin caracteres de control. */
const NombreSchema = z
  .string({
    required_error: 'El nombre es obligatorio.',
    invalid_type_error: 'El nombre debe ser un texto.',
  })
  .trim()
  .min(1, { message: 'El nombre es obligatorio.' })
  .max(NOMBRE_MAX, { message: `El nombre no puede superar los ${NOMBRE_MAX} caracteres.` })
  .refine(sinCaracteresDeControl, {
    message: 'El nombre no puede contener caracteres de control.',
  });

/** Descripción: hasta 500 caracteres; vacía = `null`. */
const DescripcionSchema = textoOpcional({ nombre: 'La descripción', max: DESCRIPCION_MAX });

/**
 * Tipo de documento tal como lo devuelve la API. Es una entidad de lectura: no aplica reglas de
 * escritura más allá de la forma (el nombre es un string simple, sin recorte ni largo). La
 * unicidad del nombre (sin distinguir mayúsculas ni acentos) es del backend: shared no puede
 * consultar la base.
 */
export const TipoDocumentoSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
  nombre: z.string(),
  descripcion: z.string().nullable(),
  activo: z.boolean(),
  creadoEn: z.coerce.date(),
  actualizadoEn: z.coerce.date(),
});

export type TipoDocumento = z.infer<typeof TipoDocumentoSchema>;

/**
 * Cuerpo de `POST /tipos-documento`. `id`, `activo` y las fechas los fija el servidor: si llegan,
 * se descartan como cualquier clave desconocida. La descripción ausente o vacía queda en `null`.
 */
export const CreateTipoDocumentoSchema = z.object({
  nombre: NombreSchema,
  descripcion: DescripcionSchema.nullable().default(null),
});

export type CreateTipoDocumentoDto = z.infer<typeof CreateTipoDocumentoSchema>;

/**
 * Cuerpo de `PATCH /tipos-documento/:id`: `nombre` y/o `descripcion`, con al menos uno.
 * `descripcion: null` la borra. Sin defaults: un campo ausente no se modifica. `activo` se cambia
 * solo con `/estado`; si llega acá, se descarta.
 */
export const UpdateTipoDocumentoSchema = z
  .object({
    nombre: NombreSchema,
    descripcion: DescripcionSchema.nullable(),
  })
  .partial()
  .superRefine(exigirAlgunCampo);

export type UpdateTipoDocumentoDto = z.infer<typeof UpdateTipoDocumentoSchema>;

/** Cuerpo de `PATCH /tipos-documento/:id/estado`: `activo` es obligatorio y booleano. */
export const ActualizarEstadoTipoDocumentoSchema = z.object({
  activo: z.boolean({
    required_error: 'Indicá si el tipo de documento está activo.',
    invalid_type_error: 'activo debe ser true o false.',
  }),
});

export type ActualizarEstadoTipoDocumentoDto = z.infer<typeof ActualizarEstadoTipoDocumentoSchema>;
