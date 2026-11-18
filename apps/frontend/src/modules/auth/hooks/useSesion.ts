import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cerrarSesion } from '@/modules/auth/api/auth.api';
import { clasificarErrorDeAuth } from '@/modules/auth/erroresDeAuth';
import { tienePermiso, type Permiso } from '@/modules/auth/permisos';
import { META_DE_SESION, opcionesDeSesion, terminarSesion } from '@/modules/auth/sesion';

/** El estado de la sesión (ver `sesion.ts`): pendiente, con usuario, `null` o en error. */
export function useSesion() {
  return useQuery(opcionesDeSesion(useQueryClient()));
}

/** Si el rol de la sesión tiene el permiso: para ocultar acciones. La API decide de verdad. */
export function usePermiso(permiso: Permiso): boolean {
  const { data } = useSesion();
  return data ? tienePermiso(data.usuario.rol, permiso) : false;
}

export const MENSAJE_LOGOUT_FALLIDO =
  'No pudimos cerrar la sesión: seguís con la sesión abierta. Probá de nuevo.';
/** El servidor rechazó el origen del pedido (403): reintentar sin recargar daría lo mismo. */
export const MENSAJE_LOGOUT_FALLIDO_ORIGEN =
  'No pudimos cerrar la sesión: seguís con la sesión abierta. Recargá la página y probá de nuevo.';

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
    /**
     * Texto del error si el cierre no se pudo confirmar; `null` si no hubo error. Sea cual sea la
     * causa (503, red, origen, un fallo inesperado), dice que la sesión sigue abierta: el servidor
     * no confirmó el cierre.
     */
    error: !fallo
      ? null
      : clasificado.clase === 'origen'
        ? MENSAJE_LOGOUT_FALLIDO_ORIGEN
        : MENSAJE_LOGOUT_FALLIDO,
    descartarError: mutation.reset,
  };
}
