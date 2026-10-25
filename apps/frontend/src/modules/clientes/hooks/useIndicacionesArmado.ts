import type { IndicacionesArmadoDto } from '@realpolitik/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import {
  guardarIndicacionesArmado,
  indicacionesArmadoQueryKey,
  obtenerIndicacionesArmado,
} from '@/modules/clientes/api/indicaciones-armado.api';

/**
 * Consulta las indicaciones de armado de un cliente.
 */
export function useIndicacionesArmado(
  clienteId?: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: indicacionesArmadoQueryKey(clienteId ?? ''),
    queryFn: ({ signal }) => obtenerIndicacionesArmado(clienteId ?? '', signal),
    enabled: enabled && esIdDeRuta(clienteId),
  });
}

/**
 * Mutación para guardar o actualizar las indicaciones de armado de un cliente.
 */
export function useGuardarIndicacionesArmado() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clienteId, datos }: { clienteId: string; datos: IndicacionesArmadoDto }) =>
      guardarIndicacionesArmado(clienteId, datos),
    onSuccess: (_resultado, { clienteId }) => {
      void queryClient.invalidateQueries({
        queryKey: indicacionesArmadoQueryKey(clienteId),
      });
    },
  });
}
