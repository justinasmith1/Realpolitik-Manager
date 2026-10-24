import type { CargaMasivaRequisitoDto, ResultadoCargaMasiva } from '@realpolitik/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  clienteDetalleQueryKey,
  clientesListaQueryKey,
  clientesQueryKey,
} from '@/modules/clientes/api/clientes.api';
import { cargarRequisitosMasivo, requisitosQueryKey } from '@/modules/clientes/api/requisitos.api';

export const cargarRequisitosMasivoMutationKey = [
  ...clientesQueryKey,
  'requisito',
  'carga-masiva',
] as const;

/**
 * Hook de React Query para la carga masiva de requisitos a varios clientes (HU2.3).
 *
 * Al tener éxito, invalida la matriz y el detalle de cada cliente que recibió el requisito o fue
 * afectado, además de refrescar la lista general de clientes (`matrizConfigurada`).
 */
export function useCargarRequisitosMasivo() {
  const queryClient = useQueryClient();

  return useMutation<ResultadoCargaMasiva, Error, CargaMasivaRequisitoDto>({
    mutationKey: cargarRequisitosMasivoMutationKey,
    mutationFn: (datos: CargaMasivaRequisitoDto) => cargarRequisitosMasivo(datos),
    retry: false,
    onSuccess: (resultado, variables) => {
      // Invalida todos los clientes procesados (creados u omitidos por si hubo cambios)
      const idsAfectados = new Set<string>([
        ...resultado.creados,
        ...variables.clientes.map((c: CargaMasivaRequisitoDto['clientes'][number]) => c.clienteId),
      ]);

      const invalidaciones: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: clientesListaQueryKey }),
      ];

      for (const clienteId of idsAfectados) {
        invalidaciones.push(
          queryClient.invalidateQueries({ queryKey: requisitosQueryKey(clienteId) }),
          queryClient.invalidateQueries({ queryKey: clienteDetalleQueryKey(clienteId) }),
        );
      }

      return Promise.all(invalidaciones);
    },
  });
}
