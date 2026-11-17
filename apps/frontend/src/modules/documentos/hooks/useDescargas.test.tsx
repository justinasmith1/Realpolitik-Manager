// Descargas manuales y errores de acceso (HU4.4, CA12). La descarga no es una query ni una
// mutation: `useDescargas` pasa su error al manejo global de la app (`manejarErrorGlobal`), y la
// confirmación de un 401 es la real (`confirmarSesion` contra `GET /auth/sesion` simulado).

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { crearQueryClient } from '@/app/providers';
import { CLAVE_SESION, urlDeLogin } from '@/modules/auth/sesion';
import { sembrarSesion, sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';
import { useDescargas } from '@/modules/documentos/hooks/useDocumentos';

const BASE = 'https://api.example';
const fetchMock = vi.fn<typeof fetch>();

const DOCUMENTO = { id: '00000000-0000-4000-8000-000000000001', nombreOriginal: 'print.pdf' };
const OTRO = { id: '00000000-0000-4000-8000-000000000002', nombreOriginal: 'factura.pdf' };

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: 'mensaje interno que no se muestra', details } });
// Como texto y no como `Blob`: el `Blob` de jsdom no es el de Node, y `fetch` lo rechaza.
const archivo = () => new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } });

const VENCIDA = () => error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' });

/** Lo que responden `GET /documentos/:id/archivo` y `GET /auth/sesion` en cada test. */
let servidor: { archivo: () => Response | Promise<Response>; sesion: () => Response };

const rutaDe = (entrada: Parameters<typeof fetch>[0]) =>
  new URL(
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
  ).pathname;
const pedidosA = (ruta: string) =>
  fetchMock.mock.calls.filter(([entrada]) => rutaDe(entrada) === ruta).length;
const descargasDe = (documento: { id: string }) => pedidosA(`/documentos/${documento.id}/archivo`);

let enlaces: string[];

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
  servidor = { archivo, sesion: () => json(200, sesionDePrueba()) };
  fetchMock.mockImplementation((entrada) =>
    Promise.resolve(rutaDe(entrada) === '/auth/sesion' ? servidor.sesion() : servidor.archivo()),
  );
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:prueba'), revokeObjectURL: vi.fn() }),
  );
  enlaces = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    enlaces.push(this.download);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

/** El hook con el QueryClient de la app (manejo global conectado) y una sesión iniciada. */
function preparar() {
  const queryClient = sembrarSesion(crearQueryClient());
  const onFallo = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDescargas(onFallo), { wrapper });
  return { queryClient, onFallo, result };
}

describe('useDescargas: descarga', () => {
  it('marca el documento mientras se descarga, lo guarda con su nombre y lo libera al terminar', async () => {
    let entregar!: (respuesta: Response) => void;
    servidor.archivo = () => new Promise((resolve) => (entregar = resolve));
    const { result, onFallo } = preparar();

    let descarga!: Promise<void>;
    act(() => {
      descarga = result.current.descargar(DOCUMENTO);
    });
    expect(result.current.idsDescargando).toEqual([DOCUMENTO.id]);

    await act(async () => {
      entregar(archivo());
      await descarga;
    });
    expect(result.current.idsDescargando).toEqual([]);
    expect(enlaces).toEqual(['print.pdf']);
    expect(onFallo).not.toHaveBeenCalled();
  });

  it('no repite una descarga en curso, aunque los dos clics lleguen antes de volver a renderizar', async () => {
    let entregar!: (respuesta: Response) => void;
    servidor.archivo = () => new Promise((resolve) => (entregar = resolve));
    const { result } = preparar();

    let primera!: Promise<void>;
    await act(async () => {
      primera = result.current.descargar(DOCUMENTO);
      await result.current.descargar(DOCUMENTO);
    });
    expect(descargasDe(DOCUMENTO)).toBe(1);

    await act(async () => {
      entregar(archivo());
      await primera;
    });
    // Terminada, se puede volver a descargar.
    servidor.archivo = archivo;
    await act(() => result.current.descargar(DOCUMENTO));
    expect(descargasDe(DOCUMENTO)).toBe(2);
    expect(result.current.idsDescargando).toEqual([]);
  });
});

