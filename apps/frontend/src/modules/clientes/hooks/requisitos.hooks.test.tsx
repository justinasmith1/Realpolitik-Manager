import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { crearQueryClient } from '@/app/providers';
import { ApiClientError } from '@/lib/http';
import { clienteDetalleQueryKey, clientesListaQueryKey } from '@/modules/clientes/api/clientes.api';
import { requisitosQueryKey } from '@/modules/clientes/api/requisitos.api';
import { useActualizarRequisito } from '@/modules/clientes/hooks/useActualizarRequisito';
import { useCliente } from '@/modules/clientes/hooks/useCliente';
import { useClientes } from '@/modules/clientes/hooks/useClientes';
import { useCrearRequisito } from '@/modules/clientes/hooks/useCrearRequisito';
import { useEliminarRequisito } from '@/modules/clientes/hooks/useEliminarRequisito';
import { useRequisitos } from '@/modules/clientes/hooks/useRequisitos';
import { listaTiposDocumentoQueryKey } from '@/modules/tipos-documento/api/tipos-documento.api';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

const fetchMock = vi.fn<typeof fetch>();

function urlDe(entrada: Parameters<typeof fetch>[0]): string {
  if (typeof entrada === 'string') return entrada;
  if (entrada instanceof URL) return entrada.href;
  return entrada.url;
}

function jsonDePedido(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') {
    throw new Error('Se esperaba un body JSON en formato string');
  }

  return JSON.parse(body) as unknown;
}

const BASE = 'https://api.example';
const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OTRO_ID = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';
const REQUISITO_ID = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const TIPO_ID = 'c1d2e3f4-a5b6-4789-8abc-def012345678';

const requisito = (extra: Record<string, unknown> = {}) => ({
  id: REQUISITO_ID,
  clienteId: CLIENTE_ID,
  tipoDocumento: { id: TIPO_ID, nombre: 'Print', activo: true },
  cantidad: 1,
  diasAproximados: [],
  canalEntrega: null,
  nota: null,
  creadoEn: '2026-10-20T12:00:00.000Z',
  actualizadoEn: '2026-10-20T12:00:00.000Z',
  ...extra,
});

const cliente = (id = CLIENTE_ID) => ({
  id,
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
  emailsAdicionales: [],
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: true,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
});

const tipo = {
  id: TIPO_ID,
  nombre: 'Print',
  descripcion: null,
  activo: true,
  creadoEn: '2026-10-21T12:00:00.000Z',
  actualizadoEn: '2026-10-21T12:00:00.000Z',
};

