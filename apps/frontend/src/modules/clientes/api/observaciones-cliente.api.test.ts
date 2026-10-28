import { ObservacionesClienteSchema } from '@realpolitik/shared';

import {
  guardarObservacionesCliente,
  interpretarFalloObservaciones,
  obtenerObservacionesCliente,
  observacionesClienteQueryKey,
} from '@/modules/clientes/api/observaciones-cliente.api';

// Endpoints de las observaciones internas (HU2.10, contrato 4.9).

const fetchMock = vi.fn<typeof fetch>();

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RUTA = `/clientes/${CLIENTE}/observaciones`;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorJson = (status: number, code: string, details?: unknown) =>
  jsonResponse(
    { error: { code, message: 'x', ...(details === undefined ? {} : { details }) } },
    status,
  );

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

/** Lo que falló, tal como lo ve quien llama: el error que lanza `guardarObservacionesCliente`. */
async function falloAlGuardar(respuesta: Response): Promise<unknown> {
  fetchMock.mockResolvedValue(respuesta);
  return guardarObservacionesCliente(CLIENTE, { observaciones: 'Texto' }).then(
    () => {
      throw new Error('Tenía que fallar');
    },
    (error: unknown) => error,
  );
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

describe('observacionesClienteQueryKey', () => {
  it('cuelga de la key del cliente', () => {
    expect(observacionesClienteQueryKey(CLIENTE)).toEqual(['clientes', CLIENTE, 'observaciones']);
  });
});

describe('obtenerObservacionesCliente', () => {
  it('pide GET /clientes/:id/observaciones y devuelve la nota', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ observaciones: 'Cambió el mail.' }));

    await expect(obtenerObservacionesCliente(CLIENTE)).resolves.toEqual({
      observaciones: 'Cambió el mail.',
    });
    const [entrada, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(urlDe(entrada as Parameters<typeof fetch>[0])).pathname).toBe(RUTA);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('devuelve null si no hay observaciones', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ observaciones: null }));

    await expect(obtenerObservacionesCliente(CLIENTE)).resolves.toEqual({ observaciones: null });
  });

  it('lee un texto guardado con una tabulación, tal cual', async () => {
    const conTab = 'Cambió\tel mail.\nAvisar a Compras.';
    fetchMock.mockResolvedValue(jsonResponse({ observaciones: conTab }));

    await expect(obtenerObservacionesCliente(CLIENTE)).resolves.toEqual({ observaciones: conTab });
    // Ese mismo texto no se puede guardar: la escritura sigue siendo estricta.
    expect(ObservacionesClienteSchema.safeParse({ observaciones: conTab }).success).toBe(false);
  });

  it('rechaza una respuesta que no tiene la forma del contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ indicacionesArmado: null }));

    await expect(obtenerObservacionesCliente(CLIENTE)).rejects.toThrow();
  });
});

describe('guardarObservacionesCliente', () => {
  it('manda PUT con la clave observaciones y devuelve lo guardado', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ observaciones: 'Pausó la pauta.' }));

    await expect(
      guardarObservacionesCliente(CLIENTE, { observaciones: 'Pausó la pauta.' }),
    ).resolves.toEqual({ observaciones: 'Pausó la pauta.' });
    const [entrada, init] = fetchMock.mock.calls[0] ?? [];
    expect(new URL(urlDe(entrada as Parameters<typeof fetch>[0])).pathname).toBe(RUTA);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ observaciones: 'Pausó la pauta.' });
  });

  it('manda null para borrar la nota', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ observaciones: null }));

    await guardarObservacionesCliente(CLIENTE, { observaciones: null });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      observaciones: null,
    });
  });
});

describe('interpretarFalloObservaciones', () => {
  it('400 VALIDATION_ERROR: datos inválidos, con los detalles del servidor', async () => {
    const error = await falloAlGuardar(
      errorJson(400, 'VALIDATION_ERROR', [
        {
          campo: 'observaciones',
          mensaje: 'Las observaciones no pueden superar los 1000 caracteres.',
        },
      ]),
    );

    expect(interpretarFalloObservaciones(error)).toEqual({
      tipo: 'datos-invalidos',
      detalles: [
        {
          campo: 'observaciones',
          mensaje: 'Las observaciones no pueden superar los 1000 caracteres.',
        },
      ],
    });
  });

  it('404 NOT_FOUND: el cliente ya no existe', async () => {
    const error = await falloAlGuardar(errorJson(404, 'NOT_FOUND'));

    expect(interpretarFalloObservaciones(error)).toEqual({ tipo: 'no-existe' });
  });

  it('500 y errores de red: inesperado', async () => {
    const delServidor = await falloAlGuardar(errorJson(500, 'INTERNAL_ERROR'));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const deRed = await guardarObservacionesCliente(CLIENTE, { observaciones: 'x' }).catch(
      (error: unknown) => error,
    );

    expect(interpretarFalloObservaciones(delServidor)).toEqual({ tipo: 'inesperado' });
    expect(interpretarFalloObservaciones(deRed)).toEqual({ tipo: 'inesperado' });
  });

  it('no hay un fallo "cliente no activo": se guarda con el cliente en cualquier estado', async () => {
    const error = await falloAlGuardar(
      errorJson(409, 'CONFLICT', { motivo: 'CLIENTE_NO_ACTIVO', estado: 'INACTIVO' }),
    );

    expect(interpretarFalloObservaciones(error)).toEqual({ tipo: 'inesperado' });
  });
});
