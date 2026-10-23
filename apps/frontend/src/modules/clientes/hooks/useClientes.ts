import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  listaClientesQueryKey,
  listarClientes,
  type FiltrosClientes,
} from '@/modules/clientes/api/clientes.api';

/**
 * Listado de clientes según los filtros. La key es `['clientes', 'lista', filtros]`, así un
 * alta (que invalida `['clientes']`) lo vuelve a pedir. Mientras llega la respuesta de un
 * filtro nuevo se sigue mostrando la anterior (`placeholderData`), para que la tabla no se
 * vacíe al filtrar. `matrizConfigurada: true` y `false` son consultas distintas.
 */
export function useClientes(filtros: FiltrosClientes, { enabled = true } = {}) {
  return useQuery({
    queryKey: listaClientesQueryKey(filtros),
    queryFn: ({ signal }) => listarClientes(filtros, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}
