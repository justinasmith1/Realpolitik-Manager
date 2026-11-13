import type {
  ActualizarEstadoRendicionDto,
  ActualizarRendicionDto,
  CanalEntregaType,
  CreateRendicionDto,
  ListarRendicionesQuery,
  RegistrarCobroDto,
} from '@realpolitik/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import {
  abrirRendicion,
  actualizarOcDeRendicion,
  agregarRequisitoARendicion,
  anularRendicion,
  cambiarEstadoDeRendicion,
  corregirCanalDeItem,
  listarRendiciones,
  listarRendicionesAtrasadas,
  listarRendicionesDelMes,
  obtenerRendicion,
  obtenerUltimaOc,
  prepararEnvio,
  propagarCanalDeRequisito,
  quitarCobro,
  registrarCobro,
} from '@/modules/rendiciones/api/rendiciones.api';
import { rendicionesKeys } from '@/modules/rendiciones/api/rendiciones.keys';
import { invalidarRendiciones } from '@/modules/rendiciones/hooks/invalidarRendiciones';

/**
 * Rendiciones activas de un cliente, con filtros opcionales de año y mes. La key es
 * `rendicionesKeys.lista`: invalidar `rendicionesKeys.deCliente(clienteId)` refresca todas las
 * variantes (con y sin filtros) y los detalles de ese cliente.
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
    queryKey: rendicionesKeys.lista(clienteId, filtros),
    queryFn: ({ signal }) => listarRendiciones(clienteId, filtros, signal),
    enabled: esIdDeRuta(clienteId),
  });
}

/** Las rendiciones activas de un mes, de todos los clientes (pantalla Rendiciones, HU3.2). */
export function useRendicionesDelMes(periodo: { anio: number; mes: number }) {
  return useQuery({
    queryKey: rendicionesKeys.delMes(periodo),
    queryFn: ({ signal }) => listarRendicionesDelMes(periodo, signal),
  });
}

/** Las rendiciones atrasadas de cualquier mes (HU3.4): la tarjeta Atrasadas y su vista. */
export function useRendicionesAtrasadas() {
  return useQuery({
    queryKey: rendicionesKeys.atrasadas,
    queryFn: ({ signal }) => listarRendicionesAtrasadas(signal),
  });
}

/** Una rendición con su checklist. Cuelga de la key del cliente para refrescarse con ella. */
export function useRendicion(clienteId?: string, rendicionId?: string) {
  return useQuery({
    queryKey: rendicionesKeys.detalle(clienteId ?? '', rendicionId ?? ''),
    queryFn: ({ signal }) => obtenerRendicion(rendicionId ?? '', signal),
    enabled: esIdDeRuta(clienteId) && esIdDeRuta(rendicionId),
  });
}

/**
 * Abre una rendición. Sin reintentos: un alta no se repite sola. Al terminar, bien o mal, el
 * listado se vuelve a pedir: un 409 de factura repetida puede deberse a una que todavía no se
 * veía. También la pantalla Rendiciones: la nueva entra en su mes y, si es de un mes viejo, en las
 * atrasadas.
 */
export function useAbrirRendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, datos }: { clienteId: string; datos: CreateRendicionDto }) =>
      abrirRendicion(clienteId, datos),
    retry: false,
    onSettled: (_resultado, _error, { clienteId }) => invalidarRendiciones(queryClient, clienteId),
  });
}

/**
 * Anula una rendición. Al terminar, bien o mal, el listado se vuelve a pedir: un 404 significa
 * que ya no está y tiene que desaparecer de la lista. También la pantalla Rendiciones: una anulada
 * sale de su mes y de las atrasadas (la tarjeta Atrasadas se actualiza enseguida).
 */
export function useAnularRendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rendicionId }: { clienteId: string; rendicionId: string }) =>
      anularRendicion(rendicionId),
    retry: false,
    onSettled: (_resultado, _error, { clienteId }) => invalidarRendiciones(queryClient, clienteId),
  });
}

/**
 * Suma un requisito nuevo a una rendición abierta. Sin reintentos. Al terminar, el listado y los
 * detalles del cliente se vuelven a pedir (cambian la cantidad de ítems y el avance), y también la
 * pantalla Rendiciones, que muestra el avance en el listado del mes y en las atrasadas.
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
    onSettled: (_resultado, _error, { clienteId }) => invalidarRendiciones(queryClient, clienteId),
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
      queryClient.setQueryData(rendicionesKeys.detalle(clienteId, rendicionId), detalle);
    },
    onError: (_error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesKeys.deCliente(clienteId) }),
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
      queryClient.invalidateQueries({ queryKey: rendicionesKeys.deCliente(clienteId) }),
  });
}

/**
 * Prepara el envío de los ítems elegidos: el servidor confirma, con los datos de ahora, que se
 * pueden enviar. Sin reintentos. Si falla, las rendiciones del cliente se vuelven a pedir: un 409
 * significa que la rendición o algún ítem cambió desde que se eligieron.
 */
