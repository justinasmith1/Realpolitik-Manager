import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { guardarContactos, listarContactos, type ContactoAGuardar } from '../api/contactos.api';

/**
 * Raíz propia, separada de `['clientes']`: un alta, una edición o un cambio de estado de
 * cliente invalidan `['clientes']` y no deben volver a pedir los contactos de nadie.
 */
export const contactosQueryKey = (clienteId: string) => ['contactos', clienteId] as const;

/**
 * Contactos de un cliente, para el editor.
 *
 * Es una superficie de EDICIÓN: lo que se carga al abrir es el punto de partida del formulario,
 * que no se vuelve a inicializar si llegan datos nuevos. Por eso:
 * - `refetchOnWindowFocus: false`: volver a la pestaña no dispara un pedido cuyo resultado el
 *   formulario ignoraría de todos modos (y que antes lo reseteaba, perdiendo lo escrito).
 * - `gcTime: 0`: al cerrar el panel no queda caché; la próxima apertura siempre parte de los
 *   datos actuales y nunca de una copia vieja.
 */
export function useContactos(clienteId: string) {
  return useQuery({
    queryKey: contactosQueryKey(clienteId),
    queryFn: ({ signal }) => listarContactos(clienteId, signal),
    enabled: clienteId !== '',
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
}

/**
 * Guarda TODOS los contactos de un cliente con una sola request (`PUT`). Al éxito deja la
 * colección que devolvió el servidor en el caché de esa query: no hay invalidaciones ni pedidos
 * extra. Sin reintentos: un PUT no se repite solo.
 */
export function useGuardarContactos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clienteId, contactos }: { clienteId: string; contactos: ContactoAGuardar[] }) =>
      guardarContactos(clienteId, contactos),
    onSuccess: (guardados, { clienteId }) => {
      queryClient.setQueryData(contactosQueryKey(clienteId), guardados);
    },
  });
}
