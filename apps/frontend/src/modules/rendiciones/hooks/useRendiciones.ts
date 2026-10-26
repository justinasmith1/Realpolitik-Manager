import type { CreateRendicionDto, ListarRendicionesQuery } from '@realpolitik/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import {
  abrirRendicion,
  agregarRequisitoARendicion,
  anularRendicion,
  listarRendiciones,
  obtenerRendicion,
  rendicionesQueryKey,
} from '@/modules/rendiciones/api/rendiciones.api';

/**
 * Rendiciones activas de un cliente, con filtros opcionales de año y mes. La key es
 * `['clientes', clienteId, 'rendiciones', filtros]`: invalidar `rendicionesQueryKey(clienteId)`
 * refresca todas las variantes (con y sin filtros) y los detalles de ese cliente.
 */
export function useRendiciones(clienteId?: string, filtros: ListarRendicionesQuery = {}) {
  return useQuery({
    queryKey: [...rendicionesQueryKey(clienteId ?? ''), 'lista', filtros],
    queryFn: ({ signal }) => listarRendiciones(clienteId ?? '', filtros, signal),
    enabled: esIdDeRuta(clienteId),
  });
}

/** Una rendición con su checklist. Cuelga de la key del cliente para refrescarse con ella. */
export function useRendicion(clienteId?: string, rendicionId?: string) {
  return useQuery({
    queryKey: [...rendicionesQueryKey(clienteId ?? ''), 'detalle', rendicionId ?? ''],
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
