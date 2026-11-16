import { ApiClientError } from '@/lib/http';
import {
  actualizarUsuario,
  cambiarEstadoUsuario,
  crearUsuario,
  hayQueReleerElListado,
  interpretarFalloDeUsuario,
  listaUsuariosQueryKey,
  listarUsuarios,
  restablecerContrasena,
  usuariosQueryKey,
} from '@/modules/usuarios/api/usuarios.api';

const fetchMock = vi.fn<typeof fetch>();
const BASE = 'https://api.example';
const ID = '0b0b0b0b-0000-4000-8000-000000000001';
const TEMPORAL = 'Qm9ndXMtdGVtcG9yYWwtc29sby10ZXN0';

// Una cuenta como la devuelve la API (datos ficticios).
const usuario = {
  id: ID,
  nombre: 'María Gómez',
  email: 'maria@ejemplo.example',
  rol: 'ADMINISTRATIVO',
  activo: true,
  debeCambiarPassword: true,
  ultimoAccesoEn: null,
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorHttp = (status: number, payload: unknown) =>
  new ApiClientError({ kind: 'http', message: `HTTP ${status}`, status, payload });

const conflicto = (details: unknown) =>
  errorHttp(409, { error: { code: 'CONFLICT', message: 'interno', details } });

const llamada = (indice = 0) => {
  const [url, init] = fetchMock.mock.calls[indice] ?? [];
  return {
    url,
    metodo: init?.method ?? 'GET',
    cuerpo: init?.body === undefined ? undefined : (JSON.parse(init.body as string) as unknown),
  };
};

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('keys de caché', () => {
  it('cuelgan de una raíz propia y normalizan los filtros', () => {
    expect(usuariosQueryKey).toEqual(['usuarios']);
    const porDefecto = ['usuarios', 'lista', { q: null, rol: null, incluirDesactivados: false }];
    expect(listaUsuariosQueryKey()).toEqual(porDefecto);
    expect(listaUsuariosQueryKey({ q: '   ', incluirDesactivados: false })).toEqual(porDefecto);
    expect(
      listaUsuariosQueryKey({ q: ' ana ', rol: 'CONSULTA', incluirDesactivados: true }),
    ).toEqual(['usuarios', 'lista', { q: 'ana', rol: 'CONSULTA', incluirDesactivados: true }]);
  });
});

describe('GET /usuarios', () => {
  it('sin filtros no envía parámetros y valida el arreglo con el schema compartido', async () => {
    fetchMock.mockResolvedValue(
      json([{ ...usuario, ultimoAccesoEn: '2026-11-10T13:00:00.000Z', extra: 'x' }]),
    );
    const usuarios = await listarUsuarios();
    expect(llamada().url).toBe(`${BASE}/usuarios`);
    expect(usuarios).toEqual([
      { ...usuario, ultimoAccesoEn: new Date('2026-11-10T13:00:00.000Z') },
    ]);
  });

  it('envía q (recortada), rol e incluirDesactivados=true, codificados', async () => {
    fetchMock.mockResolvedValue(json([]));
    await listarUsuarios({ q: ' maría & co ', rol: 'CONSULTA', incluirDesactivados: true });
    const url = new URL(llamada().url as string);
    expect(url.pathname).toBe('/usuarios');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'maría & co',
      rol: 'CONSULTA',
      incluirDesactivados: 'true',
    });
  });

  it('rechaza una respuesta con otra forma', async () => {
    fetchMock.mockResolvedValue(json([{ ...usuario, rol: 'ROOT' }]));
    await expect(listarUsuarios()).rejects.toThrow();
  });
});

