import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { crearQueryClient } from '@/app/providers';
import { ApiClientError } from '@/lib/http';
import { listaTiposDocumentoQueryKey } from '@/modules/tipos-documento/api/tipos-documento.api';
import { useActualizarTipoDocumento } from '@/modules/tipos-documento/hooks/useActualizarTipoDocumento';
import {
  useCambiarEstadoTipoDocumento,
  useTiposDocumentoCambiandoEstado,
} from '@/modules/tipos-documento/hooks/useCambiarEstadoTipoDocumento';
import { useCrearTipoDocumento } from '@/modules/tipos-documento/hooks/useCrearTipoDocumento';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

// Solo `fetch` es simulado: corren el QueryClient de la app (con su política de reintentos),
// `http()`, el cliente API y los schemas de shared.
const fetchMock = vi.fn<typeof fetch>();

const BASE = 'https://api.example';
const ID = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const OTRO_ID = 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789';

/** Un tipo de documento como lo devuelve la API. */
const tipo = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  nombre: 'Constancia ARCA',
  descripcion: null,
  activo: true,
  creadoEn: '2026-10-21T12:00:00.000Z',
  actualizadoEn: '2026-10-21T12:00:00.000Z',
  ...extra,
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NO_ENCONTRADO = { code: 'NOT_FOUND', message: 'Tipo de documento no encontrado' };
const DUPLICADO = {
  code: 'CONFLICT',
  message: 'Ya existe un tipo de documento con ese nombre',
  details: {
    motivo: 'TIPO_DOCUMENTO_DUPLICADO',
    tipoDocumentoExistente: { id: OTRO_ID, nombre: 'Print', activo: false },
  },
};

/** Una respuesta que llega cuando el test lo decide. */
function respuestaPendiente() {
  let resolver: (respuesta: Response) => void = () => undefined;
  const promesa = new Promise<Response>((resolve) => {
    resolver = resolve;
  });
  return { promesa, resolver: (respuesta: Response) => resolver(respuesta) };
}

/** Los pedidos que se hicieron a esa ruta. */
const pedidosA = (ruta: string) => fetchMock.mock.calls.filter(([url]) => url === `${BASE}${ruta}`);

