import { ApiClientError } from '@/lib/http';
import {
  actualizarTipoDocumento,
  cambiarEstadoTipoDocumento,
  crearTipoDocumento,
  interpretarFalloAltaTipoDocumento,
  interpretarFalloCambioEstadoTipoDocumento,
  interpretarFalloEdicionTipoDocumento,
  listaTiposDocumentoQueryKey,
  listarTiposDocumento,
  tiposDocumentoQueryKey,
} from '@/modules/tipos-documento/api/tipos-documento.api';

const fetchMock = vi.fn<typeof fetch>();

const ID = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const OTRO_ID = 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789';

// Datos ficticios, con la forma de `TipoDocumentoSchema`.
const tipoDocumento = {
  id: ID,
  nombre: 'Constancia ARCA',
  descripcion: null,
  activo: true,
  creadoEn: '2026-10-21T12:00:00.000Z',
  actualizadoEn: '2026-10-21T12:00:00.000Z',
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

/** El `409` del contrato por nombre duplicado, con el `tipoDocumentoExistente` indicado. */
const duplicado = (tipoDocumentoExistente: unknown) =>
  errorHttp(409, {
    error: {
      code: 'CONFLICT',
      message: 'Ya existe un tipo de documento con ese nombre',
      details: { motivo: 'TIPO_DOCUMENTO_DUPLICADO', tipoDocumentoExistente },
    },
  });

const noEncontrado = () =>
  errorHttp(404, { error: { code: 'NOT_FOUND', message: 'Tipo de documento no encontrado' } });

const llamada = (indice = 0) => {
  const [url, init] = fetchMock.mock.calls[indice] ?? [];
  return { url, init, cuerpo: JSON.parse((init?.body ?? 'null') as string) as unknown };
};

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('keys de caché', () => {
  it('cuelgan de una raíz propia, separada de clientes', () => {
    expect(tiposDocumentoQueryKey).toEqual(['tipos-documento']);
    expect(listaTiposDocumentoQueryKey()[0]).toBe('tipos-documento');
  });

  it('sin filtro, con undefined y con false son la misma key', () => {
    const esperada = ['tipos-documento', 'lista', { incluirInactivos: false }];
    expect(listaTiposDocumentoQueryKey()).toEqual(esperada);
    expect(listaTiposDocumentoQueryKey({})).toEqual(esperada);
    expect(listaTiposDocumentoQueryKey({ incluirInactivos: undefined })).toEqual(esperada);
    expect(listaTiposDocumentoQueryKey({ incluirInactivos: false })).toEqual(esperada);
  });

  it('incluir inactivos es otra key', () => {
    expect(listaTiposDocumentoQueryKey({ incluirInactivos: true })).toEqual([
      'tipos-documento',
      'lista',
      { incluirInactivos: true },
    ]);
  });
});

describe('listarTiposDocumento', () => {
  it('sin filtro pide GET /tipos-documento, sin parámetros', async () => {
    fetchMock.mockResolvedValue(jsonResponse([tipoDocumento], 200));

    await listarTiposDocumento();

    const { url, init } = llamada();
    expect(url).toBe('https://api.example/tipos-documento');
    expect(init?.method).toBeUndefined();
  });

  it('con incluirInactivos: false tampoco manda el parámetro (es el default de la API)', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await listarTiposDocumento({ incluirInactivos: false });

    expect(llamada().url).toBe('https://api.example/tipos-documento');
  });

  it('con incluirInactivos: true agrega ?incluirInactivos=true', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await listarTiposDocumento({ incluirInactivos: true });

    expect(llamada().url).toBe('https://api.example/tipos-documento?incluirInactivos=true');
  });

  it('pasa el AbortSignal a la request', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));
    const controller = new AbortController();

    await listarTiposDocumento({}, controller.signal);

    expect(llamada().init?.signal).toBe(controller.signal);
  });

  it('una request cancelada rechaza con el AbortError, sin envolverlo en ApiClientError', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const error = await listarTiposDocumento({}, controller.signal).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(ApiClientError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('devuelve los tipos validados, en el orden de la API (fechas como Date)', async () => {
    const otro = { ...tipoDocumento, id: OTRO_ID, nombre: 'Ácido', activo: false };
    fetchMock.mockResolvedValue(jsonResponse([tipoDocumento, otro], 200));

    const tipos = await listarTiposDocumento({ incluirInactivos: true });

    // Sin reordenar: "Constancia ARCA" queda antes que "Ácido" porque así vino.
    expect(tipos.map((tipo) => tipo.nombre)).toEqual(['Constancia ARCA', 'Ácido']);
    expect(tipos[0]?.creadoEn).toEqual(new Date('2026-10-21T12:00:00.000Z'));
  });

  it('devuelve una lista vacía tal cual', async () => {
    fetchMock.mockResolvedValue(jsonResponse([], 200));

    await expect(listarTiposDocumento()).resolves.toEqual([]);
  });

  const { descripcion: _omitida, ...sinDescripcion } = tipoDocumento;

  it.each([
    ['un objeto en vez de una lista', tipoDocumento],
    ['un tipo sin activo', [{ ...tipoDocumento, activo: undefined }]],
    ['un id que no es uuid', [{ ...tipoDocumento, id: '1' }]],
    ['un tipo sin descripción (es obligatoria, aunque sea null)', [sinDescripcion]],
  ])('rechaza una respuesta que no cumple el contrato: %s', async (_caso, cuerpo) => {
    fetchMock.mockResolvedValue(jsonResponse(cuerpo, 200));

    const error = await listarTiposDocumento().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ApiClientError);
  });

  it('no devuelve nombreNormalizado aunque la API lo mandara', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ ...tipoDocumento, nombreNormalizado: 'x' }], 200));

    const [tipo] = await listarTiposDocumento();

    expect(tipo).not.toHaveProperty('nombreNormalizado');
  });

  it('propaga el ApiClientError si la API falla', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));

    const error = await listarTiposDocumento().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 500 });
  });

  it('sin conexión rechaza con un ApiClientError de red', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listarTiposDocumento()).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('crearTipoDocumento', () => {
  it('hace POST /tipos-documento con nombre y descripción en JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tipoDocumento, 201));

    await crearTipoDocumento({ nombre: 'Constancia ARCA', descripcion: 'Inscripción' });

    const { url, init, cuerpo } = llamada();
    expect(url).toBe('https://api.example/tipos-documento');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(cuerpo).toStrictEqual({ nombre: 'Constancia ARCA', descripcion: 'Inscripción' });
  });

  it('envía solo lo que recibe: sin id, activo, fechas ni nombreNormalizado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tipoDocumento, 201));

    await crearTipoDocumento({ nombre: 'Constancia ARCA' });

    expect(llamada().cuerpo).toStrictEqual({ nombre: 'Constancia ARCA' });
  });

  it('devuelve el tipo creado validado con el schema compartido', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tipoDocumento, 201));

    const creado = await crearTipoDocumento({ nombre: 'Constancia ARCA' });

    expect(creado).toMatchObject({ id: ID, nombre: 'Constancia ARCA', activo: true });
    expect(creado.actualizadoEn).toEqual(new Date('2026-10-21T12:00:00.000Z'));
  });

  it('rechaza con el ApiClientError de http() sin modificarlo', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'CONFLICT', message: 'x', details: {} } }, 409),
    );

    const error = await crearTipoDocumento({ nombre: 'Factura' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 409 });
  });

  it('rechaza si la respuesta no cumple el contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...tipoDocumento, activo: 'si' }, 201));

    await expect(crearTipoDocumento({ nombre: 'Factura' })).rejects.toThrow();
  });
});

