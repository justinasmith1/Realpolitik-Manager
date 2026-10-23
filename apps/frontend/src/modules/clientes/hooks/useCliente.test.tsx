import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { crearQueryClient } from '@/app/providers';
import { ApiClientError } from '@/lib/http';
import {
  clienteDetalleQueryKey,
  clientesListaQueryKey,
  listaClientesQueryKey,
} from '@/modules/clientes/api/clientes.api';
import { useCliente } from '@/modules/clientes/hooks/useCliente';
import { useClientes } from '@/modules/clientes/hooks/useClientes';

const fetchMock = vi.fn<typeof fetch>();

const BASE = 'https://api.example';
const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OTRO_ID = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';

const cliente = (id: string, extra: Record<string, unknown> = {}) => ({
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
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
  ...extra,
});

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
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('useCliente', () => {
  it('pide el detalle con su query key y entrega el cliente validado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(cliente(CLIENTE_ID, { matrizConfigurada: true })));
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(() => useCliente(CLIENTE_ID), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ id: CLIENTE_ID, matrizConfigurada: true });
    expect(result.current.data?.creadoEn).toBeInstanceOf(Date);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/clientes/${CLIENTE_ID}`);
    expect(queryClient.getQueryData(clienteDetalleQueryKey(CLIENTE_ID))).toBe(result.current.data);
    expect(queryClient.getQueryData(clienteDetalleQueryKey(OTRO_ID))).toBeUndefined();
  });

  it('no consulta si enabled es false', async () => {
    const { wrapper } = preparar();

    const { result } = renderHook(() => useCliente(CLIENTE_ID, { enabled: false }), { wrapper });
    await act(() => Promise.resolve());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('no consulta si el id está vacío o no es un UUID', async () => {
    const { wrapper } = preparar();

    renderHook(() => useCliente(undefined), { wrapper });
    renderHook(() => useCliente(''), { wrapper });
    renderHook(() => useCliente('no-es-uuid'), { wrapper });
    await act(() => Promise.resolve());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dos clientes quedan en consultas distintas', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(jsonResponse(cliente(String(url).endsWith(OTRO_ID) ? OTRO_ID : CLIENTE_ID))),
    );
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(() => ({ a: useCliente(CLIENTE_ID), b: useCliente(OTRO_ID) }), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.a.isSuccess && result.current.b.isSuccess).toBe(true),
    );
    expect(result.current.a.data?.id).toBe(CLIENTE_ID);
    expect(result.current.b.data?.id).toBe(OTRO_ID);
    expect(queryClient.getQueryData(clienteDetalleQueryKey(CLIENTE_ID))).not.toBe(
      queryClient.getQueryData(clienteDetalleQueryKey(OTRO_ID)),
    );
  });

  it('pasa el AbortSignal y lo aborta al desmontar', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const { wrapper } = preparar();

    const { unmount } = renderHook(() => useCliente(CLIENTE_ID), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;

    expect(signal).toBeInstanceOf(AbortSignal);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('propaga el error de la API (un 404 no se reintenta)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404));
    const { wrapper } = preparar();

    const { result } = renderHook(() => useCliente(CLIENTE_ID), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useClientes y matrizConfigurada', () => {
  it('true y false piden URLs distintas y no comparten la caché', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        jsonResponse([
          cliente(CLIENTE_ID, {
            matrizConfigurada: String(url).includes('matrizConfigurada=true'),
          }),
        ]),
      ),
    );
    const { wrapper, queryClient } = preparar();

    const { result } = renderHook(
      () => ({
        conMatriz: useClientes({ matrizConfigurada: true }),
        sinMatriz: useClientes({ matrizConfigurada: false }),
      }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.conMatriz.isSuccess && result.current.sinMatriz.isSuccess).toBe(true),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${BASE}/clientes?matrizConfigurada=true`,
      `${BASE}/clientes?matrizConfigurada=false`,
    ]);
    expect(result.current.conMatriz.data?.[0]?.matrizConfigurada).toBe(true);
    expect(result.current.sinMatriz.data?.[0]?.matrizConfigurada).toBe(false);
    expect(queryClient.getQueryData(listaClientesQueryKey({ matrizConfigurada: true }))).not.toBe(
      queryClient.getQueryData(listaClientesQueryKey({ matrizConfigurada: false })),
    );
    expect(listaClientesQueryKey({ matrizConfigurada: true }).slice(0, 2)).toEqual([
      ...clientesListaQueryKey,
    ]);
  });
});