/** Ejecuta una mutation y espera a que termine, salga bien o falle. */
async function ejecutar(mutar: () => Promise<unknown>) {
  await act(async () => {
    await mutar().catch(() => undefined);
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

describe('useTiposDocumento', () => {
  it('pide los activos y entrega los tipos validados por shared', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([tipo()])));
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(() => useTiposDocumento(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((t) => t.nombre)).toEqual(['Constancia ARCA']);
    expect(result.current.data?.[0]?.creadoEn).toBeInstanceOf(Date);
    expect(pedidosA('/tipos-documento')).toHaveLength(1);
    expect(queryClient.getQueryData(listaTiposDocumentoQueryKey())).toBeDefined();
  });

  it('con incluirInactivos pide todos, en otra entrada de caché', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([tipo({ activo: false })])));
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(() => useTiposDocumento({ incluirInactivos: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(pedidosA('/tipos-documento?incluirInactivos=true')).toHaveLength(1);
    expect(
      queryClient.getQueryData(listaTiposDocumentoQueryKey({ incluirInactivos: true })),
    ).toBeDefined();
    expect(queryClient.getQueryData(listaTiposDocumentoQueryKey())).toBeUndefined();
  });

  it('sin filtro y con incluirInactivos: false comparten la caché: un solo pedido', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([tipo()])));
    const { wrapper } = preparar();

    const { result } = renderHook(
      () => ({
        sinFiltro: useTiposDocumento(),
        conFalse: useTiposDocumento({ incluirInactivos: false }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.conFalse.isSuccess).toBe(true));
    expect(result.current.sinFiltro.data).toEqual(result.current.conFalse.data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pasa el AbortSignal a la request y la cancela si nadie espera el resultado', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const { wrapper } = preparar();

    const { unmount } = renderHook(() => useTiposDocumento(), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('al cambiar el filtro conserva los datos anteriores marcados como placeholder', async () => {
    const todos = respuestaPendiente();
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(jsonResponse([tipo()])))
      .mockImplementationOnce(() => todos.promesa);
    const { wrapper } = preparar();

    const { result, rerender } = renderHook(
      ({ incluirInactivos }: { incluirInactivos: boolean }) =>
        useTiposDocumento({ incluirInactivos }),
      { wrapper, initialProps: { incluirInactivos: false } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ incluirInactivos: true });

    // Datos del filtro anterior: la interfaz los puede mostrar, pero no como definitivos.
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data).toHaveLength(1);

    await act(async () => {
      todos.resolver(jsonResponse([tipo(), tipo({ id: OTRO_ID, nombre: 'Print', activo: false })]));
      await todos.promesa;
    });

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data).toHaveLength(2);
  });

  it('usa la política de reintentos de la app: un 400 no se reintenta', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: { code: 'VALIDATION_ERROR', details: [] } }, 400)),
    );
    const { wrapper } = preparar();

    const { result } = renderHook(() => useTiposDocumento(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useCrearTipoDocumento', () => {
  it('hace el POST y, al crear, invalida solo el catálogo', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(tipo(), 201)));
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCrearTipoDocumento(), { wrapper });

    await act(() => result.current.mutateAsync({ nombre: 'Constancia ARCA' }));

    expect(pedidosA('/tipos-documento')[0]?.[1]?.method).toBe('POST');
    expect(invalidaciones).toHaveBeenCalledTimes(1);
    expect(invalidaciones).toHaveBeenCalledWith({ queryKey: ['tipos-documento'] });
  });

  it('el listado visible se vuelve a pedir después del alta', async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(init?.method === 'POST' ? jsonResponse(tipo(), 201) : jsonResponse([tipo()])),
    );
    const { wrapper } = preparar();
    const { result } = renderHook(
      () => ({ lista: useTiposDocumento(), crear: useCrearTipoDocumento() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.lista.isSuccess).toBe(true));

    await act(() => result.current.crear.mutateAsync({ nombre: 'Print' }));

    const lecturas = () => pedidosA('/tipos-documento').filter(([, init]) => !init?.method);
    await waitFor(() => expect(lecturas()).toHaveLength(2));
  });

  it.each([
    ['sin conexión', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['un 500', () => Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))],
    ['un nombre duplicado', () => Promise.resolve(jsonResponse({ error: DUPLICADO }, 409))],
  ])('ante %s no reintenta ni invalida', async (_caso, respuesta: () => Promise<Response>) => {
    fetchMock.mockImplementation(respuesta);
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCrearTipoDocumento(), { wrapper });

    await ejecutar(() => result.current.mutateAsync({ nombre: 'Print' }));

    // TanStack Query avisa a React con su propio scheduler (`setTimeout(0)`): el estado de error
    // puede llegar después de que `act` resolvió, así que se espera a que el hook lo muestre.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones).not.toHaveBeenCalled();
  });
});

describe('useActualizarTipoDocumento', () => {
  it('hace el PATCH con solo los campos enviados y, al guardar, invalida el catálogo', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(tipo({ descripcion: null }))));
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useActualizarTipoDocumento(), { wrapper });

    await act(() => result.current.mutateAsync({ id: ID, datos: { descripcion: null } }));

    const [pedido] = pedidosA(`/tipos-documento/${ID}`);
    expect(pedido?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(pedido?.[1]?.body as string)).toStrictEqual({ descripcion: null });
    expect(invalidaciones).toHaveBeenCalledWith({ queryKey: ['tipos-documento'] });
  });

  it('si el tipo ya no existe (404 del contrato), invalida para que el listado se refresque', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: NO_ENCONTRADO }, 404)),
    );
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useActualizarTipoDocumento(), { wrapper });

    await ejecutar(() => result.current.mutateAsync({ id: ID, datos: { nombre: 'Print' } }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones).toHaveBeenCalledWith({ queryKey: ['tipos-documento'] });
  });

  it.each([
    ['sin conexión', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['un 500', () => Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))],
    ['un nombre duplicado', () => Promise.resolve(jsonResponse({ error: DUPLICADO }, 409))],
    ['un 404 sin cuerpo', () => Promise.resolve(new Response('', { status: 404 }))],
  ])('ante %s no reintenta ni invalida', async (_caso, respuesta: () => Promise<Response>) => {
    fetchMock.mockImplementation(respuesta);
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useActualizarTipoDocumento(), { wrapper });

    await ejecutar(() => result.current.mutateAsync({ id: ID, datos: { nombre: 'Print' } }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones).not.toHaveBeenCalled();
  });
});

