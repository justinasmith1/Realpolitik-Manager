import type {
  CanalEntregaType,
  CreateRendicionDto,
  ListarRendicionesQuery,
} from '@realpolitik/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import {
  abrirRendicion,
  agregarRequisitoARendicion,
  anularRendicion,
  corregirCanalDeItem,
  listarRendiciones,
  obtenerRendicion,
  propagarCanalDeRequisito,
  rendicionesQueryKey,
} from '@/modules/rendiciones/api/rendiciones.api';

/**
 * Rendiciones activas de un cliente, con filtros opcionales de año y mes. La key es
 * `['clientes', clienteId, 'rendiciones', filtros]`: invalidar `rendicionesQueryKey(clienteId)`
 * refresca todas las variantes (con y sin filtros) y los detalles de ese cliente.
 */
export function useRendiciones(clienteId?: string, filtros: ListarRendicionesQuery = {}) {
  return useQuery(listaDeRendiciones(clienteId ?? '', filtros));
}

/**
 * La consulta del listado, para usarla también fuera de un componente (`fetchQuery`): así una
 * lectura puntual comparte key y caché con `useRendiciones`.
 */
export function listaDeRendiciones(clienteId: string, filtros: ListarRendicionesQuery = {}) {
  return queryOptions({
    queryKey: [...rendicionesQueryKey(clienteId), 'lista', filtros],
    queryFn: ({ signal }) => listarRendiciones(clienteId, filtros, signal),
    enabled: esIdDeRuta(clienteId),
  });
}

/** Una rendición con su checklist. Cuelga de la key del cliente para refrescarse con ella. */
const detalleQueryKey = (clienteId: string, rendicionId: string) =>
  [...rendicionesQueryKey(clienteId), 'detalle', rendicionId] as const;

export function useRendicion(clienteId?: string, rendicionId?: string) {
  return useQuery({
    queryKey: detalleQueryKey(clienteId ?? '', rendicionId ?? ''),
    queryFn: ({ signal }) => obtenerRendicion(rendicionId ?? '', signal),
    enabled: esIdDeRuta(clienteId) && esIdDeRuta(rendicionId),
  });
}

/**
 * Abre una rendición. Sin reintentos: un alta no se repite sola. Al terminar, bien o mal, el
 * listado se vuelve a pedir: un 409 de factura repetida puede deberse a una que todavía no se
 * veía.
 */
export function useAbrirRendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, datos }: { clienteId: string; datos: CreateRendicionDto }) =>
      abrirRendicion(clienteId, datos),
    retry: false,
    onSettled: (_resultado, _error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
  });
}

/**
 * Anula una rendición. Al terminar, bien o mal, el listado se vuelve a pedir: un 404 significa
 * que ya no está y tiene que desaparecer de la lista.
 */
export function useAnularRendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rendicionId }: { clienteId: string; rendicionId: string }) =>
      anularRendicion(rendicionId),
    retry: false,
    onSettled: (_resultado, _error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
  });
}

/**
 * Suma un requisito nuevo a una rendición abierta. Sin reintentos. Al terminar, el listado y los
 * detalles del cliente se vuelven a pedir (cambian la cantidad de ítems y el avance).
 */
export function useAgregarRequisitoARendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rendicionId,
      requisitoId,
    }: {
      clienteId: string;
      rendicionId: string;
      requisitoId: string;
    }) => agregarRequisitoARendicion(rendicionId, requisitoId),
    retry: false,
    onSettled: (_resultado, _error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
  });
}

/**
 * Corrige el canal de un ítem. Sin reintentos. Si sale bien, el detalle queda con la rendición que
 * devolvió el servidor (sin otro pedido: la selección y los filtros de la pantalla se conservan).
 * Si falla, se vuelve a pedir: la rendición pudo anularse o el ítem dejar de existir.
 */
export function useCorregirCanalDeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rendicionId,
      itemId,
      canalEntrega,
    }: {
      clienteId: string;
      rendicionId: string;
      itemId: string;
      canalEntrega: CanalEntregaType;
    }) => corregirCanalDeItem(rendicionId, itemId, canalEntrega),
    retry: false,
    onSuccess: (detalle, { clienteId, rendicionId }) => {
      queryClient.setQueryData(detalleQueryKey(clienteId, rendicionId), detalle);
    },
    onError: (_error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
  });
}

/**
 * Pasa los ítems de un requisito a su canal actual en las rendiciones elegidas (todo o nada). Sin
 * reintentos. Al terminar, bien o mal, las rendiciones del cliente (listado y detalles) se vuelven
 * a pedir: cambiaron los canales o alguna dejó de cumplir (se anuló, por ejemplo).
 */
export function usePropagarCanalDeRequisito() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clienteId,
      requisitoId,
      rendicionIds,
    }: {
      clienteId: string;
      requisitoId: string;
      rendicionIds: readonly string[];
    }) => propagarCanalDeRequisito(clienteId, requisitoId, rendicionIds),
    retry: false,
    onSettled: (_resultado, _error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesQueryKey(clienteId) }),
  });
}
