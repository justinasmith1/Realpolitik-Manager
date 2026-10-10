import { ApiClientError } from '@/lib/http';
import {
  actualizarCliente,
  cambiarEstadoCliente,
  causaDeError,
  crearCliente,
  diagnosticoDeError,
  listarClientes,
  interpretarFalloAlta,
  interpretarFalloCambioEstado,
  type NuevoCliente,
} from '@/modules/clientes/api/clientes.api';

const fetchMock = vi.fn<typeof fetch>();

// Datos ficticios. 20-12345678-6 es válido por Módulo 11.
const nuevoCliente: NuevoCliente = {
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
};

const clienteCreado = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
  emailsAdicionales: [],
  periodicidad: null,
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorHttp(status: number, payload: unknown) {
  return new ApiClientError({ kind: 'http', message: `HTTP ${status}`, status, payload });
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('crearCliente', () => {
  it('hace POST /clientes con el cuerpo en JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 201));

    await crearCliente(nuevoCliente);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/clientes');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(nuevoCliente);
  });

  it('devuelve el cliente creado validado con el schema compartido (fechas como Date)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 201));

    const cliente = await crearCliente(nuevoCliente);

    expect(cliente).toMatchObject({
      id: clienteCreado.id,
      cuit: '20-12345678-6',
      estado: 'ACTIVO',
    });
    expect(cliente.creadoEn).toEqual(new Date('2026-10-08T12:00:00.000Z'));
  });

  it('rechaza con el ApiClientError de http() sin modificarlo', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'CONFLICT', message: 'x', details: {} } }, 409),
    );

    const error = await crearCliente(nuevoCliente).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 409 });
  });

  it('rechaza si la respuesta no cumple el contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteCreado, cuit: 'no-es-un-cuit' }, 201));

    await expect(crearCliente(nuevoCliente)).rejects.toThrow();
  });

  it('envía la periodicidad tal cual, con día y mes numéricos', async () => {
    const periodicidad = { tipo: 'BIMESTRAL', diaLimite: 10, mesInicioCiclo: 3 } as const;
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteCreado, periodicidad }, 201));

    const cliente = await crearCliente({ ...nuevoCliente, periodicidad });

    const cuerpo = (fetchMock.mock.calls[0]?.[1]?.body ?? '') as string;
    expect(JSON.parse(cuerpo)).toStrictEqual({ ...nuevoCliente, periodicidad });
    expect(cuerpo).toContain('"diaLimite":10,"mesInicioCiclo":3');
    expect(cliente.periodicidad).toEqual(periodicidad);
  });

  it('rechaza una respuesta sin la clave periodicidad', async () => {
    const { periodicidad: _omitida, ...sinPeriodicidad } = clienteCreado;
    fetchMock.mockResolvedValue(jsonResponse(sinPeriodicidad, 201));

    await expect(crearCliente(nuevoCliente)).rejects.toThrow();
  });
});

describe('actualizarCliente', () => {
  it('hace PATCH /clientes/:id con los cambios en JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 200));

    await actualizarCliente(clienteCreado.id, { razonSocial: 'Otra S.A.' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example/clientes/${clienteCreado.id}`);
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ razonSocial: 'Otra S.A.' });
  });

  it('envía periodicidad: null para borrarla (no la omite)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteCreado, 200));

    await actualizarCliente(clienteCreado.id, { periodicidad: null });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"periodicidad":null}');
  });

  it('devuelve el cliente actualizado validado con el schema compartido', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteCreado, razonSocial: 'Otra S.A.' }, 200));

    const cliente = await actualizarCliente(clienteCreado.id, { razonSocial: 'Otra S.A.' });

    expect(cliente).toMatchObject({ id: clienteCreado.id, razonSocial: 'Otra S.A.' });
    expect(cliente.actualizadoEn).toEqual(new Date('2026-10-08T12:00:00.000Z'));
  });

  it('rechaza con el ApiClientError de http() sin modificarlo', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404));

    const error = await actualizarCliente(clienteCreado.id, { razonSocial: 'Otra S.A.' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 404 });
  });
});

describe('cambiarEstadoCliente', () => {
  it('hace PATCH /clientes/:id/estado con el estado en JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteCreado, estado: 'INACTIVO' }, 200));

    await cambiarEstadoCliente(clienteCreado.id, 'INACTIVO');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example/clientes/${clienteCreado.id}/estado`);
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ estado: 'INACTIVO' });
  });

  it('devuelve el cliente con su estado nuevo validado con el schema compartido', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteCreado, estado: 'INACTIVO' }, 200));

    const cliente = await cambiarEstadoCliente(clienteCreado.id, 'INACTIVO');

    expect(cliente).toMatchObject({ id: clienteCreado.id, estado: 'INACTIVO' });
  });

  it('rechaza con el ApiClientError de http() sin modificarlo', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404));

    const error = await cambiarEstadoCliente(clienteCreado.id, 'ACTIVO').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 404 });
  });
});

describe('interpretarFalloCambioEstado', () => {
  it('un 404 NOT_FOUND es que el cliente ya no existe', () => {
    const error = errorHttp(404, { error: { code: 'NOT_FOUND', message: 'x' } });

    expect(interpretarFalloCambioEstado(error)).toEqual({ tipo: 'no-existe' });
  });

  it.each([
    ['un 404 sin el formato del contrato', errorHttp(404, '<html>')],
    ['un 400', errorHttp(400, { error: { code: 'VALIDATION_ERROR', details: [] } })],
    ['un 500', errorHttp(500, { error: { code: 'INTERNAL_ERROR' } })],
    [
      'un fallo de red',
      new ApiClientError({ kind: 'network', message: 'sin conexión', payload: undefined }),
    ],
    ['un error cualquiera', new Error('boom')],
  ])('%s es inesperado', (_caso, error) => {
    expect(interpretarFalloCambioEstado(error)).toEqual({ tipo: 'inesperado' });
  });
});

