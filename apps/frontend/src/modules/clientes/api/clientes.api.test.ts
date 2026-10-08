import { ApiClientError } from '@/lib/http';
import {
  crearCliente,
  interpretarFalloAlta,
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
