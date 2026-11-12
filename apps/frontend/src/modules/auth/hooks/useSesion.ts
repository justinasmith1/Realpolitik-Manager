import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cerrarSesion } from '@/modules/auth/api/auth.api';
import { avisoDeErrorDeAuth, clasificarErrorDeAuth } from '@/modules/auth/erroresDeAuth';
import { tienePermiso, type Permiso } from '@/modules/auth/permisos';
import { META_DE_SESION, opcionesDeSesion, terminarSesion } from '@/modules/auth/sesion';

/** El estado de la sesión (ver `sesion.ts`): pendiente, con usuario, `null` o en error. */
export function useSesion() {
  return useQuery(opcionesDeSesion());
}

/** Si el rol de la sesión tiene el permiso: para ocultar acciones. La API decide de verdad. */
export function usePermiso(permiso: Permiso): boolean {
  const { data } = useSesion();
  return data ? tienePermiso(data.usuario.rol, permiso) : false;
}

export const MENSAJE_LOGOUT_FALLIDO =
  'No pudimos cerrar la sesión: seguís con la sesión abierta. Probá de nuevo.';

/**
 * Cierre de sesión. La sesión local termina SOLO cuando el servidor lo confirma: con el 204, o
 * con un 401 (ya no había sesión). Con un 503, la red caída u otro fallo, la sesión sigue en el
 * servidor y la interfaz no dice lo contrario: informa el error y deja reintentar.
 */
export function useCerrarSesion() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: cerrarSesion,
    meta: META_DE_SESION,
    onSuccess: () => terminarSesion(queryClient, 'cerrada'),
    onError: (error) => {
      if (clasificarErrorDeAuth(error).clase === 'sin-sesion') {
        terminarSesion(queryClient, 'cerrada');
      }
    },
  });

  const clasificado = mutation.isError ? clasificarErrorDeAuth(mutation.error) : null;
  const fallo = clasificado !== null && clasificado.clase !== 'sin-sesion';
  return {
    cerrar: () => {
      if (!mutation.isPending) {
        mutation.mutate();
      }
    },
    cerrando: mutation.isPending,
    /** Texto del error si el cierre no se pudo confirmar; `null` si no hubo error. */
    error: !fallo
      ? null
      : clasificado.clase === 'red' || clasificado.clase === 'no-disponible'
        ? `${MENSAJE_LOGOUT_FALLIDO}`
        : `${avisoDeErrorDeAuth(clasificado).texto}`,
    descartarError: mutation.reset,
  };
}