describe('listarClientes: estado', () => {
  it('sin estado no envía el parámetro (la API devuelve los activos)', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await listarClientes({});

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/clientes');
  });

  it('con estado INACTIVO lo envía junto con los demás filtros', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await listarClientes({ estado: 'INACTIVO', sector: 'PUBLICO', q: 'muni' });

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      estado: 'INACTIVO',
      sector: 'PUBLICO',
      q: 'muni',
    });
  });
});

describe('interpretarFalloAlta', () => {
  const conflictoCuit = (clienteExistente: unknown) =>
    errorHttp(409, {
      error: {
        code: 'CONFLICT',
        message: 'Ya existe un cliente con ese CUIT',
        details: { motivo: 'CUIT_DUPLICADO', clienteExistente },
      },
    });

  it('reconoce el CUIT duplicado y el cliente que ya lo tiene', () => {
    const existente = {
      id: 'd4e5f6a7-b8c9-4012-9ef0-123456789012',
      razonSocial: 'Cliente Existente S.A.',
      estado: 'INACTIVO',
    };

    expect(interpretarFalloAlta(conflictoCuit(existente))).toEqual({
      tipo: 'cuit-duplicado',
      clienteExistente: existente,
    });
  });

  it('sigue informando el CUIT duplicado si el cliente existente viene incompleto', () => {
    expect(interpretarFalloAlta(conflictoCuit({ id: 'x' }))).toEqual({
      tipo: 'cuit-duplicado',
      clienteExistente: null,
    });
  });

  it('lista los campos de un 400 VALIDATION_ERROR', () => {
    const error = errorHttp(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos',
        details: [{ campo: 'cuit', mensaje: 'Required' }, { otro: 1 }],
      },
    });

    expect(interpretarFalloAlta(error)).toEqual({ tipo: 'datos-invalidos', campos: ['cuit'] });
  });

  it.each([
    [
      'un 409 con otro motivo',
      errorHttp(409, { error: { code: 'CONFLICT', details: { motivo: 'OTRO' } } }),
    ],
    ['un 500', errorHttp(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } })],
    ['un cuerpo que no es del contrato', errorHttp(409, '<html>error</html>')],
    [
      'un fallo de red',
      new ApiClientError({ kind: 'network', message: 'Network request failed.' }),
    ],
    ['un error que no viene de http()', new Error('respuesta inválida')],
  ])('trata %s como inesperado', (_caso, error) => {
    expect(interpretarFalloAlta(error)).toEqual({ tipo: 'inesperado' });
  });
});

describe('listarClientes', () => {
  it('hace GET /clientes sin query cuando no hay filtros', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await listarClientes();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/clientes');
    expect(init?.method).toBeUndefined();
  });

  it('envía solo los filtros con valor', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([], 200))
      .mockResolvedValueOnce(jsonResponse([], 200));

    await listarClientes({ q: 'muni', sector: 'PUBLICO', subtipo: undefined });
    await listarClientes({ q: '', sector: 'PRIVADO' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/clientes?q=muni&sector=PUBLICO');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example/clientes?sector=PRIVADO');
  });

  it('codifica el texto de búsqueda', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await listarClientes({ q: 'Ñandú & Cía' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example/clientes?q=%C3%91and%C3%BA+%26+C%C3%ADa',
    );
  });

  it('valida la respuesta con el schema compartido (fechas como Date)', async () => {
    fetchMock.mockResolvedValue(jsonResponse([clienteCreado], 200));

    const [cliente] = await listarClientes();

    expect(cliente?.razonSocial).toBe('Empresa de Ejemplo S.A.');
    expect(cliente?.creadoEn).toBeInstanceOf(Date);
  });

  it('rechaza una respuesta que no cumple el contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ ...clienteCreado, sector: 'MIXTO' }], 200));

    await expect(listarClientes()).rejects.toThrow();
  });

  it('propaga el ApiClientError si la API falla', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));

    await expect(listarClientes()).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe('diagnosticoDeError', () => {
  it.each([
    [
      'sin respuesta del servidor',
      new ApiClientError({ kind: 'network', message: 'x' }),
      'NETWORK_ERROR',
    ],
    [
      'configuración inválida',
      new ApiClientError({ kind: 'configuration', message: 'x' }),
      'CONFIG_ERROR',
    ],
    ['respuesta HTTP', errorHttp(503, undefined), 'HTTP_503'],
    ['error de otro tipo', new Error('x'), 'ERROR_INESPERADO'],
  ])('%s', (_caso, error, esperado) => {
    expect(diagnosticoDeError(error)).toBe(esperado);
  });
});

describe('causaDeError', () => {
  it.each([
    [
      'sin respuesta del servidor',
      new ApiClientError({ kind: 'network', message: 'x' }),
      'conexion',
    ],
    [
      'configuración inválida',
      new ApiClientError({ kind: 'configuration', message: 'x' }),
      'configuracion',
    ],
    ['un 500', errorHttp(500, undefined), 'servidor'],
    ['un 503', errorHttp(503, undefined), 'servidor'],
    ['un 404', errorHttp(404, undefined), 'inesperado'],
    ['un error de otro tipo', new Error('x'), 'inesperado'],
  ])('%s', (_caso, error, esperado) => {
    expect(causaDeError(error)).toBe(esperado);
  });
});
