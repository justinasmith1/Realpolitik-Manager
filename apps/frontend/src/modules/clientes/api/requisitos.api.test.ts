import { ApiClientError } from '@/lib/http';
import {
  actualizarRequisito,
  crearRequisito,
  eliminarRequisito,
  interpretarFalloRequisito,
  listarRequisitos,
  requisitosQueryKey,
} from '@/modules/clientes/api/requisitos.api';

const fetchMock = vi.fn<typeof fetch>();

const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const REQUISITO_ID = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const TIPO_ID = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const OTRO_TIPO_ID = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';

const requisito = (extra: Record<string, unknown> = {}) => ({
  id: REQUISITO_ID,
  clienteId: CLIENTE_ID,
  tipoDocumento: { id: TIPO_ID, nombre: 'Print', activo: true },
  cantidad: 3,
  diasAproximados: [1, 10, 20],
  canalEntrega: null,
  nota: 'Prints de la pauta de radio',
  creadoEn: '2026-10-20T12:00:00.000Z',
  actualizadoEn: '2026-10-20T12:00:00.000Z',
  ...extra,
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorHttp(status: number, payload: unknown) {
  return new ApiClientError({ kind: 'http', message: `HTTP ${status}`, status, payload });
}

const llamada = (indice = 0) => {
  const [url, init] = fetchMock.mock.calls[indice] ?? [];
  return { url, init, cuerpo: JSON.parse((init?.body ?? 'null') as string) as unknown };
};

const errorDeContrato = (status: number, code: string, details?: unknown) =>
  jsonResponse(
    { error: { code, message: 'x', ...(details === undefined ? {} : { details }) } },
    status,
  );

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('requisitosQueryKey', () => {
  it('nombra al cliente y no comparte la rama del listado ni la del detalle', () => {
    expect(requisitosQueryKey(CLIENTE_ID)).toEqual(['clientes', CLIENTE_ID, 'requisitos']);
    expect(requisitosQueryKey(CLIENTE_ID)[1]).not.toBe('lista');
    expect(requisitosQueryKey(CLIENTE_ID)[1]).not.toBe('detalle');
  });
});

describe('listarRequisitos', () => {
  it('hace GET /clientes/:id/requisitos y respeta el orden recibido', async () => {
    const primeroInactivo = requisito({
      id: 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789',
      tipoDocumento: { id: OTRO_TIPO_ID, nombre: 'Ácido', activo: false },
    });
    fetchMock.mockResolvedValue(jsonResponse([primeroInactivo, requisito()], 200));

    const requisitos = await listarRequisitos(CLIENTE_ID);

    expect(llamada().url).toBe(`https://api.example/clientes/${CLIENTE_ID}/requisitos`);
    expect(llamada().init?.method).toBeUndefined();
    expect(requisitos.map((item) => item.tipoDocumento.nombre)).toEqual(['Ácido', 'Print']);
    expect(requisitos.map((item) => item.tipoDocumento.activo)).toEqual([false, true]);
  });

  it('devuelve un requisito con tipo activo, fechas como Date y sin reordenar los días', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([requisito({ diasAproximados: [20, 1, 5], cantidad: 2 })], 200),
    );

    const [item] = await listarRequisitos(CLIENTE_ID);

    expect(item?.tipoDocumento).toEqual({ id: TIPO_ID, nombre: 'Print', activo: true });
    expect(item?.diasAproximados).toEqual([20, 1, 5]);
    expect(item?.creadoEn).toEqual(new Date('2026-10-20T12:00:00.000Z'));
  });

  it('pasa el AbortSignal y una cancelación no se envuelve en ApiClientError', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(jsonResponse([], 200));

    await listarRequisitos(CLIENTE_ID, controller.signal);
    expect(llamada().init?.signal).toBe(controller.signal);

    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    const error = await listarRequisitos(CLIENTE_ID, controller.signal).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(ApiClientError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('devuelve una lista vacía tal cual', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await expect(listarRequisitos(CLIENTE_ID)).resolves.toEqual([]);
  });

  it('rechaza una respuesta que no cumple el contrato, sin envolverla', async () => {
    fetchMock.mockResolvedValue(jsonResponse([requisito({ cantidad: 0 })], 200));

    const error = await listarRequisitos(CLIENTE_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiClientError);
    expect(interpretarFalloRequisito(error)).toEqual({ tipo: 'inesperado' });
  });

  it('propaga un error HTTP desconocido y uno de red', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'TEAPOT' } }, 418));
    const httpError = await listarRequisitos(CLIENTE_ID).catch((e: unknown) => e);
    expect(httpError).toMatchObject({ kind: 'http', status: 418 });
    expect(interpretarFalloRequisito(httpError)).toEqual({ tipo: 'inesperado' });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const red = await listarRequisitos(CLIENTE_ID).catch((e: unknown) => e);
    expect(red).toMatchObject({ kind: 'network' });
    expect(interpretarFalloRequisito(red)).toEqual({ tipo: 'inesperado' });
  });
});

