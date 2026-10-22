import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  actualizarTipoDocumento,
  interpretarFalloEdicionTipoDocumento,
  tiposDocumentoQueryKey,
  type CambiosTipoDocumento,
} from '@/modules/tipos-documento/api/tipos-documento.api';

interface EdicionDeTipoDocumento {
  id: string;
  datos: CambiosTipoDocumento;
}

/**
 * Mutation de la edición de un tipo de documento. Si sale bien, invalida las queries del
 * catálogo para que el listado muestre los cambios. Si falla, solo cuando el tipo ya no existe
 * (`404` del contrato): el listado tiene que dejar de mostrarlo. Ante cualquier otro error (sin
 * conexión, 500, nombre duplicado, datos inválidos) no cambió nada en la base, y volver a pedir
 * el listado solo sumaría pedidos. Sin reintentos: un PATCH no se repite solo.
 */
export function useActualizarTipoDocumento() {
  const queryClient = useQueryClient();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: tiposDocumentoQueryKey });

  return useMutation({
    mutationFn: ({ id, datos }: EdicionDeTipoDocumento) => actualizarTipoDocumento(id, datos),
    retry: false,
    onSuccess: refrescar,
    onError: (error) =>
      interpretarFalloEdicionTipoDocumento(error).tipo === 'no-existe' ? refrescar() : undefined,
  });
}
