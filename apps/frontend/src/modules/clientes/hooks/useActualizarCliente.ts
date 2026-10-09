import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  actualizarCliente,
  clientesQueryKey,
  type CambiosCliente,
} from '@/modules/clientes/api/clientes.api';

/**
 * Mutation de la edición de cliente. Al guardar, invalida las queries de clientes para que
 * el listado se vuelva a pedir y muestre los cambios. Sin reintentos: un PATCH no se repite solo.
 */
export function useActualizarCliente() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: CambiosCliente }) =>
      actualizarCliente(id, datos),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: clientesQueryKey }),
  });
}