describe('actualizarTipoDocumento', () => {
  it('hace PATCH /tipos-documento/:id con solo los campos enviados', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tipoDocumento, 200));

    await actualizarTipoDocumento(ID, { nombre: 'Constancia de ARCA' });

    const { url, init, cuerpo } = llamada();
    expect(url).toBe(`https://api.example/tipos-documento/${ID}`);
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(cuerpo).toStrictEqual({ nombre: 'Constancia de ARCA' });
  });

  it('descripcion: null viaja como null (borra), distinto de no enviarla', async () => {
    // Una respuesta nueva por pedido: el cuerpo de una `Response` se puede leer una sola vez.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(tipoDocumento, 200)));

    await actualizarTipoDocumento(ID, { descripcion: null });
    await actualizarTipoDocumento(ID, { nombre: 'Factura', descripcion: undefined });

    expect(llamada(0).cuerpo).toStrictEqual({ descripcion: null });
    expect(llamada(1).cuerpo).toStrictEqual({ nombre: 'Factura' });
  });

  it('codifica el id dentro de la URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tipoDocumento, 200));

    await actualizarTipoDocumento('a/b?c', { nombre: 'Factura' });

    expect(llamada().url).toBe('https://api.example/tipos-documento/a%2Fb%3Fc');
  });

  it('devuelve el tipo actualizado validado, y rechaza uno que no cumple el contrato', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...tipoDocumento, descripcion: 'Nueva' }, 200))
      .mockResolvedValueOnce(jsonResponse({ ...tipoDocumento, creadoEn: 'ayer' }, 200));

    await expect(actualizarTipoDocumento(ID, { descripcion: 'Nueva' })).resolves.toMatchObject({
      descripcion: 'Nueva',
    });
    await expect(actualizarTipoDocumento(ID, { descripcion: 'Nueva' })).rejects.toThrow();
  });

  it('propaga el ApiClientError sin modificarlo', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'NOT_FOUND', message: 'x' } }, 404));

    await expect(actualizarTipoDocumento(ID, { nombre: 'Factura' })).rejects.toMatchObject({
      kind: 'http',
      status: 404,
    });
  });
});

