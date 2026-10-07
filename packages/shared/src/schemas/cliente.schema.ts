import { z } from 'zod';

import { validateCuit } from '../utils/validateCuit.js';

// ─── Enums base ───────────────────────────────────────────────────────────────

/**
 * Condición frente al IVA del cliente.
 */
export const IvaCondicion = z.enum([
  'RESPONSABLE_INSCRIPTO',
  'MONOTRIBUTO',
  'EXENTO',
  'CONSUMIDOR_FINAL',
  'NO_CATEGORIZADO',
]);

export type IvaCondicion = z.infer<typeof IvaCondicion>;

/**
 * Estado del cliente dentro del sistema.
 */
export const ClienteEstado = z.enum(['ACTIVO', 'INACTIVO', 'SUSPENDIDO']);

export type ClienteEstado = z.infer<typeof ClienteEstado>;

/**
 * Sector de actividad del cliente.
 * Determina si el campo `subtipo` es obligatorio o no.
 */
export const ClienteSector = z.enum(['PUBLICO', 'PRIVADO']);

export type ClienteSector = z.infer<typeof ClienteSector>;

/**
 * Subtipos disponibles para clientes del sector público.
 *
 * - MUNICIPAL               → Municipios
 * - PROVINCIAL_ORGANISMO    → Provincial, organismos, legislativo y entes públicos
 * - SINDICAL_OBRA_SOCIAL    → Sindicatos y obras sociales
 */
export const ClienteSubtipoPublico = z.enum([
  'MUNICIPAL',
  'PROVINCIAL_ORGANISMO',
  'SINDICAL_OBRA_SOCIAL',
]);

export type ClienteSubtipoPublico = z.infer<typeof ClienteSubtipoPublico>;

// ─── Campos comunes ───────────────────────────────────────────────────────────

/**
 * Campos compartidos por ambos sectores.
 * El discriminador (`sector`) y el campo condicional (`subtipo`) se definen
 * por separado en cada rama de la discriminated union.
 */
const ClienteCamposBase = z.object({
  /** Identificador único del cliente (UUID v4) */
  id: z.string().uuid({ message: 'El ID debe ser un UUID v4 válido.' }),

  /** Razón social o nombre comercial del cliente */
  razonSocial: z
    .string()
    .min(2, { message: 'La razón social debe tener al menos 2 caracteres.' })
    .max(150, { message: 'La razón social no puede superar los 150 caracteres.' })
    .trim(),

  /**
   * Denominación corta o alias del cliente.
   * Usar cuando la razón social es extensa y dificulta la identificación visual.
   * Máximo 60 caracteres. Campo obligatorio.
   */
  denominacion: z
    .string()
    .min(2, { message: 'La denominación debe tener al menos 2 caracteres.' })
    .max(60, { message: 'La denominación no puede superar los 60 caracteres.' })
    .trim(),

  /** CUIT/CUIL con o sin guiones — se valida con Módulo 11 */
  cuit: z
    .string()
    .regex(/^(\d{2}[-\s]\d{8}[-\s]\d|\d{11})$/, {
      message:
        'El CUIT debe tener el formato XX-XXXXXXXX-X, XX XXXXXXXX X o 11 dígitos sin separadores.',
    })
    .refine(validateCuit, {
      message: 'El CUIT ingresado no es válido (dígito verificador incorrecto o prefijo inválido).',
    })
    .transform((raw) => {
      // Normaliza la salida al formato canónico XX-XXXXXXXX-X independientemente
      // de cómo haya sido ingresado (con guiones, sin guiones o con espacios).
      const digits = raw.replace(/[-\s]/g, '');
      return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
    }),

  /** Condición frente al IVA */
  ivaCondicion: IvaCondicion,

  /** Email de contacto principal */
  emailContacto: z
    .string()
    .email({ message: 'El email de contacto no tiene un formato válido.' })
    .toLowerCase(),

  /** Emails de contacto adicionales (opcional) */
  emailsAdicionales: z
    .array(z.string().email({ message: 'Uno o más emails adicionales no son válidos.' }))
    .max(10, { message: 'Se permiten como máximo 10 emails adicionales.' })
    .optional()
    .default([]),

  /** Teléfono de contacto en formato internacional (opcional) */
  telefono: z
    .string()
    .regex(/^\+?[\d\s\-().]{7,20}$/, {
      message: 'El teléfono no tiene un formato válido.',
    })
    .optional(),

  /** URL del portal web donde se deben entregar los legajos (opcional) */
  portalUrl: z
    .string()
    .url({ message: 'La URL del portal no tiene un formato válido.' })
    .optional(),

  /** Estado actual del cliente en el sistema */
  estado: ClienteEstado.default('ACTIVO'),

  /** Fecha de alta del cliente */
  creadoEn: z.coerce.date(),

  /** Fecha de última actualización */
  actualizadoEn: z.coerce.date(),
});

