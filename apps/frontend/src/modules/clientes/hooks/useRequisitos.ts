import { useQuery } from '@tanstack/react-query';

import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import { listarRequisitos, requisitosQueryKey } from '@/modules/clientes/api/requisitos.api';

/**
 * Matriz de un cliente. La key es `['clientes', clienteId, 'requisitos']`, distinta de la de
 * cualquier otro cliente.
 *
 * Una lista vacía es éxito con datos (`isSuccess` y `data` de largo 0): la matriz todavía no
 * está configurada, no es un error ni un estado aparte. `enabled: false` o un id que no es UUID
 * no consultan. El `AbortSignal` de la query cancela el pedido si el componente se va.
 */
export function useRequisitos(clienteId?: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: requisitosQueryKey(clienteId ?? ''),
    queryFn: ({ signal }) => listarRequisitos(clienteId ?? '', signal),
    enabled: enabled && esIdDeRuta(clienteId),
  });
}
