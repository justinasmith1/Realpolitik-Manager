import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  crearTipoDocumento,
  tiposDocumentoQueryKey,
} from '@/modules/tipos-documento/api/tipos-documento.api';

/**
 * Mutation del alta de un tipo de documento. Al crear, invalida las queries del catálogo para
 * que el listado se vuelva a pedir. Ante un error no invalida nada: no cambió nada en la base.
 * Sin reintentos: un POST nunca se repite solo.
 */
export function useCrearTipoDocumento() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: crearTipoDocumento,
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tiposDocumentoQueryKey }),
  });
}