describe('useCambiarEstadoTipoDocumento', () => {
  it('manda { activo } y, al cambiar, invalida el catálogo', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(tipo({ activo: false }))));
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCambiarEstadoTipoDocumento(), { wrapper });

    await act(() => result.current.mutateAsync({ id: ID, activo: false }));

    const [pedido] = pedidosA(`/tipos-documento/${ID}/estado`);
    expect(pedido?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(pedido?.[1]?.body as string)).toStrictEqual({ activo: false });
    expect(invalidaciones).toHaveBeenCalledWith({ queryKey: ['tipos-documento'] });
  });

  it('si el tipo ya no existe (404 del contrato), invalida para que el listado se refresque', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: NO_ENCONTRADO }, 404)),
    );
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCambiarEstadoTipoDocumento(), { wrapper });

    await ejecutar(() => result.current.mutateAsync({ id: ID, activo: true }));

    expect(invalidaciones).toHaveBeenCalledWith({ queryKey: ['tipos-documento'] });
  });

  it.each([
    ['sin conexión', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['un 500', () => Promise.resolve(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500))],
  ])('ante %s no reintenta ni invalida', async (_caso, respuesta: () => Promise<Response>) => {
    fetchMock.mockImplementation(respuesta);
    const { wrapper, invalidaciones } = preparar();
    const { result } = renderHook(() => useCambiarEstadoTipoDocumento(), { wrapper });

    await ejecutar(() => result.current.mutateAsync({ id: ID, activo: false }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invalidaciones).not.toHaveBeenCalled();
  });

  it('con cambios simultáneos sobre tipos distintos, cada uno sigue pendiente hasta su respuesta', async () => {
    const enVuelo = new Map<string, ReturnType<typeof respuestaPendiente>>();
    fetchMock.mockImplementation((url) => {
      const respuesta = respuestaPendiente();
      enVuelo.set(url as string, respuesta);
      return respuesta.promesa;
    });
    const { wrapper } = preparar();
    const { result } = renderHook(
      () => ({
        cambiar: useCambiarEstadoTipoDocumento(),
        pendientes: useTiposDocumentoCambiandoEstado(),
      }),
      { wrapper },
    );
    const responder = async (id: string, activo: boolean) => {
      await act(async () => {
        const respuesta = enVuelo.get(`${BASE}/tipos-documento/${id}/estado`);
        respuesta?.resolver(jsonResponse(tipo({ id, activo })));
        await respuesta?.promesa;
      });
    };

    // El segundo pedido reemplaza las `variables` de la mutation, pero el primero sigue en vuelo.
    act(() => {
      result.current.cambiar.mutate({ id: ID, activo: false });
      result.current.cambiar.mutate({ id: OTRO_ID, activo: true });
    });

    await waitFor(() => expect(result.current.pendientes).toHaveLength(2));
    expect([...result.current.pendientes].sort()).toEqual([ID, OTRO_ID].sort());

    await responder(ID, false);
    await waitFor(() => expect(result.current.pendientes).toEqual([OTRO_ID]));

    await responder(OTRO_ID, true);
    await waitFor(() => expect(result.current.pendientes).toEqual([]));
  });
});