export function usePrepararEnvio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rendicionId,
      itemIds,
    }: {
      clienteId: string;
      rendicionId: string;
      itemIds: readonly string[];
    }) => prepararEnvio(rendicionId, itemIds),
    retry: false,
    onError: (_error, { clienteId }) =>
      queryClient.invalidateQueries({ queryKey: rendicionesKeys.deCliente(clienteId) }),
  });
}

// ─── Estado de la rendición (HU3.6) ───────────────────────────────────────────────────────

/**
 * Marca la rendición como completa o la vuelve a en curso. Sin reintentos. Si sale bien, el detalle
 * queda con la rendición que devolvió el servidor (sin otro pedido). Al terminar, bien o mal, se
 * vuelve a pedir todo lo que muestra el estado: el listado del cliente, el del mes y las atrasadas.
 * Un 409 significa que algo cambió (faltan documentos, se anuló): hay que volver a mirar.
 */
export function useMarcarEstadoDeRendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rendicionId,
      datos,
    }: {
      clienteId: string;
      rendicionId: string;
      datos: ActualizarEstadoRendicionDto;
    }) => cambiarEstadoDeRendicion(rendicionId, datos),
    retry: false,
    onSuccess: (detalle, { clienteId, rendicionId }) => {
      queryClient.setQueryData(rendicionesKeys.detalle(clienteId, rendicionId), detalle);
    },
    onSettled: (_resultado, _error, { clienteId }) => invalidarRendiciones(queryClient, clienteId),
  });
}

// ─── Orden de compra (HU2.11) ─────────────────────────────────────────────────────────────

/**
 * La OC sugerida: la de la última rendición del cliente que tenga una (`null` si ninguna). Con
 * `enabled: false` no consulta: solo se pide cuando el formulario de la OC está vacío. Cuelga de la
 * key de rendiciones del cliente, así guardar una OC la refresca.
 */
export function useUltimaOc(clienteId: string, { enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: rendicionesKeys.ultimaOc(clienteId),
    queryFn: ({ signal }) => obtenerUltimaOc(clienteId, signal),
    enabled: enabled && esIdDeRuta(clienteId),
    // Es una sugerencia: no se reintenta ni se reutiliza una vieja.
    retry: false,
    staleTime: 0,
  });
}

/**
 * Guarda los datos de la OC de una rendición. Sin reintentos. Si sale bien, el detalle queda con la
 * rendición que devolvió el servidor (la cabecera se actualiza sin otro pedido) y el resto de las
 * consultas del cliente (listado, última OC) se vuelven a pedir.
 */
export function useActualizarOcDeRendicion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rendicionId,
      datos,
    }: {
      clienteId: string;
      rendicionId: string;
      datos: ActualizarRendicionDto;
    }) => actualizarOcDeRendicion(rendicionId, datos),
    retry: false,
    onSuccess: (detalle, { clienteId, rendicionId }) => {
      queryClient.setQueryData(rendicionesKeys.detalle(clienteId, rendicionId), detalle);
      void queryClient.invalidateQueries({ queryKey: rendicionesKeys.deCliente(clienteId) });
    },
  });
}

// ─── Cobro informado por el cliente (HU3.10) ──────────────────────────────────────────────

/**
 * Registra o corrige el cobro de una rendición. Sin reintentos. Si sale bien, el detalle queda con
 * la rendición que devolvió el servidor (sin otro pedido). Al terminar, bien o mal, se vuelve a
 * pedir lo que muestra la marca: el listado del cliente y la pantalla Rendiciones (el mes y las
 * atrasadas). Un 409 significa que algo cambió (se anuló, ya no está enviada): hay que volver a mirar.
 * No toca el hook de la OC, que solo refresca al cliente.
 */
export function useRegistrarCobro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rendicionId,
      datos,
    }: {
      clienteId: string;
      rendicionId: string;
      datos: RegistrarCobroDto;
    }) => registrarCobro(rendicionId, datos),
    retry: false,
    onSuccess: (detalle, { clienteId, rendicionId }) => {
      queryClient.setQueryData(rendicionesKeys.detalle(clienteId, rendicionId), detalle);
    },
    onSettled: (_resultado, _error, { clienteId }) => invalidarRendiciones(queryClient, clienteId),
  });
}

/** Quita la marca de cobrada. Mismas reglas que `useRegistrarCobro`. */
export function useQuitarCobro() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rendicionId }: { clienteId: string; rendicionId: string }) =>
      quitarCobro(rendicionId),
    retry: false,
    onSuccess: (detalle, { clienteId, rendicionId }) => {
      queryClient.setQueryData(rendicionesKeys.detalle(clienteId, rendicionId), detalle);
    },
    onSettled: (_resultado, _error, { clienteId }) => invalidarRendiciones(queryClient, clienteId),
  });
}
