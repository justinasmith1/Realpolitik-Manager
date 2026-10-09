import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  clientesQueryKey,
  listarClientes,
  type FiltrosClientes,
} from '@/modules/clientes/api/clientes.api';

/**
 * Listado de clientes según los filtros. La key cuelga de `clientesQueryKey`, así un alta
 * lo invalida. Mientras llega la respuesta de un filtro nuevo se sigue mostrando la
 * anterior (`placeholderData`), para que la tabla no se vacíe al filtrar.
 */
export function useClientes(filtros: FiltrosClientes) {
  return useQuery({
    queryKey: [...clientesQueryKey, 'lista', filtros],
    queryFn: ({ signal }) => listarClientes(filtros, signal),
    placeholderData: keepPreviousData,
  });
}
