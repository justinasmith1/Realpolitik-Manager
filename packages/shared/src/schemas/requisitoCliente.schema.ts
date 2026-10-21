import { z } from 'zod';

import { CANTIDAD_MAX, DIA_MAX, DIA_MIN, problemaDeDias } from '../utils/diasAproximados.js';

import { exigirAlgunCampo, textoOpcional } from './campos.js';
import { CanalEntrega } from './cliente.schema.js';

// Largo de `RequisitoCliente.nota` (`apps/backend/prisma/schema.prisma`).
const NOTA_MAX = 500;

/** Cuántos documentos de este tipo por rendición: entero de 1 a `CANTIDAD_MAX` (provisorio). */
export const CantidadSchema = z
  .number({
    required_error: 'Ingresá la cantidad.',
    invalid_type_error: `La cantidad debe ser un número entero entre 1 y ${CANTIDAD_MAX}.`,
  })
  .int({ message: `La cantidad debe ser un número entero entre 1 y ${CANTIDAD_MAX}.` })
  .min(1, { message: 'La cantidad debe ser al menos 1.' })
  .max(CANTIDAD_MAX, { message: `La cantidad no puede superar ${CANTIDAD_MAX}.` });

const MENSAJE_DIA = `Cada día aproximado debe ser un número entero entre ${DIA_MIN} y ${DIA_MAX}.`;

/** Un día del mes. Un `NaN` (días mal escritos en el front) cae en `invalid_type_error`. */
const DiaSchema = z
  .number({ required_error: MENSAJE_DIA, invalid_type_error: MENSAJE_DIA })
  .int({ message: MENSAJE_DIA })
  .min(DIA_MIN, { message: MENSAJE_DIA })
  .max(DIA_MAX, { message: MENSAJE_DIA });

/**
 * Días aproximados de un requisito, uno por documento. Se admiten repetidos (un cliente puede
 * pedir un documento varias veces el mismo día) y se guardan **ordenados de menor a mayor**, para
 * que el ítem N del checklist tome siempre el día N. El tope de largo corta una lista enorme antes
 * de ordenarla; que tenga `cantidad` elementos lo valida `validarDiasCoherentes`.
 */
export const DiasAproximadosSchema = z
  .array(DiaSchema, { invalid_type_error: 'Los días aproximados deben ser una lista de números.' })
  .max(CANTIDAD_MAX, {
    message: `No puede haber más de ${CANTIDAD_MAX} días aproximados.`,
  })
  .transform((dias) => [...dias].sort((a, b) => a - b));

/** Canal propio del requisito, o `null` para usar el del cliente. */
export const CanalPropioSchema = z
  .enum(CanalEntrega.options, {
    errorMap: () => ({ message: 'El canal de entrega debe ser CORREO, PORTAL_WEB o WHATSAPP.' }),
  })
  .nullable();

/** Nota del requisito: hasta 500 caracteres; vacía = `null`. */
export const NotaSchema = textoOpcional({ nombre: 'La nota', max: NOTA_MAX }).nullable();

/** Tipo de documento del requisito: un uuid. */
export const TipoDocumentoIdSchema = z
  .string({ required_error: 'Elegí el tipo de documento.' })
  .uuid({ message: 'El tipo de documento debe ser un UUID válido.' });

export interface DatosDias {
  cantidad?: number | undefined;
  diasAproximados?: number[] | undefined;
}

/**
 * Los días tienen que estar vacíos o ser exactamente `cantidad`. Solo se valida si el pedido trae
 * ambos: en un PATCH que cambia uno solo, la otra mitad está guardada y la valida el backend
 * sobre el estado resultante con `problemaDeDias`.
 *
 * Tampoco se evalúa si la cantidad ya es inválida (`CantidadSchema`): comparar los días contra una
 * cantidad que se va a rechazar sumaría un segundo error en `diasAproximados`, y el error útil es
 * el de `cantidad`.
 */
export function validarDiasCoherentes(datos: DatosDias, ctx: z.RefinementCtx): void {
  if (datos.cantidad === undefined || datos.diasAproximados === undefined) return;
  if (!CantidadSchema.safeParse(datos.cantidad).success) return;
  const problema = problemaDeDias(datos.cantidad, datos.diasAproximados);
  if (problema !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['diasAproximados'], message: problema });
  }
}

/**
 * Requisito tal como lo devuelve la API. Es una entidad de lectura: no reordena los días ni exige
 * su coherencia con la cantidad, para que un registro anterior a esas reglas no rompa un listado.
 * `canalEntrega` es el valor guardado (`null` = usa el del cliente), no el canal resuelto.
 */
export const RequisitoClienteSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
  clienteId: z.string().uuid({ message: 'El ID del cliente debe ser un UUID válido.' }),
  tipoDocumento: z.object({
    id: z.string().uuid(),
    nombre: z.string(),
    activo: z.boolean(),
  }),
  cantidad: z.number().int().min(1),
  diasAproximados: z.array(z.number().int()),
  canalEntrega: CanalEntrega.nullable(),
  nota: z.string().nullable(),
  creadoEn: z.coerce.date(),
  actualizadoEn: z.coerce.date(),
});

export type RequisitoCliente = z.infer<typeof RequisitoClienteSchema>;

/**
 * Cuerpo de `POST /clientes/:id/requisitos`. Solo `tipoDocumentoId` es obligatorio. `clienteId`,
 * las fechas y la baja lógica no se envían: si llegan, se descartan.
 *
 * Que el tipo esté activo y que el cliente no tenga ya uno del mismo tipo lo valida el backend.
 */
export const CreateRequisitoClienteSchema = z
  .object({
    tipoDocumentoId: TipoDocumentoIdSchema,
    cantidad: CantidadSchema.default(1),
    diasAproximados: DiasAproximadosSchema.default([]),
    canalEntrega: CanalPropioSchema.default(null),
    nota: NotaSchema.default(null),
  })
  .superRefine(validarDiasCoherentes);

export type CreateRequisitoClienteDto = z.infer<typeof CreateRequisitoClienteSchema>;

/**
 * Cuerpo de `PATCH /clientes/:id/requisitos/:requisitoId`: cualquier subconjunto de `cantidad`,
 * `diasAproximados`, `canalEntrega` y `nota`, con al menos uno. Sin defaults: ausente = no
 * modificar. `canalEntrega: null` quita el override y `nota: null` borra la nota. El tipo no es
 * editable: `tipoDocumentoId` se descarta si llega.
 *
 * La coherencia entre días y cantidad se valida acá solo si ambos vienen en el pedido; el backend
 * la completa sobre el estado resultante (lo enviado más lo guardado).
 */
export const UpdateRequisitoClienteSchema = z
  .object({
    cantidad: CantidadSchema,
    diasAproximados: DiasAproximadosSchema,
    canalEntrega: CanalPropioSchema,
    nota: NotaSchema,
  })
  .partial()
  .superRefine((datos, ctx) => {
    exigirAlgunCampo(datos, ctx);
    validarDiasCoherentes(datos, ctx);
  });

export type UpdateRequisitoClienteDto = z.infer<typeof UpdateRequisitoClienteSchema>;
