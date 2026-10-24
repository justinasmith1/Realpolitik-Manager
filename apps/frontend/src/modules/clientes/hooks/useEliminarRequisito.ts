import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';
import { eliminarRequisito } from '@/modules/clientes/api/requisitos.api';
import {
  invalidarConsultasDeMatriz,
  invalidarTrasFalloDeRequisito,
} from '@/modules/clientes/hooks/invalidarMatriz';

interface BajaDeRequisito {
  clienteId: string;
  requisitoId: string;
}

const eliminarRequisitoMutationKey = [...clientesQueryKey, 'requisito', 'eliminar'] as const;

/**
 * Baja lógica de un requisito (DELETE 204). No borra la fila en el cliente HTTP: el backend
 * marca `isDeleted`. Sin reintentos: un DELETE no se repite solo.
 *
 * Al salir bien, la matriz, el detalle y los listados de ese cliente se vuelven a pedir, porque
 * `matrizConfigurada` vuelve a `false` si era el último requisito activo. Un 404 o un cliente que
 * dejó de estar activo también refrescan. Otros errores no invalidan.
 */
export function useEliminarRequisito() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: eliminarRequisitoMutationKey,
    mutationFn: ({ clienteId, requisitoId }: BajaDeRequisito) =>
      eliminarRequisito(clienteId, requisitoId),
    retry: false,
    onSuccess: (_vacio, { clienteId }) => invalidarConsultasDeMatriz(queryClient, clienteId),
    onError: (error, { clienteId }) => invalidarTrasFalloDeRequisito(queryClient, clienteId, error),
  });
}