const NO_ENCONTRADO = { error: { code: 'NOT_FOUND', message: 'No encontrado' } };
const DUPLICADO = {
  error: {
    code: 'CONFLICT',
    message: 'El cliente ya tiene un requisito para ese tipo de documento',
    details: {
      motivo: 'REQUISITO_DUPLICADO',
      requisitoExistente: { id: REQUISITO_ID, tipoDocumentoId: TIPO_ID, cantidad: 1 },
    },
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function preparar() {
  const queryClient = crearQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const invalidaciones = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, wrapper, invalidaciones };
}

const pedidosA = (ruta: string, method?: string) =>
  fetchMock.mock.calls.filter(([url, init]) => {
    if (url !== `${BASE}${ruta}`) return false;
    return method === undefined ? init?.method === undefined : init?.method === method;
  });

async function ejecutar(mutar: () => Promise<unknown>) {
  await act(async () => {
    await mutar().catch(() => undefined);
  });
}

/** Las tres consultas que un cambio de matriz tiene que refrescar, en ese orden. */
function invalidacionesDe(clienteId: string) {
  return [
    { queryKey: requisitosQueryKey(clienteId) },
    { queryKey: clienteDetalleQueryKey(clienteId) },
    { queryKey: clientesListaQueryKey },
  ];
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('useRequisitos', () => {
  it('usa la query key del cliente y no filtra un tipo inactivo', async () => {
    const inactivo = requisito({
      id: 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789',
      tipoDocumento: {
        id: 'f3a4b5c6-d7e8-4901-8cde-f01234567890',
        nombre: 'Factura',
        activo: false,
      },
    });
    fetchMock.mockResolvedValue(jsonResponse([inactivo, requisito()]));
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(() => useRequisitos(CLIENTE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((item) => item.tipoDocumento.activo)).toEqual([false, true]);
    expect(result.current.isError).toBe(false);
    expect(queryClient.getQueryData(requisitosQueryKey(CLIENTE_ID))).toBe(result.current.data);
    expect(pedidosA(`/clientes/${CLIENTE_ID}/requisitos`)).toHaveLength(1);
  });

  it('una matriz vacía es éxito con datos, no un error', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const { wrapper } = preparar();

    const { result } = renderHook(() => useRequisitos(CLIENTE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it('no consulta si enabled es false ni si el id no es válido', async () => {
    const { wrapper } = preparar();

    renderHook(() => useRequisitos(CLIENTE_ID, { enabled: false }), { wrapper });
    renderHook(() => useRequisitos(''), { wrapper });
    renderHook(() => useRequisitos('no-es-uuid'), { wrapper });
    await act(() => Promise.resolve());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dos clientes no comparten la matriz', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(jsonResponse(urlDe(url).includes(OTRO_ID) ? [] : [requisito()])),
    );
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(
      () => ({ a: useRequisitos(CLIENTE_ID), b: useRequisitos(OTRO_ID) }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.a.isSuccess && result.current.b.isSuccess).toBe(true),
    );
    expect(result.current.a.data).toHaveLength(1);
    expect(result.current.b.data).toEqual([]);
    expect(queryClient.getQueryData(requisitosQueryKey(CLIENTE_ID))).not.toEqual(
      queryClient.getQueryData(requisitosQueryKey(OTRO_ID)),
    );
  });

  it('distingue la carga y pasa el AbortSignal', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const { wrapper } = preparar();

    const { result, unmount } = renderHook(() => useRequisitos(CLIENTE_ID), { wrapper });

    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('un 404 queda como error y no se reintenta', async () => {
    fetchMock.mockResolvedValue(jsonResponse(NO_ENCONTRADO, 404));
    const { wrapper } = preparar();

    const { result } = renderHook(() => useRequisitos(CLIENTE_ID), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(result.current.isSuccess).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('mutaciones de requisitos', () => {
  function responderLecturas(url: string, init?: RequestInit) {
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      return Promise.resolve(jsonResponse(requisito(), init.method === 'POST' ? 201 : 200));
    }
    if (init?.method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === `${BASE}/clientes/${CLIENTE_ID}/requisitos`) {
      return Promise.resolve(jsonResponse([requisito()]));
    }
    if (url === `${BASE}/clientes/${OTRO_ID}/requisitos`) {
      return Promise.resolve(jsonResponse([]));
    }
    if (url === `${BASE}/clientes/${CLIENTE_ID}`) {
      return Promise.resolve(jsonResponse(cliente()));
    }
    if (url === `${BASE}/tipos-documento`) {
      return Promise.resolve(jsonResponse([tipo]));
    }
    if (url === `${BASE}/clientes`) {
      return Promise.resolve(jsonResponse([cliente()]));
    }
    return Promise.resolve(jsonResponse([]));
  }

  it('al crear, refresca la matriz, el detalle y los listados, y no toca lo demás', async () => {
    fetchMock.mockImplementation((url, init) => responderLecturas(urlDe(url), init));
    const { wrapper, queryClient, invalidaciones } = preparar();
    queryClient.setQueryData(requisitosQueryKey(OTRO_ID), []);
    queryClient.setQueryData(listaTiposDocumentoQueryKey(), [tipo]);

    const { result } = renderHook(
      () => ({
        matriz: useRequisitos(CLIENTE_ID),
        ajena: useRequisitos(OTRO_ID),
        detalle: useCliente(CLIENTE_ID),
        lista: useClientes({}),
        tipos: useTiposDocumento(),
        crear: useCrearRequisito(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.matriz.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.ajena.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.detalle.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.lista.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.tipos.isSuccess).toBe(true));

    await act(() =>
      result.current.crear.mutateAsync({
        clienteId: CLIENTE_ID,
        datos: { tipoDocumentoId: TIPO_ID },
      }),
    );

    await waitFor(() => expect(pedidosA(`/clientes/${CLIENTE_ID}/requisitos`)).toHaveLength(2));
    expect(pedidosA(`/clientes/${OTRO_ID}/requisitos`)).toHaveLength(1);
    expect(pedidosA(`/clientes/${CLIENTE_ID}`)).toHaveLength(2);
    expect(pedidosA('/clientes')).toHaveLength(2);
    expect(pedidosA('/tipos-documento')).toHaveLength(1);
    expect(pedidosA(`/clientes/${CLIENTE_ID}/requisitos`, 'POST')).toHaveLength(1);
    expect(invalidaciones.mock.calls.map(([filtro]) => filtro)).toEqual(
      invalidacionesDe(CLIENTE_ID),
    );
    expect(queryClient.getQueryState(requisitosQueryKey(OTRO_ID))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(listaTiposDocumentoQueryKey())?.isInvalidated).toBe(false);
  });

  it('al editar, invalida solo las consultas de ese cliente', async () => {
    fetchMock.mockImplementation((url, init) => responderLecturas(urlDe(url), init));
    const { wrapper, queryClient, invalidaciones } = preparar();
    queryClient.setQueryData(requisitosQueryKey(OTRO_ID), []);
    queryClient.setQueryData(listaTiposDocumentoQueryKey(), []);

    const { result } = renderHook(() => useActualizarRequisito(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE_ID,
        requisitoId: REQUISITO_ID,
        datos: { nota: null },
      }),
    );

    const pedido = pedidosA(`/clientes/${CLIENTE_ID}/requisitos/${REQUISITO_ID}`, 'PATCH')[0];
    expect(jsonDePedido(pedido?.[1]?.body)).toStrictEqual({ nota: null });
    expect(invalidaciones.mock.calls.map(([filtro]) => filtro)).toEqual(
      invalidacionesDe(CLIENTE_ID),
    );
    expect(queryClient.getQueryState(requisitosQueryKey(OTRO_ID))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(listaTiposDocumentoQueryKey())?.isInvalidated).toBe(false);
  });

  it('al dar de baja, el 204 invalida las mismas consultas y no interpreta un borrado físico', async () => {
    fetchMock.mockImplementation((url, init) => responderLecturas(urlDe(url), init));
    const { wrapper, queryClient, invalidaciones } = preparar();
    queryClient.setQueryData(requisitosQueryKey(OTRO_ID), []);

    const { result } = renderHook(() => useEliminarRequisito(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ clienteId: CLIENTE_ID, requisitoId: REQUISITO_ID }),
    );

    expect(pedidosA(`/clientes/${CLIENTE_ID}/requisitos/${REQUISITO_ID}`, 'DELETE')).toHaveLength(
      1,
    );
    // TanStack avisa el éxito en un turno aparte: `act` puede terminar antes de que el hook lo muestre.
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(invalidaciones.mock.calls.map(([filtro]) => filtro)).toEqual(
      invalidacionesDe(CLIENTE_ID),
    );
    expect(queryClient.getQueryState(requisitosQueryKey(OTRO_ID))?.isInvalidated).toBe(false);
  });

  it('dos altas de clientes distintos invalidan cada matriz por su cuenta', async () => {
    fetchMock.mockImplementation((url, init) => {
      const id = urlDe(url).includes(OTRO_ID) ? OTRO_ID : CLIENTE_ID;
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse(requisito({ clienteId: id }), 201));
      }
      return Promise.resolve(jsonResponse([]));
    });
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCrearRequisito(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ clienteId: CLIENTE_ID, datos: { tipoDocumentoId: TIPO_ID } }),
    );
    await act(() =>
      result.current.mutateAsync({ clienteId: OTRO_ID, datos: { tipoDocumentoId: TIPO_ID } }),
    );

    const keys = invalidaciones.mock.calls.map(([filtro]) => filtro?.queryKey);
    expect(keys).toEqual([
      ...invalidacionesDe(CLIENTE_ID).map((filtro) => filtro.queryKey),
      ...invalidacionesDe(OTRO_ID).map((filtro) => filtro.queryKey),
    ]);
  });

  it('un 409 de duplicado refresca solo la matriz, no reintenta y conserva el error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DUPLICADO, 409));
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCrearRequisito(), { wrapper });

    await ejecutar(() =>
      result.current.mutateAsync({ clienteId: CLIENTE_ID, datos: { tipoDocumentoId: TIPO_ID } }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(result.current.error).toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones.mock.calls.map(([filtro]) => filtro)).toEqual([
      { queryKey: requisitosQueryKey(CLIENTE_ID) },
    ]);
  });

  it('un 409 de cliente no activo refresca la matriz, el detalle y los listados', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'CONFLICT',
            message: 'El cliente no está activo',
            details: { motivo: 'CLIENTE_NO_ACTIVO', estado: 'INACTIVO' },
          },
        },
        409,
      ),
    );
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useActualizarRequisito(), { wrapper });

    await ejecutar(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE_ID,
        requisitoId: REQUISITO_ID,
        datos: { nota: 'x' },
      }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones.mock.calls.map(([filtro]) => filtro)).toEqual(
      invalidacionesDe(CLIENTE_ID),
    );
  });

  it('un 409 que no es de la matriz no invalida', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'CONFLICT', message: 'Otro', details: { motivo: 'OTRO' } } },
        409,
      ),
    );
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useEliminarRequisito(), { wrapper });

    await ejecutar(() =>
      result.current.mutateAsync({ clienteId: CLIENTE_ID, requisitoId: REQUISITO_ID }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidaciones).not.toHaveBeenCalled();
  });

  it('un 500 de edición no se reintenta ni invalida', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useActualizarRequisito(), { wrapper });

    await ejecutar(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE_ID,
        requisitoId: REQUISITO_ID,
        datos: { cantidad: 2 },
      }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones).not.toHaveBeenCalled();
  });

  it('un 404 del contrato refresca lo visible y deja el error en la mutation', async () => {
    fetchMock.mockResolvedValue(jsonResponse(NO_ENCONTRADO, 404));
    const { wrapper, queryClient, invalidaciones } = preparar();
    queryClient.setQueryData(requisitosQueryKey(OTRO_ID), []);
    queryClient.setQueryData(listaTiposDocumentoQueryKey(), []);
    const { result } = renderHook(() => useEliminarRequisito(), { wrapper });

    await ejecutar(() =>
      result.current.mutateAsync({ clienteId: CLIENTE_ID, requisitoId: REQUISITO_ID }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones.mock.calls.map(([filtro]) => filtro)).toEqual(
      invalidacionesDe(CLIENTE_ID),
    );
    expect(queryClient.getQueryState(requisitosQueryKey(OTRO_ID))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(listaTiposDocumentoQueryKey())?.isInvalidated).toBe(false);
  });

  it('un 404 sin el formato del contrato no se toma como dato viejo', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useActualizarRequisito(), { wrapper });

    await ejecutar(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE_ID,
        requisitoId: REQUISITO_ID,
        datos: { nota: 'x' },
      }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidaciones).not.toHaveBeenCalled();
  });
});
