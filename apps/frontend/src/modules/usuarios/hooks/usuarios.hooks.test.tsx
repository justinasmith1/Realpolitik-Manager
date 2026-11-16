import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { crearQueryClient } from '@/app/providers';
import { CLAVE_SESION } from '@/modules/auth/sesion';
import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { listaUsuariosQueryKey, type FiltrosUsuarios } from '@/modules/usuarios/api/usuarios.api';
import { useActualizarUsuario } from '@/modules/usuarios/hooks/useActualizarUsuario';
import { useCambiarEstadoUsuario } from '@/modules/usuarios/hooks/useCambiarEstadoUsuario';
import {
  useCrearUsuario,
  useRestablecerContrasena,
} from '@/modules/usuarios/hooks/useContrasenaTemporal';
import { useUsuarios } from '@/modules/usuarios/hooks/useUsuarios';
import { urlDe } from '@/modules/usuarios/test/servidorDeUsuarios';

// Solo `fetch` es simulado: corren el QueryClient de la app (reintentos y manejo global), `http()`,
// el cliente API y los schemas de shared.
const fetchMock = vi.fn<typeof fetch>();
const BASE = 'https://api.example';
const ID = '0b0b0b0b-0000-4000-8000-000000000002';
const TEMPORAL = 'Q29udHJhc2VuYS10ZW1wb3JhbC1kZS1wcnVlYmE';

const usuario = (extra: Record<string, unknown> = {}) => ({
  id: ID,
  nombre: 'Bruno Díaz',
  email: 'bruno@ejemplo.example',
  rol: 'CONSULTA',
  activo: true,
  debeCambiarPassword: false,
  ultimoAccesoEn: null,
  ...extra,
});

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const NO_CONFIRMADO = () =>
  json(
    {
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'interno',
        details: { motivo: 'RESULTADO_NO_CONFIRMADO' },
      },
    },
    503,
  );

const pedidosA = (metodo: string, ruta: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => (init?.method ?? 'GET') === metodo && urlDe(url) === `${BASE}${ruta}`,
  );

function preparar() {
  const queryClient = sembrarSesion(crearQueryClient(), {
    id: '0000a000-0000-4000-8000-0000000000aa',
    rol: 'ADMINISTRADOR',
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const invalidaciones = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, wrapper, invalidaciones };
}

/** ¿Aparece el texto en algún lugar de la caché de queries o de mutations? */
function enLaCache(queryClient: ReturnType<typeof crearQueryClient>, texto: string): boolean {
  const queries = queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.state);
  const mutations = queryClient
    .getMutationCache()
    .getAll()
    .map((m) => m.state);
  return JSON.stringify([queries, mutations]).includes(texto);
}

const invalidoUsuarios = (spy: ReturnType<typeof preparar>['invalidaciones']) =>
  spy.mock.calls.some(([filtros]) => JSON.stringify(filtros?.queryKey) === '["usuarios"]');

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

describe('useUsuarios', () => {
  it('carga con los filtros normalizados y conserva el resultado anterior mientras cambia el filtro', async () => {
    const { queryClient, wrapper } = preparar();
    let responder: (respuesta: Response) => void = () => undefined;
    fetchMock.mockResolvedValueOnce(json([usuario()]));
    const inicial: FiltrosUsuarios = { q: ' bruno ' };
    const { result, rerender } = renderHook((filtros: FiltrosUsuarios) => useUsuarios(filtros), {
      wrapper,
      initialProps: inicial,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(urlDe(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(`${BASE}/usuarios?q=bruno`);
    expect(queryClient.getQueryData(listaUsuariosQueryKey({ q: 'bruno' }))).toHaveLength(1);

    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (responder = resolve)),
    );
    rerender({ q: 'bruno', rol: 'CONSULTA' });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data).toHaveLength(1);

    act(() => responder(json([])));
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});

describe('useActualizarUsuario y useCambiarEstadoUsuario', () => {
  it('al guardar invalidan el listado; sin reintentos ante un error', async () => {
    const { wrapper, invalidaciones } = preparar();
    fetchMock.mockResolvedValueOnce(
      json({
        usuario: usuario({ rol: 'ADMINISTRATIVO' }),
        modificados: ['rol'],
        sesionesRevocadas: 1,
      }),
    );
    const edicion = renderHook(() => useActualizarUsuario(), { wrapper });
    await act(() =>
      edicion.result.current.mutateAsync({ id: ID, cambios: { rol: 'ADMINISTRATIVO' } }),
    );
    expect(invalidoUsuarios(invalidaciones)).toBe(true);

    invalidaciones.mockClear();
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503)),
    );
    const estado = renderHook(() => useCambiarEstadoUsuario(), { wrapper });
    await act(async () => {
      await estado.result.current.mutateAsync({ id: ID, activo: false }).catch(() => undefined);
    });
    expect(pedidosA('PATCH', `/usuarios/${ID}/estado`)).toHaveLength(1);
    // 503 de capacidad: no se escribió nada, el listado sigue siendo cierto.
    expect(invalidoUsuarios(invalidaciones)).toBe(false);
  });

  it('un resultado sin confirmar invalida el listado y no se repite', async () => {
    const { wrapper, invalidaciones } = preparar();
    fetchMock.mockImplementation(() => Promise.resolve(NO_CONFIRMADO()));
    const { result } = renderHook(() => useCambiarEstadoUsuario(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: ID, activo: false }).catch(() => undefined);
    });
    expect(pedidosA('PATCH', `/usuarios/${ID}/estado`)).toHaveLength(1);
    expect(invalidoUsuarios(invalidaciones)).toBe(true);
  });

  it('el propio nombre: vuelve a pedir la sesión (sin cerrarla) para el menú de cuenta', async () => {
    const { queryClient, wrapper, invalidaciones } = preparar();
    const propia = queryClient.getQueryData<{ usuario: { id: string } }>(CLAVE_SESION)?.usuario.id;
    fetchMock.mockResolvedValueOnce(
      json({
        usuario: usuario({ id: propia, rol: 'ADMINISTRADOR', nombre: 'Nuevo nombre' }),
        modificados: ['nombre'],
        sesionesRevocadas: 0,
      }),
    );
    fetchMock.mockResolvedValue(json([]));
    const { result } = renderHook(() => useActualizarUsuario(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ id: propia ?? '', cambios: { nombre: 'Nuevo nombre' } }),
    );
    expect(
      invalidaciones.mock.calls.some(
        ([filtros]) => JSON.stringify(filtros?.queryKey) === JSON.stringify(CLAVE_SESION),
      ),
    ).toBe(true);
    expect(queryClient.getQueryData(CLAVE_SESION)).not.toBeNull();
  });
});