describe('useDescargas: sesión (401)', () => {
  it('si la sesión terminó: la confirma una vez, la termina sin "sin guardar" y no avisa nada acá', async () => {
    servidor.archivo = VENCIDA;
    servidor.sesion = VENCIDA;
    const { result, queryClient, onFallo } = preparar();

    await act(() => result.current.descargar(DOCUMENTO));

    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    // El motivo que `/login` explica; sin `sinGuardar`: una descarga no es un formulario.
    expect(urlDeLogin(queryClient, null)).toBe('/login?motivo=vencida');
    expect(pedidosA('/auth/sesion')).toBe(1);
    expect(descargasDe(DOCUMENTO)).toBe(1);
    expect(onFallo).not.toHaveBeenCalled();
    expect(result.current.idsDescargando).toEqual([]);
  });

  it('si era un 401 atrasado (la cookie rotó): la sesión sigue, avisa y no reintenta sola', async () => {
    servidor.archivo = () => error(401, 'UNAUTHENTICATED', { motivo: 'SESION_REQUERIDA' });
    const { result, queryClient, onFallo } = preparar();

    await act(() => result.current.descargar(DOCUMENTO));

    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(pedidosA('/auth/sesion')).toBe(1);
    expect(descargasDe(DOCUMENTO)).toBe(1);
    expect(onFallo).toHaveBeenCalledExactlyOnceWith(DOCUMENTO, { tipo: 'sin-sesion' });
  });

  it('si no se puede confirmar (el servidor no responde), no la da por terminada', async () => {
    servidor.archivo = VENCIDA;
    servidor.sesion = () => error(503, 'SERVICE_UNAVAILABLE');
    const { result, queryClient, onFallo } = preparar();

    await act(() => result.current.descargar(DOCUMENTO));

    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(onFallo).toHaveBeenCalledExactlyOnceWith(DOCUMENTO, { tipo: 'sin-sesion' });
  });

  it('dos descargas que dan 401 a la vez comparten una sola confirmación', async () => {
    servidor.archivo = VENCIDA;
    servidor.sesion = VENCIDA;
    const { result, queryClient, onFallo } = preparar();

    await act(() =>
      Promise.all([result.current.descargar(DOCUMENTO), result.current.descargar(OTRO)]),
    );

    expect(pedidosA('/auth/sesion')).toBe(1);
    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    expect(onFallo).not.toHaveBeenCalled();
  });
});

describe('useDescargas: otros errores', () => {
  it('403: la sesión sigue (con sus datos) y se revalida; avisa que no tiene permiso', async () => {
    servidor.archivo = () => error(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' });
    const { result, queryClient, onFallo } = preparar();
    queryClient.setQueryData(['documentos', 'lista'], ['dato que no se descarta']);

    await act(() => result.current.descargar(DOCUMENTO));

    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(queryClient.getQueryState(CLAVE_SESION)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(['documentos', 'lista'])).toEqual(['dato que no se descarta']);
    expect(onFallo).toHaveBeenCalledExactlyOnceWith(DOCUMENTO, { tipo: 'sin-permiso' });
  });

  it.each([
    ['404', () => error(404, 'NOT_FOUND'), 'no-existe'],
    ['503', () => error(503, 'SERVICE_UNAVAILABLE'), 'no-disponible'],
    ['sin red', () => Promise.reject(new TypeError('Failed to fetch')), 'conexion'],
  ] as const)('%s: avisa el motivo y la sesión no se toca', async (_caso, responder, tipo) => {
    servidor.archivo = responder;
    const { result, queryClient, onFallo } = preparar();

    await act(() => result.current.descargar(DOCUMENTO));

    expect(onFallo).toHaveBeenCalledExactlyOnceWith(DOCUMENTO, { tipo });
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(queryClient.getQueryState(CLAVE_SESION)?.isInvalidated).toBe(false);
    expect(pedidosA('/auth/sesion')).toBe(0);
    await waitFor(() => expect(result.current.idsDescargando).toEqual([]));
  });
});