describe('cambiarEstadoTipoDocumento', () => {
  it.each([true, false])(
    'hace PATCH /tipos-documento/:id/estado con { activo: %s }',
    async (activo) => {
      fetchMock.mockResolvedValue(jsonResponse({ ...tipoDocumento, activo }, 200));

      const tipo = await cambiarEstadoTipoDocumento(ID, activo);

      const { url, init, cuerpo } = llamada();
      expect(url).toBe(`https://api.example/tipos-documento/${ID}/estado`);
      expect(init?.method).toBe('PATCH');
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      expect(cuerpo).toStrictEqual({ activo });
      expect(tipo.activo).toBe(activo);
    },
  );

  it('codifica el id dentro de la URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(tipoDocumento, 200));

    await cambiarEstadoTipoDocumento('a/b', true);

    expect(llamada().url).toBe('https://api.example/tipos-documento/a%2Fb/estado');
  });

  it('rechaza si la respuesta no cumple el contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...tipoDocumento, activo: null }, 200));

    await expect(cambiarEstadoTipoDocumento(ID, false)).rejects.toThrow();
  });

  it('sin conexión rechaza con un ApiClientError de red', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(cambiarEstadoTipoDocumento(ID, false)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('interpretarFalloAltaTipoDocumento', () => {
  it('reconoce el nombre duplicado con un tipo activo', () => {
    const existente = { id: OTRO_ID, nombre: 'Constancia ARCA', activo: true };

    expect(interpretarFalloAltaTipoDocumento(duplicado(existente))).toEqual({
      tipo: 'nombre-duplicado',
      tipoDocumentoExistente: existente,
    });
  });

  it('reconoce el nombre duplicado con un tipo inactivo', () => {
    const existente = { id: OTRO_ID, nombre: 'Print', activo: false };

    expect(interpretarFalloAltaTipoDocumento(duplicado(existente))).toEqual({
      tipo: 'nombre-duplicado',
      tipoDocumentoExistente: existente,
    });
  });

  it('copia solo id, nombre y activo del tipo existente', () => {
    const fallo = interpretarFalloAltaTipoDocumento(
      duplicado({ id: OTRO_ID, nombre: 'Print', activo: true, nombreNormalizado: 'print' }),
    );

    expect(fallo).toEqual({
      tipo: 'nombre-duplicado',
      tipoDocumentoExistente: { id: OTRO_ID, nombre: 'Print', activo: true },
    });
  });

  it.each([
    ['ausente', undefined],
    ['sin id', { nombre: 'Print', activo: true }],
    ['con id vacío', { id: '', nombre: 'Print', activo: true }],
    ['sin nombre', { id: OTRO_ID, activo: true }],
    ['con activo como texto', { id: OTRO_ID, nombre: 'Print', activo: 'true' }],
    ['que no es un objeto', 'Print'],
  ])('con el tipo existente %s, sigue siendo duplicado pero sin el detalle', (_caso, existente) => {
    expect(interpretarFalloAltaTipoDocumento(duplicado(existente))).toEqual({
      tipo: 'nombre-duplicado',
      tipoDocumentoExistente: null,
    });
  });

  const motivo = { motivo: 'TIPO_DOCUMENTO_DUPLICADO' };

  it.each([
    ['otro motivo', errorHttp(409, { error: { code: 'CONFLICT', details: { motivo: 'OTRO' } } })],
    ['un 409 sin code CONFLICT', errorHttp(409, { error: { code: 'X', details: motivo } })],
    ['un 409 sin details', errorHttp(409, { error: { code: 'CONFLICT' } })],
    ['un 409 con cuerpo de texto (un proxy)', errorHttp(409, 'Conflict')],
    ['otro status', errorHttp(500, { error: { code: 'CONFLICT', details: motivo } })],
  ])('no es un duplicado: %s', (_caso, error) => {
    expect(interpretarFalloAltaTipoDocumento(error)).toEqual({ tipo: 'inesperado' });
  });

  it('reconoce los datos inválidos y extrae los detalles', () => {
    const error = errorHttp(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos',
        details: [
          { campo: 'nombre', mensaje: 'El nombre es obligatorio.' },
          { campo: 'descripcion' },
          { mensaje: 'sin campo' },
          'basura',
        ],
      },
    });

    expect(interpretarFalloAltaTipoDocumento(error)).toEqual({
      tipo: 'datos-invalidos',
      detalles: [
        { campo: 'nombre', mensaje: 'El nombre es obligatorio.' },
        { campo: 'descripcion', mensaje: null },
      ],
    });
  });

  it('datos inválidos con details que no es una lista: sin detalles', () => {
    const error = errorHttp(400, { error: { code: 'VALIDATION_ERROR', details: 'x' } });

    expect(interpretarFalloAltaTipoDocumento(error)).toEqual({
      tipo: 'datos-invalidos',
      detalles: [],
    });
  });

  it('un 400 sin code VALIDATION_ERROR es inesperado', () => {
    const error = errorHttp(400, { error: { code: 'X' } });

    expect(interpretarFalloAltaTipoDocumento(error)).toEqual({ tipo: 'inesperado' });
  });

  it('un 404 en el alta no es "no existe": es inesperado', () => {
    expect(interpretarFalloAltaTipoDocumento(noEncontrado())).toEqual({ tipo: 'inesperado' });
  });

  it.each([
    ['sin conexión', new ApiClientError({ kind: 'network', message: 'x' })],
    ['la configuración', new ApiClientError({ kind: 'configuration', message: 'x' })],
    ['un 500', errorHttp(500, { error: { code: 'INTERNAL_ERROR' } })],
    ['un 500 sin cuerpo', errorHttp(500, undefined)],
    ['una respuesta que no validó', new Error('parse')],
    ['algo que no es un error', 'x'],
  ])('%s es inesperado', (_caso, error) => {
    expect(interpretarFalloAltaTipoDocumento(error)).toEqual({ tipo: 'inesperado' });
  });
});

