import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clientesQueryKey, crearCliente } from '@/modules/clientes/api/clientes.api';

/**
 * Mutation del alta de cliente. Al crear, invalida las queries de clientes para que el
 * catálogo se vuelva a pedir cuando exista. Usa el default de TanStack Query para
 * mutations: sin reintentos, así un POST nunca se repite solo.
 */
export function useCrearCliente() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: crearCliente,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientesQueryKey }),
  });
}
