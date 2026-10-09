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

/**
 * Canal habitual por el que se entregan las rendiciones al cliente.
 *
 * - CORREO     → se envían por email al `emailContacto` (y adicionales)
 * - PORTAL_WEB → se cargan en el portal del cliente (`portalUrl` obligatorio)
 * - WHATSAPP   → se envían por WhatsApp (`whatsappNumero` obligatorio)
 */
export const CanalEntrega = z.enum(['CORREO', 'PORTAL_WEB', 'WHATSAPP']);

export type CanalEntrega = z.infer<typeof CanalEntrega>;

// ─── WhatsApp ─────────────────────────────────────────────────────────────────────────

/**
 * Número de WhatsApp. Acepta separadores habituales (espacios, guiones, paréntesis) y
 * devuelve siempre el formato E.164: `+` seguido de 10 a 15 dígitos (p. ej. `+5493511234567`).
 * Se exige el código de país porque es lo que necesita un enlace `wa.me`.
 */
export const WhatsappNumeroSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s\-().]+$/, {
    message: 'El número de WhatsApp solo puede tener dígitos, espacios, guiones o paréntesis.',
  })
  .transform((raw) => raw.replace(/\D/g, ''))
  .refine((digitos) => /^[1-9]\d{9,14}$/.test(digitos), {
    message:
      'El número de WhatsApp debe incluir el código de país y tener entre 10 y 15 dígitos (p. ej. +54 9 351 123 4567).',
  })
  .transform((digitos) => `+${digitos}`);

// ─── CUIT ─────────────────────────────────────────────────────────────────────

/**
 * CUIT/CUIL con o sin separadores, validado con Módulo 11.
 *
 * Acepta `XX-XXXXXXXX-X`, `XX XXXXXXXX X` o 11 dígitos, y siempre devuelve el formato
 * canónico `XX-XXXXXXXX-X`. Es la única definición de la regla: el Cliente la reutiliza
 * y el front puede validar el campo solo (p. ej. al salir del input) con `safeParse`.
 */
export const CuitSchema = z
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
  });

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
  // `.trim()` va antes de `.min()`/`.max()`: Zod aplica los checks en orden, y así la
  // longitud se mide sobre el valor normalizado ("   " no puede pasar como 3 caracteres).
  razonSocial: z
    .string()
    .trim()
    .min(2, { message: 'La razón social debe tener al menos 2 caracteres.' })
    .max(150, { message: 'La razón social no puede superar los 150 caracteres.' }),

  /**
   * Denominación corta o alias del cliente.
   * Usar cuando la razón social es extensa y dificulta la identificación visual.
   * Máximo 60 caracteres. Campo obligatorio.
   */
  denominacion: z
    .string()
    .trim()
    .min(2, { message: 'La denominación debe tener al menos 2 caracteres.' })
    .max(60, { message: 'La denominación no puede superar los 60 caracteres.' }),

  /** CUIT/CUIL con o sin guiones — se valida con Módulo 11 */
  cuit: CuitSchema,

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

  /** URL del portal web donde se deben entregar los legajos. Obligatoria si el canal es PORTAL_WEB. */
  portalUrl: z
    .string()
    .trim()
    .url({ message: 'La URL del portal no tiene un formato válido.' })
    .optional(),

  /** Canal habitual de entrega de rendiciones. Por defecto, CORREO (igual que la base). */
  canalEntrega: CanalEntrega.default('CORREO'),

  /** Número de WhatsApp en E.164. Obligatorio si el canal es WHATSAPP. */
  whatsappNumero: WhatsappNumeroSchema.optional(),

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

/**
 * Subtipos válidos según el sector del cliente.
 * Para el sector PÚBLICO son los definidos en ClienteSubtipoPublico.
 * Para el sector PRIVADO no aplica ninguno (array vacío).
 */
export const subtiposPorSector = {
  PUBLICO: ClienteSubtipoPublico.options,
  PRIVADO: [] as const,
} as const satisfies Record<ClienteSector, readonly ClienteSubtipoPublico[]>;

