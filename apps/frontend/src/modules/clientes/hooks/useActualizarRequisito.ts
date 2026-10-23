import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clientesQueryKey } from '@/modules/clientes/api/clientes.api';
import { actualizarRequisito, type CambiosRequisito } from '@/modules/clientes/api/requisitos.api';
import {
  invalidarConsultasDeMatriz,
  invalidarTrasFalloDeRequisito,
} from '@/modules/clientes/hooks/invalidarMatriz';

interface EdicionDeRequisito {
  clienteId: string;
  requisitoId: string;
  datos: CambiosRequisito;
}

const actualizarRequisitoMutationKey = [...clientesQueryKey, 'requisito', 'actualizar'] as const;

/**
 * Edición parcial de un requisito. Las variables nombran al cliente y al requisito: el éxito
 * invalida la matriz de ese cliente, no la de otro. Sin reintentos: un PATCH no se repite solo.
 *
 * Un 404 o un cliente que dejó de estar activo refrescan lo que la pantalla podía estar mostrando.
 * El resto de los errores se conserva, sin invalidar.
 */
export function useActualizarRequisito() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: actualizarRequisitoMutationKey,
    mutationFn: ({ clienteId, requisitoId, datos }: EdicionDeRequisito) =>
      actualizarRequisito(clienteId, requisitoId, datos),
    retry: false,
    onSuccess: (_requisito, { clienteId }) => invalidarConsultasDeMatriz(queryClient, clienteId),
    onError: (error, { clienteId }) => invalidarTrasFalloDeRequisito(queryClient, clienteId, error),
  });
}
