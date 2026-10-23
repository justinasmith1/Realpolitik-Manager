import { useQuery } from '@tanstack/react-query';

import {
  clienteDetalleQueryKey,
  esIdDeRuta,
  obtenerCliente,
} from '@/modules/clientes/api/clientes.api';

/**
 * Un cliente por id (`GET /clientes/:id`). La key es `['clientes', 'detalle', clienteId]`.
 *
 * `enabled: false`, o un id vacío o que no es UUID, no dispara el pedido. No guarda una copia
 * propia de los datos: carga, error, éxito y cancelación son el estado de TanStack Query.
 * Sin `placeholderData`: al cambiar de cliente no se muestra el anterior.
 */
export function useCliente(clienteId?: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: clienteDetalleQueryKey(clienteId ?? ''),
    queryFn: ({ signal }) => obtenerCliente(clienteId ?? '', signal),
    enabled: enabled && esIdDeRuta(clienteId),
  });
}