describe('alta y restablecimiento: la contraseña temporal no entra en ninguna caché', () => {
  it('el alta devuelve la contraseña a quien la pidió, invalida el listado y no la deja en TanStack Query', async () => {
    const { queryClient, wrapper, invalidaciones } = preparar();
    fetchMock.mockResolvedValue(json({ usuario: usuario(), contrasenaTemporal: TEMPORAL }, 201));
    const { result } = renderHook(() => useCrearUsuario(), { wrapper });

    let resultado: Awaited<ReturnType<typeof result.current.crear>> = null;
    await act(async () => {
      resultado = await result.current.crear({
        nombre: 'Bruno Díaz',
        email: 'bruno@ejemplo.example',
        rol: 'CONSULTA',
      });
    });
    expect(resultado).toMatchObject({ ok: true, respuesta: { contrasenaTemporal: TEMPORAL } });
    expect(invalidoUsuarios(invalidaciones)).toBe(true);
    expect(enLaCache(queryClient, TEMPORAL)).toBe(false);
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
  });

  it('un segundo envío mientras el primero sigue en curso no sale', async () => {
    const { wrapper } = preparar();
    let responder: (respuesta: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (responder = resolve)));
    const { result } = renderHook(() => useRestablecerContrasena(), { wrapper });

    let primero: Promise<unknown> = Promise.resolve();
    let segundo: unknown = 'sin llamar';
    await act(async () => {
      primero = result.current.restablecer(ID);
      segundo = await result.current.restablecer(ID);
    });
    expect(segundo).toBeNull();
    expect(result.current.restableciendo).toBe(true);
    await act(async () => {
      responder(json({ usuario: usuario(), contrasenaTemporal: TEMPORAL, sesionesRevocadas: 0 }));
      await primero;
    });
    expect(pedidosA('POST', `/usuarios/${ID}/restablecer-password`)).toHaveLength(1);
    expect(result.current.restableciendo).toBe(false);
  });

  it.each([
    ['RESULTADO_NO_CONFIRMADO', NO_CONFIRMADO],
    ['la red caída', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)(
    'con %s: sin confirmar, sin reintentar y con el listado invalidado',
    async (_, respuesta) => {
      const { wrapper, invalidaciones } = preparar();
      fetchMock.mockImplementation(() => Promise.resolve(respuesta()));
      const { result } = renderHook(() => useRestablecerContrasena(), { wrapper });
      let resultado: unknown;
      await act(async () => {
        resultado = await result.current.restablecer(ID);
      });
      expect(resultado).toEqual({ ok: false, fallo: { tipo: 'no-confirmado' } });
      expect(pedidosA('POST', `/usuarios/${ID}/restablecer-password`)).toHaveLength(1);
      expect(invalidoUsuarios(invalidaciones)).toBe(true);
    },
  );

  it('un 403 pasa por el manejo global: se revalida la sesión, sin cerrarla', async () => {
    const { queryClient, wrapper, invalidaciones } = preparar();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        json({ error: { code: 'FORBIDDEN', details: { motivo: 'PERMISO_INSUFICIENTE' } } }, 403),
      ),
    );
    const { result } = renderHook(() => useCrearUsuario(), { wrapper });
    let resultado: unknown;
    await act(async () => {
      resultado = await result.current.crear({
        nombre: 'Bruno Díaz',
        email: 'bruno@ejemplo.example',
        rol: 'CONSULTA',
      });
    });
    expect(resultado).toEqual({ ok: false, fallo: { tipo: 'sin-permiso' } });
    expect(
      invalidaciones.mock.calls.some(
        ([filtros]) => JSON.stringify(filtros?.queryKey) === JSON.stringify(CLAVE_SESION),
      ),
    ).toBe(true);
    expect(queryClient.getQueryData(CLAVE_SESION)).not.toBeNull();
  });
});
