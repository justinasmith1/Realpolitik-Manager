import type { ObservacionesClienteDto } from '@realpolitik/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import {
  guardarObservacionesCliente,
  observacionesClienteQueryKey,
  obtenerObservacionesCliente,
} from '@/modules/clientes/api/observaciones-cliente.api';

/** Consulta las observaciones internas de un cliente. */
export function useObservacionesCliente(clienteId?: string) {
  return useQuery({
    queryKey: observacionesClienteQueryKey(clienteId ?? ''),
    queryFn: ({ signal }) => obtenerObservacionesCliente(clienteId ?? '', signal),
    enabled: esIdDeRuta(clienteId),
  });
}

/**
 * Guarda la nota de un cliente. Sin reintentos: un guardado no se repite solo. Si sale bien, la
 * consulta queda con lo que devolvió el servidor, sin otro pedido.
 */
export function useGuardarObservacionesCliente() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clienteId, datos }: { clienteId: string; datos: ObservacionesClienteDto }) =>
      guardarObservacionesCliente(clienteId, datos),
    retry: false,
    onSuccess: (resultado, { clienteId }) => {
      queryClient.setQueryData(observacionesClienteQueryKey(clienteId), resultado);
    },
  });
}
