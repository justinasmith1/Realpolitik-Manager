import { keepPreviousData, useQuery } from '@tanstack/react-query';

import {
  listaTiposDocumentoQueryKey,
  listarTiposDocumento,
  type FiltrosTiposDocumento,
} from '@/modules/tipos-documento/api/tipos-documento.api';

/**
 * Listado del catálogo de tipos de documento. La key cuelga de `tiposDocumentoQueryKey`, así
 * cualquier alta, edición o cambio de estado la invalida.
 *
 * Igual que en clientes, mientras llega la respuesta de un filtro nuevo se sigue mostrando la
 * anterior (`placeholderData`), para que la lista no se vacíe al cambiar el filtro. En ese lapso
 * `isPlaceholderData` es `true`: los datos son del filtro anterior y la interfaz no debe
 * presentarlos como definitivos. Los reintentos son los del QueryClient de la app.
 */
export function useTiposDocumento(filtros: FiltrosTiposDocumento = {}, { enabled = true } = {}) {
  // Normalizado: sin filtro y `false` son la misma consulta (misma key, un solo pedido).
  const incluirInactivos = filtros.incluirInactivos === true;
  return useQuery({
    queryKey: listaTiposDocumentoQueryKey({ incluirInactivos }),
    queryFn: ({ signal }) => listarTiposDocumento({ incluirInactivos }, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}
