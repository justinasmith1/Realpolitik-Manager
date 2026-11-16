import type { ActualizarUsuarioDto, SesionActual } from '@realpolitik/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { CLAVE_SESION, revalidarSesion } from '@/modules/auth/sesion';
import {
  actualizarUsuario,
  hayQueReleerElListado,
  interpretarFalloDeUsuario,
  usuariosQueryKey,
} from '@/modules/usuarios/api/usuarios.api';

interface EdicionDeUsuario {
  id: string;
  cambios: ActualizarUsuarioDto;
}

/**
 * Mutation de la edición (nombre y/o rol). Si sale bien, invalida el listado; si quien cambió su
 * nombre es la persona de la sesión, además se vuelve a pedir `GET /auth/sesion`, para que el menú
 * de cuenta lo muestre (la sesión no se cierra ni rota). Si falla, invalida solo cuando el listado
 * puede haber quedado desactualizado (ver `hayQueReleerElListado`). Sin reintentos.
 */
export function useActualizarUsuario() {
  const queryClient = useQueryClient();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: usuariosQueryKey });

  return useMutation({
    mutationFn: ({ id, cambios }: EdicionDeUsuario) => actualizarUsuario(id, cambios),
    retry: false,
    onSuccess: ({ usuario, modificados }) => {
      const propia = queryClient.getQueryData<SesionActual | null>(CLAVE_SESION)?.usuario.id;
      if (usuario.id === propia && modificados.includes('nombre')) {
        revalidarSesion(queryClient, { descartar: false });
      }
      return refrescar();
    },
    onError: (error) =>
      hayQueReleerElListado(interpretarFalloDeUsuario(error)) ? refrescar() : undefined,
  });
}
