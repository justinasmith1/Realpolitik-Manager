import type { RequisitoCliente } from '@realpolitik/shared';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listarRequisitos, requisitosQueryKey } from '@/modules/clientes/api/requisitos.api';

/**
 * Hook para consultar en paralelo los requisitos de una lista de IDs de clientes.
 * Usa useQueries de TanStack Query para cachear cada cliente bajo su propia key
 * `['clientes', clienteId, 'requisitos']`.
 */
export function useRequisitosMultiplesClientes(
  clienteIds: readonly string[],
  { enabled = true } = {},
) {
  const queries = useQueries({
    queries: clienteIds.map((id) => ({
      queryKey: requisitosQueryKey(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) => listarRequisitos(id, signal),
      enabled: enabled && Boolean(id),
      staleTime: 1000 * 60 * 2,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  const requisitosPorCliente = useMemo(() => {
    const mapa = new Map<string, RequisitoCliente[]>();
    clienteIds.forEach((id, index) => {
      const q = queries[index];
      if (q?.data) {
        mapa.set(id, q.data);
      }
    });
    return mapa;
  }, [clienteIds, queries]);

  return {
    requisitosPorCliente,
    isLoading,
  };
}