describe('crearRequisito', () => {
  it('envía solo tipoDocumentoId cuando el resto no viene (sin defaults ni clienteId)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 201));
    const datos = Object.assign({ tipoDocumentoId: TIPO_ID }, { clienteId: CLIENTE_ID });

    await crearRequisito(CLIENTE_ID, datos);

    const { url, init, cuerpo } = llamada();
    expect(url).toBe(`https://api.example/clientes/${CLIENTE_ID}/requisitos`);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(cuerpo).toStrictEqual({ tipoDocumentoId: TIPO_ID });
  });

  it('envía cantidad y días tal cual, sin ordenarlos ni completar canal y nota', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 201));

    await crearRequisito(CLIENTE_ID, {
      tipoDocumentoId: TIPO_ID,
      cantidad: 3,
      diasAproximados: [20, 1, 10],
    });

    expect(llamada().cuerpo).toStrictEqual({
      tipoDocumentoId: TIPO_ID,
      cantidad: 3,
      diasAproximados: [20, 1, 10],
    });
  });

  it('devuelve el requisito creado validado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 201));

    const creado = await crearRequisito(CLIENTE_ID, { tipoDocumentoId: TIPO_ID });

    expect(creado).toMatchObject({ id: REQUISITO_ID, clienteId: CLIENTE_ID, cantidad: 3 });
    expect(creado.actualizadoEn).toEqual(new Date('2026-10-20T12:00:00.000Z'));
  });

  it('codifica el id del cliente', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 201));

    await crearRequisito('a/b?c', { tipoDocumentoId: TIPO_ID });

    expect(llamada().url).toBe('https://api.example/clientes/a%2Fb%3Fc/requisitos');
  });
});

describe('actualizarRequisito', () => {
  it('hace PATCH solo con los campos enviados', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito({ cantidad: 2 }), 200));

    await actualizarRequisito(CLIENTE_ID, REQUISITO_ID, { cantidad: 2 });

    const { url, init, cuerpo } = llamada();
    expect(url).toBe(`https://api.example/clientes/${CLIENTE_ID}/requisitos/${REQUISITO_ID}`);
    expect(init?.method).toBe('PATCH');
    expect(cuerpo).toStrictEqual({ cantidad: 2 });
  });

  it('nota: null viaja como null y no arrastra el resto', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito({ nota: null }), 200));

    await actualizarRequisito(CLIENTE_ID, REQUISITO_ID, { nota: null });

    expect(llamada().cuerpo).toStrictEqual({ nota: null });
  });

  it('canalEntrega: null viaja como null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 200));

    await actualizarRequisito(CLIENTE_ID, REQUISITO_ID, { canalEntrega: null });

    expect(llamada().cuerpo).toStrictEqual({ canalEntrega: null });
  });

  it('no manda tipoDocumentoId aunque venga en el objeto', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 200));
    const datos = Object.assign({ cantidad: 2 }, { tipoDocumentoId: OTRO_TIPO_ID });

    await actualizarRequisito(CLIENTE_ID, REQUISITO_ID, datos);

    expect(llamada().cuerpo).toStrictEqual({ cantidad: 2 });
  });

  it('no convierte un campo ausente en null ni en el resto de los campos', async () => {
    fetchMock.mockResolvedValue(jsonResponse(requisito(), 200));

    await actualizarRequisito(CLIENTE_ID, REQUISITO_ID, { nota: 'Solo la nota' });

    expect(llamada().cuerpo).toStrictEqual({ nota: 'Solo la nota' });
  });
});