// ─── Validación condicional del canal de entrega ───────────────────────────────────

/**
 * Campos que intervienen en la regla del canal. Todos opcionales para poder reutilizar
 * la misma función en el alta (objeto completo) y en la edición parcial (PATCH).
 */
interface DatosCanalEntrega {
  canalEntrega?: CanalEntrega | undefined;
  portalUrl?: string | undefined;
  whatsappNumero?: string | undefined;
  emailContacto?: string | undefined;
  emailsAdicionales?: string[] | undefined;
}

/**
 * Regla "el canal elegido debe tener dónde entregar".
 *
 * Por qué `superRefine` y no otra `discriminatedUnion`:
 * - El schema ya discrimina por `sector`. Una segunda unión por `canalEntrega` obligaría a
 *   combinar 2 sectores × 3 canales = 6 ramas, y Zod no permite anidar uniones discriminadas.
 * - `discriminatedUnion` solo acepta `ZodObject` puros, así que el refinamiento no puede ir
 *   dentro de cada rama: se aplica sobre la unión ya armada (ver `ClienteSchema` y DTOs).
 *
 * Por qué `superRefine` y no `refine`:
 * - Permite informar el error en el campo concreto (`path`), que es lo que el contrato
 *   expone como `details[].campo` y lo que el front usa para marcar el input.
 *
 * Importante: Zod ejecuta el refinamiento solo si el resto del objeto ya es válido. Por eso
 * el formulario del front, además, chequea los campos vacíos por su cuenta (ver
 * `clienteFormResolver`), para mostrar todos los errores juntos.
 */
function validarCanalEntrega(datos: DatosCanalEntrega, ctx: z.RefinementCtx): void {
  switch (datos.canalEntrega) {
    // Portal web: sin URL no hay dónde subir la rendición. El formato ya lo validó `.url()`;
    // acá solo se exige que esté presente.
    case 'PORTAL_WEB':
      if (datos.portalUrl === undefined || datos.portalUrl === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['portalUrl'],
          message: 'Si el canal de entrega es Portal web, ingresá la URL del portal.',
        });
      }
      break;

    // WhatsApp: el formato (E.164) lo validó `WhatsappNumeroSchema`; acá se exige presencia.
    case 'WHATSAPP':
      if (datos.whatsappNumero === undefined || datos.whatsappNumero === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['whatsappNumero'],
          message: 'Si el canal de entrega es WhatsApp, ingresá un número de WhatsApp.',
        });
      }
      break;

    // Correo: debe existir al menos un destinatario. Hoy los destinatarios son el email de
    // rendición (`emailContacto`, obligatorio) y los adicionales. Cuando exista el modelo
    // Contacto (HU1.3), los contactos con `recibeRendiciones` se validan en el backend contra
    // la base: Zod no puede consultar una relación.
    // `emailContacto === undefined` solo ocurre en una edición parcial que no lo toca: en ese
    // caso el cliente ya tiene uno guardado y no hay nada que validar.
    case 'CORREO': {
      if (datos.emailContacto === undefined) break;
      const destinatarios = [datos.emailContacto, ...(datos.emailsAdicionales ?? [])].filter(
        (email) => email.trim() !== '',
      );
      if (destinatarios.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['emailContacto'],
          message:
            'Si el canal de entrega es Correo, el cliente debe tener al menos un email de contacto.',
        });
      }
      break;
    }

    // Edición parcial que no cambia el canal: no se valida nada.
    case undefined:
      break;
  }
}

// ─── Schema principal (discriminated union) ───────────────────────────────────

/**
 * Schema Zod para la entidad Cliente.
 *
 * Usa una `discriminatedUnion` sobre el campo `sector` para aplicar
 * validación condicional:
 * - `sector: 'PUBLICO'` → `subtipo` obligatorio (MUNICIPAL | PROVINCIAL_ORGANISMO | SINDICAL_OBRA_SOCIAL)
 * - `sector: 'PRIVADO'` → `subtipo` no requerido
 *
 * Y un `superRefine` para el canal de entrega (ver `validarCanalEntrega`).
 */
