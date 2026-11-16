import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  cambiarEstadoUsuario,
  hayQueReleerElListado,
  interpretarFalloDeUsuario,
  usuariosQueryKey,
} from '@/modules/usuarios/api/usuarios.api';

interface CambioDeEstado {
  id: string;
  activo: boolean;
}

/**
 * Mutation de desactivar o reactivar una cuenta. Igual que en tipos de documento: si sale bien,
 * invalida el listado; si falla, solo cuando puede haber quedado desactualizado (un resultado sin
 * confirmar, una cuenta que ya no existe, un conflicto). Sin reintentos: un PATCH no se repite solo.
 */
export function useCambiarEstadoUsuario() {
  const queryClient = useQueryClient();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: usuariosQueryKey });

  return useMutation({
    mutationFn: ({ id, activo }: CambioDeEstado) => cambiarEstadoUsuario(id, activo),
    retry: false,
    onSuccess: refrescar,
    onError: (error) =>
      hayQueReleerElListado(interpretarFalloDeUsuario(error)) ? refrescar() : undefined,
  });
}
