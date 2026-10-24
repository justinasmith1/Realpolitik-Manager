import { z } from 'zod';

import { repetidos } from './campos.js';
import {
  CanalPropioSchema,
  CantidadSchema,
  DiasAproximadosSchema,
  NotaSchema,
  TipoDocumentoIdSchema,
  validarDiasCoherentes,
} from './requisitoCliente.schema.js';

/**
 * Un cliente dentro de la carga masiva: su `cantidad` (1 por defecto) y sus `diasAproximados`
 * (vacíos por defecto), con las mismas reglas que un requisito individual. El error de días
 * señala al cliente (`clientes.1.diasAproximados`).
 */
const ClienteEnCargaMasivaSchema = z
  .object({
    clienteId: z
      .string({ required_error: 'Falta el cliente.' })
      .uuid({ message: 'El cliente debe ser un UUID válido.' }),
    cantidad: CantidadSchema.default(1),
    diasAproximados: DiasAproximadosSchema.default([]),
  })
  .superRefine(validarDiasCoherentes);

/**
 * Un cliente no puede aparecer dos veces. Se marcan todas las ocurrencias, cada una en su
 * `clienteId`, y se compara sin distinguir mayúsculas (un uuid en mayúsculas es el mismo uuid).
 */
function validarClientesNoRepetidos(clientes: { clienteId: string }[], ctx: z.RefinementCtx): void {
  const ids = clientes.map((c) =>
    typeof c.clienteId === 'string' ? c.clienteId.toLowerCase() : undefined,
  );
  for (const indices of repetidos(ids)) {
    for (const indice of indices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [indice, 'clienteId'],
        message: 'Este cliente está repetido en la lista.',
      });
    }
  }
}

/**
 * Cuerpo de `POST /requisitos/masivo` (HU2.3): un mismo tipo de documento para varios clientes.
 *
 * - `tipoDocumentoId`: obligatorio. Que esté activo lo valida el backend.
 * - `canalEntrega` y `nota`: opcionales, y si se envían se aplican a todos los requisitos creados.
 *   Ausentes quedan en `null`, igual que en el alta individual.
 * - `clientes`: lista no vacía, sin clientes repetidos. No se fija un máximo: el negocio no lo
 *   definió.
 */
export const CargaMasivaRequisitoSchema = z.object({
  tipoDocumentoId: TipoDocumentoIdSchema,
  canalEntrega: CanalPropioSchema.default(null),
  nota: NotaSchema.default(null),
  clientes: z
    .array(ClienteEnCargaMasivaSchema, {
      required_error: 'Elegí al menos un cliente.',
      invalid_type_error: 'Los clientes deben ser una lista.',
    })
    .min(1, { message: 'Elegí al menos un cliente.' })
    .superRefine(validarClientesNoRepetidos),
});

export type CargaMasivaRequisitoDto = z.infer<typeof CargaMasivaRequisitoSchema>;

/**
 * Por qué un cliente se omitió de la carga masiva. Única fuente: la usan la respuesta del
 * backend y el front para mostrar el resultado.
 *
 * - REQUISITO_DUPLICADO → el cliente ya tiene un requisito activo de ese tipo
 * - CLIENTE_NO_ACTIVO   → el cliente está `INACTIVO` o `SUSPENDIDO`
 */
export const MOTIVOS_OMISION_CARGA_MASIVA = ['REQUISITO_DUPLICADO', 'CLIENTE_NO_ACTIVO'] as const;

export const MotivoOmisionCargaMasivaSchema = z.enum(MOTIVOS_OMISION_CARGA_MASIVA);

export type MotivoOmisionCargaMasiva = z.infer<typeof MotivoOmisionCargaMasivaSchema>;

/** Respuesta 200 de `POST /requisitos/masivo`. Puede no haberse creado ninguno. */
export const ResultadoCargaMasivaSchema = z.object({
  creados: z.array(z.string().uuid()),
  omitidos: z.array(
    z.object({
      clienteId: z.string().uuid(),
      motivo: MotivoOmisionCargaMasivaSchema,
    }),
  ),
});

export type ResultadoCargaMasiva = z.infer<typeof ResultadoCargaMasivaSchema>;
