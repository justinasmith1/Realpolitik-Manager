import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  cambiarEstadoCliente,
  clientesQueryKey,
  type EstadoAsignable,
} from '@/modules/clientes/api/clientes.api';

/**
 * Mutation de desactivar o reactivar un cliente (HU1.8). Al terminar invalida las queries de
 * clientes para que el listado se vuelva a pedir, y lo hace también si falla: ante un 404 el
 * cliente ya no existe y el listado tiene que dejar de mostrarlo. Sin reintentos: un PATCH
 * no se repite solo.
 */
export function useCambiarEstadoCliente() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: EstadoAsignable }) =>
      cambiarEstadoCliente(id, estado),
    onSettled: () => queryClient.invalidateQueries({ queryKey: clientesQueryKey }),
  });
}
