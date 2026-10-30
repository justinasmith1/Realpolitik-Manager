import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  aplicarDocumento,
  candidatosQueryKey,
  cargarDocumento,
  detalleDocumentoQueryKey,
  documentosQueryKey,
  historialDeItemQueryKey,
  listaDocumentosQueryKey,
  listarCandidatos,
  listarDocumentos,
  obtenerDocumento,
  obtenerHistorialDeItem,
  reemplazarDocumentoDeItem,
  type FiltrosDocumentos,
  type ItemDeRendicion,
} from '@/modules/documentos/api/documentos.api';
import { descargarDocumento } from '@/modules/documentos/descargarDocumento';
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

/** Historial de documentos de un ítem. Sin ítem, no pide nada. */
export function useHistorialDeItem(item: ItemDeRendicion | null) {
  return useQuery({
    queryKey: historialDeItemQueryKey(item ?? { clienteId: '', rendicionId: '', itemId: '' }),
    queryFn: ({ signal }) =>
      obtenerHistorialDeItem(item?.rendicionId ?? '', item?.itemId ?? '', signal),
    enabled: item !== null,
  });
}

export interface ReemplazoPedido extends ItemDeRendicion {
  documentoId: string;
  /** La aplicación que la operadora vio como vigente. */
  aplicacionVigenteId: string;
}

/**
 * Reemplaza el documento vigente de un ítem. Sin reintentos. Salga bien o mal, se vuelven a pedir
 * los documentos (cambian sus aplicaciones vigentes) y las rendiciones del cliente, con el
 * detalle y el historial: un 409 significa que el ítem cambió y hay que mostrar el vigente de
 * ahora. La mutación termina recién cuando eso se volvió a pedir.
 */
export function useReemplazarDocumentoDeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rendicionId, itemId, documentoId, aplicacionVigenteId }: ReemplazoPedido) =>
      reemplazarDocumentoDeItem(rendicionId, itemId, { documentoId, aplicacionVigenteId }),
    retry: false,
    onSettled: (_data, _error, { clienteId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: documentosQueryKey }),
        queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
      ]),
  });
}

/**
 * Descargas a través del backend, con los documentos que están descargándose (sus botones
 * muestran la espera) y sin repetir una que ya está en curso. `onFallo` decide cómo avisarlo.
 */
export function useDescargas(onFallo: (documento: { id: string; nombreOriginal: string }) => void) {
  const [idsDescargando, setIdsDescargando] = useState<readonly string[]>([]);
  const descargar = async (documento: { id: string; nombreOriginal: string }) => {
    if (idsDescargando.includes(documento.id)) return;
    setIdsDescargando((previos) => [...previos, documento.id]);
    try {
      await descargarDocumento(documento);
    } catch {
      onFallo(documento);
    } finally {
      setIdsDescargando((previos) => previos.filter((id) => id !== documento.id));
    }
  };
  return { idsDescargando, descargar };
}