describe('interpretarFalloEdicionTipoDocumento', () => {
  it('reconoce el 404 del contrato como "no existe"', () => {
    expect(interpretarFalloEdicionTipoDocumento(noEncontrado())).toEqual({ tipo: 'no-existe' });
  });

  it.each([
    ['un 404 sin cuerpo (la ruta no existe en un proxy)', errorHttp(404, undefined)],
    ['un 404 con otro code', errorHttp(404, { error: { code: 'X' } })],
    ['un 404 con cuerpo de texto', errorHttp(404, 'Not Found')],
  ])('%s no es "no existe": es inesperado', (_caso, error) => {
    expect(interpretarFalloEdicionTipoDocumento(error)).toEqual({ tipo: 'inesperado' });
  });

  it('reconoce el duplicado y los datos inválidos como en el alta', () => {
    const existente = { id: OTRO_ID, nombre: 'Print', activo: false };
    const invalido = errorHttp(400, {
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'nombre', mensaje: 'x' }] },
    });

    expect(interpretarFalloEdicionTipoDocumento(duplicado(existente))).toEqual({
      tipo: 'nombre-duplicado',
      tipoDocumentoExistente: existente,
    });
    expect(interpretarFalloEdicionTipoDocumento(invalido)).toEqual({
      tipo: 'datos-invalidos',
      detalles: [{ campo: 'nombre', mensaje: 'x' }],
    });
  });

  it('sin conexión es inesperado', () => {
    const error = new ApiClientError({ kind: 'network', message: 'x' });

    expect(interpretarFalloEdicionTipoDocumento(error)).toEqual({ tipo: 'inesperado' });
  });
});

describe('interpretarFalloCambioEstadoTipoDocumento', () => {
  it('reconoce el 404 del contrato como "no existe"', () => {
    expect(interpretarFalloCambioEstadoTipoDocumento(noEncontrado())).toEqual({
      tipo: 'no-existe',
    });
  });

  it.each([
    ['un 404 sin el code del contrato', errorHttp(404, undefined)],
    ['un 400', errorHttp(400, { error: { code: 'VALIDATION_ERROR', details: [] } })],
    ['un 409', duplicado({ id: OTRO_ID, nombre: 'Print', activo: true })],
    ['un 500', errorHttp(500, undefined)],
    ['sin conexión', new ApiClientError({ kind: 'network', message: 'x' })],
    ['un error que no es de la API', new Error('x')],
  ])('%s es inesperado', (_caso, error) => {
    expect(interpretarFalloCambioEstadoTipoDocumento(error)).toEqual({ tipo: 'inesperado' });
  });
});