export const ClienteSchema = z
  .discriminatedUnion('sector', [ClientePublicoSchema, ClientePrivadoSchema])
  .superRefine(validarCanalEntrega);

// ─── DTOs inferidos ───────────────────────────────────────────────────────────

/** Tipo completo de la entidad Cliente (union discriminada por sector) */
export type Cliente = z.infer<typeof ClienteSchema>;

/** Tipo narrowed: cliente del sector público */
export type ClientePublico = z.infer<typeof ClientePublicoSchema>;

/** Tipo narrowed: cliente del sector privado */
export type ClientePrivado = z.infer<typeof ClientePrivadoSchema>;

/**
 * Campos que fija el servidor al crear un cliente y que el pedido no puede controlar.
 * `estado` incluido: un cliente nuevo siempre nace ACTIVO (lo asigna el backend).
 */
const CAMPOS_DEL_SERVIDOR_EN_ALTA = {
  id: true,
  estado: true,
  creadoEn: true,
  actualizadoEn: true,
} as const;

/**
 * DTO para la creación de un nuevo cliente.
 * Omite los campos que fija el servidor (ver `CAMPOS_DEL_SERVIDOR_EN_ALTA`). Si el pedido
 * los envía igual, Zod los descarta como cualquier clave desconocida: no es un error.
 *
 * Nota: `discriminatedUnion` no expone `.omit()` directamente,
 * por lo que se construye derivando desde cada rama y re-uniendo.
 */
export const CreateClienteSchema = z
  .discriminatedUnion('sector', [
    ClientePublicoSchema.omit(CAMPOS_DEL_SERVIDOR_EN_ALTA),
    ClientePrivadoSchema.omit(CAMPOS_DEL_SERVIDOR_EN_ALTA),
  ])
  .superRefine(validarCanalEntrega);

export type CreateClienteDto = z.infer<typeof CreateClienteSchema>;

/** Campos del cliente que una edición puede modificar (todos opcionales). */
const CAMPOS_EDITABLES = {
  razonSocial: true,
  denominacion: true,
  cuit: true,
  ivaCondicion: true,
  emailContacto: true,
  emailsAdicionales: true,
  telefono: true,
  portalUrl: true,
  canalEntrega: true,
  whatsappNumero: true,
} as const;

/**
 * DTO para la actualización parcial de un cliente (`PATCH /clientes/:id`).
 *
 * Cualquier subconjunto de los campos editables, con al menos uno. `id`, `estado`, `creadoEn`
 * y `actualizadoEn` no se editan por acá: si llegan, Zod los descarta como cualquier clave
 * desconocida y no es un error (el estado tiene su propio endpoint).
 *
 * `.partial()` va sobre los campos de la base, que traen `default` (`canalEntrega`,
 * `emailsAdicionales`): un campo ausente queda ausente y no pisa lo guardado. Por eso no
 * es una unión discriminada: acá `sector` y `subtipo` son opcionales y la regla que los
 * relaciona es el `superRefine`.
 */
export const UpdateClienteSchema = ClienteCamposBase.pick(CAMPOS_EDITABLES)
  .extend({ sector: ClienteSector, subtipo: ClienteSubtipoPublico })
  .partial()
  .superRefine((datos, ctx) => {
    if (Object.values(datos).every((valor) => valor === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enviá al menos un campo para modificar.',
      });
    }

    // Lo que depende del sector guardado (un `subtipo` sin `sector`) lo valida el backend.
    if (datos.sector === 'PUBLICO' && datos.subtipo === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subtipo'],
        message: 'Si el sector es Público, elegí el subtipo.',
      });
    }
    if (datos.sector === 'PRIVADO' && datos.subtipo !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subtipo'],
        message: 'Los clientes privados no tienen subtipo.',
      });
    }

    // Como en el alta: quien pasa a PORTAL_WEB o WHATSAPP envía el dato en el mismo pedido.
    validarCanalEntrega(datos, ctx);
  });

export type UpdateClienteDto = z.infer<typeof UpdateClienteSchema>;
