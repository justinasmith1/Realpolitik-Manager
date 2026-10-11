import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '@/lib/http';
import {
  cambiarEstadoCliente,
  clientesQueryKey,
  type EstadoAsignable,
} from '@/modules/clientes/api/clientes.api';

interface CambioDeEstado {
  id: string;
  estado: EstadoAsignable;
}

const cambioDeEstadoKey = [...clientesQueryKey, 'cambiar-estado'] as const;

// Ante un 404 el cliente ya no existe (o se dio de baja): el listado tiene que dejar de
// mostrarlo. Ante cualquier otro error (sin conexión, 500…) no cambió nada en la base, así que
// volver a pedir el listado solo sumaría pedidos que probablemente también fallen.
const esNoExiste = (error: unknown) =>
  error instanceof ApiClientError && error.kind === 'http' && error.status === 404;

/**
 * Mutation de desactivar o reactivar un cliente (HU1.8). Si sale bien, invalida las queries de
 * clientes para que el listado se vuelva a pedir; si falla, solo ante un 404. Sin reintentos:
 * un PATCH no se repite solo.
 */
export function useCambiarEstadoCliente() {
  const queryClient = useQueryClient();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: clientesQueryKey });

  return useMutation({
    mutationKey: cambioDeEstadoKey,
    mutationFn: ({ id, estado }: CambioDeEstado) => cambiarEstadoCliente(id, estado),
    retry: false,
    onSuccess: refrescar,
    onError: (error) => (esNoExiste(error) ? refrescar() : undefined),
  });
}

/**
 * Clientes con un cambio de estado en curso, de TODAS las mutations pendientes. La mutation
 * de `useCambiarEstadoCliente` solo recuerda el último pedido: si se cambia A y enseguida B,
 * `variables` pasa a ser B mientras A sigue en vuelo, y A volvería a quedar habilitado.
 */
export function useClientesCambiandoEstado(): readonly string[] {
  return useMutationState({
    filters: { mutationKey: cambioDeEstadoKey, status: 'pending' },
    select: (mutation) => (mutation.state.variables as CambioDeEstado | undefined)?.id ?? '',
  }).filter((id) => id !== '');
}
