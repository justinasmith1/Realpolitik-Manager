import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  aplicarDocumento,
  candidatosQueryKey,
  cargarDocumento,
  detalleDocumentoQueryKey,
  documentosQueryKey,
  listaDocumentosQueryKey,
  listarCandidatos,
  listarDocumentos,
  obtenerDocumento,
  type FiltrosDocumentos,
} from '@/modules/documentos/api/documentos.api';
import { rendicionesQueryKey } from '@/modules/rendiciones/api/rendiciones.api';

/**
 * Repositorio de un período. Como en el catálogo, mientras llega la respuesta de un filtro nuevo
 * se sigue mostrando la anterior (`isPlaceholderData`): la lista no se vacía al cambiar de mes.
 */
export function useDocumentos(filtros: FiltrosDocumentos, { enabled = true } = {}) {
  return useQuery({
    queryKey: listaDocumentosQueryKey(filtros),
    queryFn: ({ signal }) => listarDocumentos(filtros, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Un documento con sus aplicaciones. Sin `id`, no pide nada. */
export function useDocumento(id: string | null) {
  return useQuery({
    queryKey: detalleDocumentoQueryKey(id ?? ''),
    queryFn: ({ signal }) => obtenerDocumento(id ?? '', signal),
    enabled: id !== null,
  });
}

/** Ítems donde se podría aplicar el documento. Sin `id`, no pide nada. */
export function useCandidatos(id: string | null) {
  return useQuery({
    queryKey: candidatosQueryKey(id ?? ''),
    queryFn: ({ signal }) => listarCandidatos(id ?? '', signal),
    enabled: id !== null,
  });
}

/** Carga un documento. Al terminar, el repositorio se vuelve a pedir. */
export function useCargarDocumento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cargarDocumento,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: documentosQueryKey }),
  });
}

export interface AplicacionPedida {
  documentoId: string;
  itemIds: readonly string[];
  /** Clientes de los ítems elegidos: sus rendiciones cambian (avance del checklist). */
  clienteIds: readonly string[];
}

/**
 * Aplica un documento a los ítems elegidos. Salga bien o mal, se vuelven a pedir los documentos
 * (repositorio, detalle y candidatos: un 409 significa que algo cambió) y las rendiciones de los
 * clientes involucrados. La mutación termina recién cuando eso se volvió a pedir.
 */
export function useAplicarDocumento() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentoId, itemIds }: AplicacionPedida) =>
      aplicarDocumento(documentoId, itemIds),
    onSettled: (_data, _error, { clienteIds }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: documentosQueryKey }),
        ...clienteIds.map((clienteId) =>
          queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
        ),
      ]),
  });
}
