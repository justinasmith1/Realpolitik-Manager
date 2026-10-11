import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { crearQueryClient } from '@/app/providers';
import { ApiClientError } from '@/lib/http';
import { debeReintentar, MAX_REINTENTOS } from '@/lib/reintentos';
import { useClientes } from '@/modules/clientes/hooks/useClientes';

const http = (status: number) => new ApiClientError({ kind: 'http', message: 'x', status });

describe('debeReintentar', () => {
  it.each([
    ['sin conexión', new ApiClientError({ kind: 'network', message: 'x' })],
    ['un 500', http(500)],
    ['un 503', http(503)],
  ])('reintenta una vez ante %s', (_caso, error) => {
    expect(debeReintentar(0, error)).toBe(true);
    expect(debeReintentar(MAX_REINTENTOS, error)).toBe(false);
  });

  it.each([
    ['un 400', http(400)],
    ['un 404', http(404)],
    ['un 409', http(409)],
    ['la configuración', new ApiClientError({ kind: 'configuration', message: 'x' })],
    ['un error que no es de la API (p. ej. un schema que no valida)', new Error('parse')],
  ])('no reintenta %s', (_caso, error) => {
    expect(debeReintentar(0, error)).toBe(false);
  });
});

describe('QueryClient de la app: reintentos de las lecturas', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'https://api.example');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  function cargarListado() {
    const queryClient = crearQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const inicio = Date.now();
    const { result } = renderHook(() => useClientes({}), { wrapper });
    return { result, demora: () => Date.now() - inicio };
  }

  const respuesta = (status: number) =>
    new Response(JSON.stringify({ error: { code: 'X' } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('sin conexión reintenta UNA vez, rápido, y después muestra el error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result, demora } = cargarListado();

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Lejos de los ~7 s de los defaults (1 s + 2 s + 4 s).
    expect(demora()).toBeLessThan(1500);
  });

  it('un 500 también se reintenta una sola vez', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta(500)));
    const { result } = cargarListado();

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si el reintento sale bien, no se llega a mostrar el error', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    const { result } = cargarListado();

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3000 });
    expect(result.current.data).toEqual([]);
  });

  it.each([400, 404])('un %i no se reintenta', async (status) => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta(status)));
    const { result } = cargarListado();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un error de configuración no se reintenta (ni llega a pedir nada)', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { result } = cargarListado();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ kind: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
