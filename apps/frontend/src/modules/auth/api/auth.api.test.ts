import { ApiClientError } from '@/lib/http';
import {
  cambiarContrasena,
  cerrarSesion,
  iniciarSesion,
  obtenerSesionActual,
} from '@/modules/auth/api/auth.api';
import { sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';

const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, cuerpo?: unknown) =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/** El único pedido hecho: URL, opciones y cabeceras tal como llegaron a `fetch`. */
function pedido() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init = {}] = fetchMock.mock.calls[0] ?? [];
  return { url, init, headers: new Headers(init.headers) };
}

describe('servicio de autenticación', () => {
  it('iniciarSesion: POST relativo a /api, credenciales solo en el cuerpo, sin tokens', async () => {
    fetchMock.mockResolvedValue(json(200, sesionDePrueba()));

    const sesion = await iniciarSesion({ email: 'ana@realpolitik.test', password: 'secreta 123' });

    const { url, init, headers } = pedido();
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ana@realpolitik.test',
      password: 'secreta 123',
    });
    expect(headers.get('Content-Type')).toBe('application/json');
    // La cookie HttpOnly la maneja el navegador: mismo origen, sin `include` y sin Authorization.
    expect(init.credentials).toBeUndefined();
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('Cookie')).toBe(false);
    expect(url).not.toContain('secreta');
    expect(sesion.usuario.rol).toBe('ADMINISTRATIVO');
  });

  it('obtenerSesionActual: 200 → sesión; 401 → null (sin sesión no es un error)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, sesionDePrueba()));
    await expect(obtenerSesionActual()).resolves.toEqual(sesionDePrueba());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/sesion');

    fetchMock.mockResolvedValueOnce(
      json(401, { error: { code: 'UNAUTHENTICATED', details: { motivo: 'SESION_REQUERIDA' } } }),
    );
    await expect(obtenerSesionActual()).resolves.toBeNull();
  });

  it('obtenerSesionActual: 503 y red caída rechazan (no se confunden con "sin sesión")', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: { code: 'SERVICE_UNAVAILABLE' } }));
    await expect(obtenerSesionActual()).rejects.toMatchObject({ kind: 'http', status: 503 });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(obtenerSesionActual()).rejects.toMatchObject({ kind: 'network' });
  });

  it('obtenerSesionActual: una respuesta que no cumple el contrato no se toma como sesión', async () => {
    fetchMock.mockResolvedValue(json(200, { usuario: { email: 'x', permisos: ['todo'] } }));
    await expect(obtenerSesionActual()).rejects.not.toBeInstanceOf(ApiClientError);
  });

  it('cerrarSesion: POST; resuelve solo con el 204, un 503 rechaza', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(cerrarSesion()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/logout');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');

    fetchMock.mockResolvedValueOnce(json(503, { error: { code: 'SERVICE_UNAVAILABLE' } }));
    await expect(cerrarSesion()).rejects.toMatchObject({ status: 503 });
  });

  it('cambiarContrasena: PUT con { actual, nueva } y nada más', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await cambiarContrasena({ actual: 'temporal', nueva: 'una frase bien larga' });

    const { url, init } = pedido();
    expect(url).toBe('/api/auth/password');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      actual: 'temporal',
      nueva: 'una frase bien larga',
    });
  });

  it('el 429 expone Retry-After en segundos', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'TOO_MANY_REQUESTS' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '120' },
      }),
    );
    await expect(iniciarSesion({ email: 'a@b.co', password: 'x' })).rejects.toMatchObject({
      status: 429,
      retryAfterSegundos: 120,
    });
  });
});
