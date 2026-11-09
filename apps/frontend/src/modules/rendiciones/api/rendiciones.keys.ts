import type { ListarRendicionesQuery } from '@realpolitik/shared';

import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';

/**
 * Todas las query keys de rendiciones, en un solo lugar. Dos ramas:
 *
 * - **De un cliente** (`['clientes', clienteId, 'rendiciones', …]`): su listado, sus detalles y la
 *   última OC. Cuelgan de la key de clientes, como la matriz: invalidar `deCliente(id)` refresca
 *   todas las de ese cliente y no toca las de otro.
 * - **De la pantalla Rendiciones** (`['rendiciones', …]`): el listado de un mes y las atrasadas, de
 *   todos los clientes. Invalidar `pantalla` las refresca todas.
 *
 * Lo que cambia la vigencia o el estado de una rendición afecta a las dos ramas: se invalida con
 * `invalidarRendiciones` (en `hooks/invalidarRendiciones.ts`).
 */
const deCliente = (clienteId: string) => [...clientesQueryKey, clienteId, 'rendiciones'] as const;

export const rendicionesKeys = {
  deCliente,
  lista: (clienteId: string, filtros: ListarRendicionesQuery) =>
    [...deCliente(clienteId), 'lista', filtros] as const,
  detalle: (clienteId: string, rendicionId: string) =>
    [...deCliente(clienteId), 'detalle', rendicionId] as const,
  ultimaOc: (clienteId: string) => [...deCliente(clienteId), 'ultima-oc'] as const,

  pantalla: ['rendiciones'] as const,
  /** Las rendiciones activas de un mes, de todos los clientes (HU3.2). */
  delMes: ({ anio, mes }: { anio: number; mes: number }) =>
    ['rendiciones', 'mes', anio, mes] as const,
  /** Las atrasadas de cualquier mes (HU3.4): no dependen del mes elegido. */
  atrasadas: ['rendiciones', 'atrasadas'] as const,
};