// ─── Ramas de sector con validación condicional ───────────────────────────────

/**
 * Rama PÚBLICO: el `subtipo` es obligatorio.
 */
const ClientePublicoSchema = ClienteCamposBase.extend({
  sector: z.literal('PUBLICO'),
  /**
   * Subtipo requerido para clientes públicos.
   * No puede ser undefined ni null.
   */
  subtipo: ClienteSubtipoPublico,
});

/**
 * Rama PRIVADO: el `subtipo` no aplica (se omite o es undefined).
 */
const ClientePrivadoSchema = ClienteCamposBase.extend({
  sector: z.literal('PRIVADO'),
  /** Los clientes privados no llevan subtipo. */
  subtipo: z.undefined().optional(),
});

// ─── Schema principal (discriminated union) ───────────────────────────────────

/**
 * Schema Zod para la entidad Cliente.
 *
 * Usa una `discriminatedUnion` sobre el campo `sector` para aplicar
 * validación condicional:
 * - `sector: 'PUBLICO'` → `subtipo` obligatorio (MUNICIPAL | PROVINCIAL_ORGANISMO | SINDICAL_OBRA_SOCIAL)
 * - `sector: 'PRIVADO'` → `subtipo` no requerido
 */
export const ClienteSchema = z.discriminatedUnion('sector', [
  ClientePublicoSchema,
  ClientePrivadoSchema,
]);

// ─── DTOs inferidos ───────────────────────────────────────────────────────────

/** Tipo completo de la entidad Cliente (union discriminada por sector) */
export type Cliente = z.infer<typeof ClienteSchema>;

/** Tipo narrowed: cliente del sector público */
export type ClientePublico = z.infer<typeof ClientePublicoSchema>;

/** Tipo narrowed: cliente del sector privado */
export type ClientePrivado = z.infer<typeof ClientePrivadoSchema>;

/**
 * DTO para la creación de un nuevo cliente.
 * Omite campos autogenerados por el servidor.
 *
 * Nota: `discriminatedUnion` no expone `.omit()` directamente,
 * por lo que se construye derivando desde cada rama y re-uniendo.
 */
export const CreateClienteSchema = z.discriminatedUnion('sector', [
  ClientePublicoSchema.omit({ id: true, creadoEn: true, actualizadoEn: true }),
  ClientePrivadoSchema.omit({ id: true, creadoEn: true, actualizadoEn: true }),
]);

export type CreateClienteDto = z.infer<typeof CreateClienteSchema>;

/**
 * DTO para la actualización parcial de un cliente.
 * Todos los campos son opcionales excepto el discriminador `sector`.
 *
 * La unión se mantiene para preservar el narrowing de `subtipo`.
 */
export const UpdateClienteSchema = z.discriminatedUnion('sector', [
  ClientePublicoSchema.omit({ id: true, creadoEn: true, actualizadoEn: true }).partial({
    razonSocial: true,
    denominacion: true,
    cuit: true,
    ivaCondicion: true,
    emailContacto: true,
    emailsAdicionales: true,
    telefono: true,
    portalUrl: true,
    estado: true,
    subtipo: true,
  }),
  ClientePrivadoSchema.omit({ id: true, creadoEn: true, actualizadoEn: true }).partial({
    razonSocial: true,
    denominacion: true,
    cuit: true,
    ivaCondicion: true,
    emailContacto: true,
    emailsAdicionales: true,
    telefono: true,
    portalUrl: true,
    estado: true,
    subtipo: true,
  }),
]);

export type UpdateClienteDto = z.infer<typeof UpdateClienteSchema>;
