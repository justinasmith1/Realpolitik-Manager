import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';
import { crearRequisito, type NuevoRequisito } from '@/modules/clientes/api/requisitos.api';
import {
  invalidarConsultasDeMatriz,
  invalidarTrasFalloDeRequisito,
} from '@/modules/clientes/hooks/invalidarMatriz';

interface AltaDeRequisito {
  clienteId: string;
  datos: NuevoRequisito;
}

const crearRequisitoMutationKey = [...clientesQueryKey, 'requisito', 'crear'] as const;

/**
 * Alta de un requisito. `clienteId` va en las variables, no escondido en un cierre, así dos
 * altas de clientes distintos no se pisan al invalidar. Sin reintentos: un POST no se repite solo.
 *
 * Si sale bien, refresca la matriz, el detalle y los listados de ese cliente. Un 404 o un cliente
 * que dejó de estar activo también refrescan: la pantalla quedó vieja. Un duplicado refresca solo
 * la matriz. Cualquier otro error no cambió la base: no se invalida y el error queda en la mutation.
 */
export function useCrearRequisito() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: crearRequisitoMutationKey,
    mutationFn: ({ clienteId, datos }: AltaDeRequisito) => crearRequisito(clienteId, datos),
    retry: false,
    onSuccess: (_requisito, { clienteId }) => invalidarConsultasDeMatriz(queryClient, clienteId),
    onError: (error, { clienteId }) => invalidarTrasFalloDeRequisito(queryClient, clienteId, error),
  });
}