describe('escrituras', () => {
  it('POST /usuarios envía solo nombre, email y rol, y devuelve la contraseña temporal', async () => {
    fetchMock.mockResolvedValue(json({ usuario, contrasenaTemporal: TEMPORAL }, 201));
    const datos = { nombre: 'María Gómez', email: 'maria@ejemplo.example', rol: 'ADMINISTRATIVO' };
    // Aunque llegue algo de más, solo viajan los tres campos del contrato.
    const conDeMas = { ...datos, password: 'x' } as unknown as Parameters<typeof crearUsuario>[0];
    const creado = await crearUsuario(conDeMas);
    expect(llamada()).toEqual({ url: `${BASE}/usuarios`, metodo: 'POST', cuerpo: datos });
    expect(creado.contrasenaTemporal).toBe(TEMPORAL);
  });

  it('PATCH /usuarios/:id envía solo los cambios, con el id codificado', async () => {
    fetchMock.mockResolvedValue(json({ usuario, modificados: ['nombre'], sesionesRevocadas: 0 }));
    await actualizarUsuario('a/b?c', { nombre: 'Otro' });
    expect(llamada()).toEqual({
      url: `${BASE}/usuarios/a%2Fb%3Fc`,
      metodo: 'PATCH',
      cuerpo: { nombre: 'Otro' },
    });
  });

  it('PATCH /usuarios/:id/estado envía el booleano', async () => {
    fetchMock.mockResolvedValue(json({ usuario, cambio: true, sesionesRevocadas: 2 }));
    const resultado = await cambiarEstadoUsuario(ID, false);
    expect(llamada()).toEqual({
      url: `${BASE}/usuarios/${ID}/estado`,
      metodo: 'PATCH',
      cuerpo: { activo: false },
    });
    expect(resultado.sesionesRevocadas).toBe(2);
  });

  it('POST /usuarios/:id/restablecer-password va sin cuerpo', async () => {
    fetchMock.mockResolvedValue(
      json({ usuario, contrasenaTemporal: TEMPORAL, sesionesRevocadas: 1 }),
    );
    const resultado = await restablecerContrasena(ID);
    expect(llamada()).toEqual({
      url: `${BASE}/usuarios/${ID}/restablecer-password`,
      metodo: 'POST',
      cuerpo: undefined,
    });
    expect(resultado.contrasenaTemporal).toBe(TEMPORAL);
  });

  it('una respuesta 2xx sin la forma del contrato rechaza (no se inventa el resultado)', async () => {
    fetchMock.mockResolvedValue(json({ usuario }, 201));
    await expect(
      crearUsuario({ nombre: 'A', email: 'a@ejemplo.example', rol: 'CONSULTA' }),
    ).rejects.toThrow();
  });

  it.each([
    ['500', () => json({ error: { code: 'INTERNAL_ERROR' } }, 500)],
    ['503', () => json({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503)],
    ['red caída', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('ante %s no reintenta: un solo pedido', async (_, respuesta) => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta()));
    await expect(restablecerContrasena(ID)).rejects.toBeInstanceOf(ApiClientError);
    await expect(cambiarEstadoUsuario(ID, true)).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('interpretarFalloDeUsuario', () => {
  it('distingue los 409 por su motivo', () => {
    expect(
      interpretarFalloDeUsuario(conflicto({ motivo: 'EMAIL_EN_USO', campo: 'email' })),
    ).toEqual({ tipo: 'email-en-uso' });
    expect(
      interpretarFalloDeUsuario(
        conflicto({ motivo: 'OPERACION_SOBRE_CUENTA_PROPIA', operacion: 'desactivar' }),
      ),
    ).toEqual({ tipo: 'cuenta-propia', operacion: 'desactivar' });
    expect(
      interpretarFalloDeUsuario(
        conflicto({ motivo: 'OPERACION_SOBRE_CUENTA_PROPIA', operacion: 'otra' }),
      ),
    ).toEqual({ tipo: 'cuenta-propia', operacion: null });
    expect(
      interpretarFalloDeUsuario(
        conflicto({ motivo: 'ULTIMO_ADMINISTRADOR', operacion: 'cambiar-rol' }),
      ),
    ).toEqual({ tipo: 'ultimo-administrador' });
    expect(interpretarFalloDeUsuario(conflicto({ motivo: 'CONFLICTO_DE_CONCURRENCIA' }))).toEqual({
      tipo: 'concurrencia',
    });
    expect(interpretarFalloDeUsuario(conflicto({ motivo: 'OTRO' }))).toEqual({
      tipo: 'inesperado',
    });
  });

  it('400 con sus detalles por campo; 401, 403 y 404', () => {
    expect(
      interpretarFalloDeUsuario(
        errorHttp(400, {
          error: {
            code: 'VALIDATION_ERROR',
            details: [{ campo: 'nombre', mensaje: 'Ingresá el nombre.' }, 'raro'],
          },
        }),
      ),
    ).toEqual({
      tipo: 'datos-invalidos',
      detalles: [{ campo: 'nombre', mensaje: 'Ingresá el nombre.' }],
    });
    expect(interpretarFalloDeUsuario(errorHttp(401, {}))).toEqual({ tipo: 'sin-sesion' });
    expect(
      interpretarFalloDeUsuario(
        errorHttp(403, {
          error: { code: 'FORBIDDEN', details: { motivo: 'PERMISO_INSUFICIENTE' } },
        }),
      ),
    ).toEqual({ tipo: 'sin-permiso' });
    expect(interpretarFalloDeUsuario(errorHttp(404, { error: { code: 'NOT_FOUND' } }))).toEqual({
      tipo: 'no-existe',
    });
  });

  it('solo el 503 de capacidad es definitivo: lo demás de 5xx, la red o una respuesta rara quedan sin confirmar', () => {
    expect(
      interpretarFalloDeUsuario(errorHttp(503, { error: { code: 'SERVICE_UNAVAILABLE' } })),
    ).toEqual({ tipo: 'ocupado' });
    for (const error of [
      errorHttp(503, {
        error: { code: 'SERVICE_UNAVAILABLE', details: { motivo: 'RESULTADO_NO_CONFIRMADO' } },
      }),
      errorHttp(500, {
        error: { code: 'INTERNAL_ERROR', details: { motivo: 'RESULTADO_NO_CONFIRMADO' } },
      }),
      errorHttp(500, { error: { code: 'INTERNAL_ERROR' } }),
      errorHttp(502, '<html>'),
      errorHttp(503, undefined),
      new ApiClientError({ kind: 'network', message: 'Network request failed.' }),
      new Error('la respuesta no cumple el schema'),
    ]) {
      expect(interpretarFalloDeUsuario(error)).toEqual({ tipo: 'no-confirmado' });
    }
  });

  it('dice cuándo el listado pudo quedar desactualizado', () => {
    expect(hayQueReleerElListado({ tipo: 'no-confirmado' })).toBe(true);
    expect(hayQueReleerElListado({ tipo: 'no-existe' })).toBe(true);
    expect(hayQueReleerElListado({ tipo: 'concurrencia' })).toBe(true);
    expect(hayQueReleerElListado({ tipo: 'ultimo-administrador' })).toBe(true);
    expect(hayQueReleerElListado({ tipo: 'datos-invalidos', detalles: [] })).toBe(false);
    expect(hayQueReleerElListado({ tipo: 'ocupado' })).toBe(false);
    expect(hayQueReleerElListado({ tipo: 'sin-permiso' })).toBe(false);
  });
});
