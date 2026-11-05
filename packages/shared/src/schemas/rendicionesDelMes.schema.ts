import { z } from 'zod';

import { ClienteSector, ClienteSubtipoPublico } from './cliente.schema.js';
import { enteroDeQuery } from './listarRendicionesQuery.schema.js';
import {
  AnioSchema,
  EstadoRendicion,
  MENSAJE_ANIO,
  MENSAJE_MES,
  MesSchema,
} from './rendicion.schema.js';

// Pantalla Rendiciones (HU3.2): todas las rendiciones activas de un mes, de todos los clientes.

/**
 * Parámetros de `GET /rendiciones` (query string): el período, obligatorio. `anio` de 2020 a 2100
 * y `mes` de 1 a 12, con las mismas validaciones que el período de la rendición. Se entregan ya
 * como números.
 */
export const ListarRendicionesDelMesQuerySchema = z.object({
  anio: enteroDeQuery(AnioSchema, MENSAJE_ANIO),
  mes: enteroDeQuery(MesSchema, MENSAJE_MES),
});

export type ListarRendicionesDelMesQuery = z.infer<typeof ListarRendicionesDelMesQuerySchema>;

/** Los estados que muestran la fecha de su último paso: los que ya salieron hacia el organismo. */
export const ESTADOS_CON_FECHA = ['ENVIADA', 'APROBADA', 'RECHAZADA'] as const;

/**
 * Una fila de la pantalla: la rendición con su cliente y su avance.
 *
 * - `cliente`: el nombre corto (`denominacion`) y la tipología (sector y, si es público, subtipo).
 * - `avance`: ítems reunidos, el total y los que faltan (`total - reunidos`).
 * - `ultimoPaso`: en una rendición Enviada, Aprobada o Rechazada, ese estado y la fecha de la
 *   entrada del historial que la llevó ahí. `null` en las En curso y Completa.
 */
export const RendicionDelMesSchema = z.object({
  id: z.string().uuid(),
  clienteId: z.string().uuid(),
  cliente: z.object({
    denominacion: z.string(),
    sector: ClienteSector,
    subtipo: ClienteSubtipoPublico.nullable(),
  }),
  numeroFactura: z.string(),
  estado: EstadoRendicion,
  avance: z.object({
    reunidos: z.number().int().min(0),
    total: z.number().int().min(0),
    faltantes: z.number().int().min(0),
  }),
  ultimoPaso: z
    .object({
      estado: z.enum(ESTADOS_CON_FECHA),
      fecha: z.coerce.date(),
    })
    .nullable(),
});

export type RendicionDelMes = z.infer<typeof RendicionDelMesSchema>;