describe('eliminarRequisito', () => {
  it('hace DELETE y resuelve en 204 sin leer el cuerpo', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(eliminarRequisito(CLIENTE_ID, REQUISITO_ID)).resolves.toBeUndefined();

    const { url, init } = llamada();
    expect(url).toBe(`https://api.example/clientes/${CLIENTE_ID}/requisitos/${REQUISITO_ID}`);
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBeUndefined();
  });

  it('un 200 no cuenta como baja: no se parsea y no se toma como éxito', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const error = await eliminarRequisito(CLIENTE_ID, REQUISITO_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 200 });
  });

  it('un 404 rechaza con el ApiClientError de http()', async () => {
    fetchMock.mockResolvedValue(errorDeContrato(404, 'NOT_FOUND'));

    const error = await eliminarRequisito(CLIENTE_ID, REQUISITO_ID).catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: 'http', status: 404 });
    expect(interpretarFalloRequisito(error)).toEqual({ tipo: 'no-existe' });
  });
});

describe('interpretarFalloRequisito', () => {
  const detalles = [
    { campo: 'cantidad', mensaje: 'La cantidad debe ser al menos 1.' },
    { campo: 'diasAproximados', mensaje: 'Cargá tantos días como indique la cantidad.' },
    {
      campo: 'canalEntrega',
      mensaje: 'El canal de entrega debe ser CORREO, PORTAL_WEB o WHATSAPP.',
    },
    { campo: 'nota', mensaje: 'La nota no puede superar los 500 caracteres.' },
    { campo: 'tipoDocumentoId', mensaje: 'El tipo de documento está inactivo.' },
  ];

  it('un 400 VALIDATION_ERROR devuelve los errores por campo', () => {
    const fallo = interpretarFalloRequisito(
      errorHttp(400, { error: { code: 'VALIDATION_ERROR', details: detalles } }),
    );

    expect(fallo).toEqual({ tipo: 'datos-invalidos', detalles });
  });

  it('descarta detalles mal formados y sigue con los que sí se pueden leer', () => {
    const fallo = interpretarFalloRequisito(
      errorHttp(400, {
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            { campo: 'cantidad', mensaje: 'La cantidad debe ser al menos 1.' },
            { mensaje: 'sin campo' },
            'no',
          ],
        },
      }),
    );

    expect(fallo).toEqual({
      tipo: 'datos-invalidos',
      detalles: [{ campo: 'cantidad', mensaje: 'La cantidad debe ser al menos 1.' }],
    });
  });

  it('un 400 con details que no es una lista sigue siendo datos inválidos, sin detalles', () => {
    expect(
      interpretarFalloRequisito(
        errorHttp(400, { error: { code: 'VALIDATION_ERROR', details: { campo: 'cantidad' } } }),
      ),
    ).toEqual({ tipo: 'datos-invalidos', detalles: [] });
  });

  it('un 404 NOT_FOUND es que algo no existe, sin decir qué', () => {
    expect(
      interpretarFalloRequisito(errorHttp(404, { error: { code: 'NOT_FOUND', message: 'x' } })),
    ).toEqual({ tipo: 'no-existe' });
  });

  it('lee REQUISITO_DUPLICADO y el requisito existente', () => {
    const requisitoExistente = { id: REQUISITO_ID, tipoDocumentoId: TIPO_ID, cantidad: 3 };

    expect(
      interpretarFalloRequisito(
        errorHttp(409, {
          error: {
            code: 'CONFLICT',
            details: { motivo: 'REQUISITO_DUPLICADO', requisitoExistente },
          },
        }),
      ),
    ).toEqual({ tipo: 'requisito-duplicado', requisitoExistente });
  });

  it('un duplicado sin el requisito, o con una forma rara, no inventa el registro', () => {
    const duplicado = (requisitoExistente: unknown) =>
      errorHttp(409, {
        error: { code: 'CONFLICT', details: { motivo: 'REQUISITO_DUPLICADO', requisitoExistente } },
      });

    expect(interpretarFalloRequisito(duplicado(undefined))).toEqual({
      tipo: 'requisito-duplicado',
      requisitoExistente: null,
    });
    expect(interpretarFalloRequisito(duplicado({ id: REQUISITO_ID }))).toEqual({
      tipo: 'requisito-duplicado',
      requisitoExistente: null,
    });
    expect(interpretarFalloRequisito(duplicado('x'))).toEqual({
      tipo: 'requisito-duplicado',
      requisitoExistente: null,
    });
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)('CLIENTE_NO_ACTIVO lee el estado %s', (estado) => {
    expect(
      interpretarFalloRequisito(
        errorHttp(409, {
          error: { code: 'CONFLICT', details: { motivo: 'CLIENTE_NO_ACTIVO', estado } },
        }),
      ),
    ).toEqual({ tipo: 'cliente-no-activo', estado });
  });

  it('un cliente no activo con estado ausente o desconocido no inventa el estado', () => {
    const conflicto = (estado: unknown) =>
      errorHttp(409, {
        error: { code: 'CONFLICT', details: { motivo: 'CLIENTE_NO_ACTIVO', estado } },
      });

    expect(interpretarFalloRequisito(conflicto(undefined))).toEqual({
      tipo: 'cliente-no-activo',
      estado: null,
    });
    expect(interpretarFalloRequisito(conflicto('PAUSADO'))).toEqual({
      tipo: 'cliente-no-activo',
      estado: null,
    });
  });

  it.each([
    [
      'un 409 con otro motivo',
      errorHttp(409, { error: { code: 'CONFLICT', details: { motivo: 'OTRO' } } }),
    ],
    ['un 409 sin details', errorHttp(409, { error: { code: 'CONFLICT' } })],
    [
      'un 409 cuyo details no es un objeto',
      errorHttp(409, { error: { code: 'CONFLICT', details: [] } }),
    ],
    [
      'un 409 sin code CONFLICT',
      errorHttp(409, { error: { code: 'OTRO', details: { motivo: 'REQUISITO_DUPLICADO' } } }),
    ],
    ['un 400 que no es VALIDATION_ERROR', errorHttp(400, { error: { code: 'BAD_REQUEST' } })],
    ['un 404 sin el formato del contrato', errorHttp(404, 'no encontrado')],
    ['un 404 sin cuerpo', errorHttp(404, undefined)],
    ['un 500', errorHttp(500, { error: { code: 'INTERNAL_ERROR' } })],
    ['sin conexión', new ApiClientError({ kind: 'network', message: 'Network request failed.' })],
    ['configuración inválida', new ApiClientError({ kind: 'configuration', message: 'x' })],
    ['una respuesta que no cumple el schema', new Error('respuesta inválida')],
  ])('trata %s como inesperado', (_caso, error) => {
    expect(interpretarFalloRequisito(error)).toEqual({ tipo: 'inesperado' });
  });

  it('el POST y el PATCH propagan el 400 y los 409 para que el intérprete los lea', async () => {
    fetchMock.mockResolvedValueOnce(
      errorDeContrato(400, 'VALIDATION_ERROR', [
        { campo: 'cantidad', mensaje: 'La cantidad debe ser al menos 1.' },
      ]),
    );
    const validacion = await crearRequisito(CLIENTE_ID, { tipoDocumentoId: TIPO_ID }).catch(
      (e: unknown) => e,
    );
    expect(interpretarFalloRequisito(validacion)).toEqual({
      tipo: 'datos-invalidos',
      detalles: [{ campo: 'cantidad', mensaje: 'La cantidad debe ser al menos 1.' }],
    });

    fetchMock.mockResolvedValueOnce(
      errorDeContrato(409, 'CONFLICT', {
        motivo: 'REQUISITO_DUPLICADO',
        requisitoExistente: { id: REQUISITO_ID, tipoDocumentoId: TIPO_ID, cantidad: 3 },
      }),
    );
    const duplicado = await crearRequisito(CLIENTE_ID, { tipoDocumentoId: TIPO_ID }).catch(
      (e: unknown) => e,
    );
    expect(interpretarFalloRequisito(duplicado)).toMatchObject({ tipo: 'requisito-duplicado' });

    fetchMock.mockResolvedValueOnce(
      errorDeContrato(409, 'CONFLICT', { motivo: 'CLIENTE_NO_ACTIVO', estado: 'INACTIVO' }),
    );
    const inactivo = await actualizarRequisito(CLIENTE_ID, REQUISITO_ID, { nota: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(interpretarFalloRequisito(inactivo)).toEqual({
      tipo: 'cliente-no-activo',
      estado: 'INACTIVO',
    });
  });
});
