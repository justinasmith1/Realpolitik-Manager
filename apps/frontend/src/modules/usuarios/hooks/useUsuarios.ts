import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  listaUsuariosQueryKey,
  listarUsuarios,
  type FiltrosUsuarios,
} from '@/modules/usuarios/api/usuarios.api';

/**
 * Listado de cuentas (HU4.5). La key cuelga de `usuariosQueryKey`: cualquier escritura la invalida.
 *
 * Como en tipos de documento, mientras llega la respuesta de un filtro nuevo se sigue mostrando la
 * anterior (`placeholderData`); en ese lapso `isPlaceholderData` es `true` y la interfaz no debe
 * presentarla como el resultado del filtro nuevo. Los reintentos son los del QueryClient de la app.
 */
export function useUsuarios(filtros: FiltrosUsuarios) {
  return useQuery({
    queryKey: listaUsuariosQueryKey(filtros),
    queryFn: ({ signal }) => listarUsuarios(filtros, signal),
    placeholderData: keepPreviousData,
  });
}
