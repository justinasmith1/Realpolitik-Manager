import { ApiClientError, http } from '@/lib/http';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://example.com/api/v1');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function lastFetchCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('fetch no fue llamado');
  }
  const [input, init] = call;
  if (typeof input !== 'string') {
    throw new Error('se esperaba que fetch recibiera la URL como string');
  }
  return { url: input, init: init ?? {} };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba que la promesa fuera rechazada');
}

function jsonResponse(body: unknown, init: ResponseInit, contentType = 'application/json') {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': contentType },
  });
}

describe('http', () => {
  describe('construcción de la URL', () => {
    it('une el base, con su prefijo, y el path', async () => {
      await http('/clientes');

      expect(lastFetchCall().url).toBe('https://example.com/api/v1/clientes');
    });

    it('no duplica barras si el base configurado termina en /', async () => {
      vi.stubEnv('VITE_API_URL', 'https://example.com/api/v1///');

      await http('/clientes');

      expect(lastFetchCall().url).toBe('https://example.com/api/v1/clientes');
    });

    it('conserva la query string del path', async () => {
      await http('/clientes?activo=true&q=a%20b');

      expect(lastFetchCall().url).toBe('https://example.com/api/v1/clientes?activo=true&q=a%20b');
    });

    it('con path "/" apunta a la raíz del prefijo', async () => {
      await http('/');

      expect(lastFetchCall().url).toBe('https://example.com/api/v1/');
    });

    it('permite ".." dentro de la query (solo se rechazan en el path)', async () => {
      await http('/clientes?ruta=../x');

      expect(lastFetchCall().url).toBe('https://example.com/api/v1/clientes?ruta=../x');
    });
  });

  describe('headers e init', () => {
    it('agrega Accept: application/json por defecto', async () => {
      await http('/clientes');

      expect(new Headers(lastFetchCall().init.headers).get('Accept')).toBe('application/json');
    });

    it.each([
      ['un objeto', { accept: 'text/csv', 'X-Custom': '1' }],
      ['una instancia de Headers', new Headers({ Accept: 'text/csv', 'X-Custom': '1' })],
      [
        'una lista de pares',
        [
          ['Accept', 'text/csv'],
          ['X-Custom', '1'],
        ] as [string, string][],
      ],
    ])('respeta los headers del llamador (%s)', async (_forma, headers) => {
      await http('/clientes', { headers });

      const sent = new Headers(lastFetchCall().init.headers);
      expect(sent.get('Accept')).toBe('text/csv');
      expect(sent.get('X-Custom')).toBe('1');
    });

    it('no agrega Content-Type, Authorization ni credenciales por su cuenta', async () => {
      await http('/clientes');

      const { init } = lastFetchCall();
      const sent = new Headers(init.headers);
      expect(sent.has('Content-Type')).toBe(false);
      expect(sent.has('Authorization')).toBe(false);
      expect(init.credentials).toBeUndefined();
    });

    it('deja pasar method y body sin modificarlos', async () => {
      await http('/clientes', {
        method: 'POST',
        body: '{"razonSocial":"X"}',
        headers: { 'Content-Type': 'application/json' },
      });

      const { init } = lastFetchCall();
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"razonSocial":"X"}');
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    });
  });

  describe('respuestas exitosas', () => {
    it('devuelve la Response de un 2xx sin consumir ni parsear el cuerpo', async () => {
      const response = jsonResponse({ ok: true }, { status: 200 });
      fetchMock.mockResolvedValue(response);

      const result = await http('/clientes');

      expect(result).toBe(response);
      expect(response.bodyUsed).toBe(false);
    });

    it('acepta un 204 sin cuerpo', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      const result = await http('/clientes/1', { method: 'DELETE' });

      expect(result.status).toBe(204);
    });
  });

  describe('errores HTTP', () => {
    it('normaliza un error con cuerpo JSON conservando status, statusText y payload', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { message: 'Datos inválidos', errores: ['cuit'] },
          { status: 422, statusText: 'Unprocessable Entity' },
        ),
      );

      const error = await rejection(http('/clientes'));

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toMatchObject({
        kind: 'http',
        status: 422,
        statusText: 'Unprocessable Entity',
        message: 'HTTP 422 Unprocessable Entity',
        payload: { message: 'Datos inválidos', errores: ['cuit'] },
      });
    });

    it('también interpreta application/problem+json', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ title: 'Conflicto' }, { status: 409 }, 'application/problem+json'),
      );

      const error = await rejection(http('/clientes'));

      expect(error).toMatchObject({ kind: 'http', status: 409, payload: { title: 'Conflicto' } });
    });

    it('conserva el texto cuando el cuerpo no es JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response('Bad Gateway', {
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const error = await rejection(http('/clientes'));

      expect(error).toMatchObject({ kind: 'http', status: 502, payload: 'Bad Gateway' });
    });

    it('deja el payload sin definir cuando no hay cuerpo', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

      const error = await rejection(http('/clientes'));

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toMatchObject({ kind: 'http', status: 500, payload: undefined });
    });

    it('conserva el texto original si se anunció JSON pero el cuerpo no lo es', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html>error</html>', {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const error = await rejection(http('/clientes'));

      expect(error).toMatchObject({ kind: 'http', status: 500, payload: '<html>error</html>' });
    });
  });

  describe('errores de red', () => {
    it('normaliza el rechazo de fetch como `network` y conserva la causa', async () => {
      const cause = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValue(cause);

      const error = await rejection(http('/clientes'));

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toMatchObject({ kind: 'network', status: undefined, cause });
    });

    it('distingue un fallo de red de una respuesta HTTP 500', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));

      const redError = await rejection(http('/clientes'));
      const httpError = await rejection(http('/clientes'));

      expect(redError).toMatchObject({ kind: 'network' });
      expect(httpError).toMatchObject({ kind: 'http', status: 500 });
    });
  });

  describe('cancelación con AbortSignal', () => {
    // Un fetch que, como el real, rechaza con `signal.reason` al cancelarse.
    function fetchThatHonorsSignal() {
      fetchMock.mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener('abort', () => {
              // El fetch real rechaza con `signal.reason`, que puede no ser un Error: el test
              // necesita reproducirlo tal cual, sin envolverlo.
              // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
              reject(signal.reason as unknown);
            });
          }),
      );
    }

    it('propaga el AbortError sin convertirlo en error de red', async () => {
      fetchThatHonorsSignal();
      const controller = new AbortController();

      const pending = rejection(http('/clientes', { signal: controller.signal }));
      controller.abort();
      const error = await pending;

      expect(error).not.toBeInstanceOf(ApiClientError);
      expect(error).toHaveProperty('name', 'AbortError');
    });

    it('propaga tal cual la razón personalizada con la que se canceló', async () => {
      fetchThatHonorsSignal();
      const controller = new AbortController();
      const reason = new Error('cancelado por la pantalla');

      const pending = rejection(http('/clientes', { signal: controller.signal }));
      controller.abort(reason);

      expect(await pending).toBe(reason);
    });

    it('no envuelve un AbortError aunque llegue sin signal asociada', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      fetchMock.mockRejectedValue(abortError);

      expect(await rejection(http('/clientes'))).toBe(abortError);
    });
  });

  describe('configuración', () => {
    it('falla como `configuration` si VITE_API_URL no está definida, sin llamar a fetch', async () => {
      vi.stubEnv('VITE_API_URL', undefined);

      const error = await rejection(http('/clientes'));

      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toMatchObject({
        kind: 'configuration',
        status: undefined,
        message: expect.stringContaining('VITE_API_URL is not set') as unknown,
      });
      expect((error as ApiClientError).cause).toBeInstanceOf(Error);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falla como `configuration` si VITE_API_URL es inválida', async () => {
      vi.stubEnv('VITE_API_URL', 'ftp://example.com');

      const error = await rejection(http('/clientes'));

      expect(error).toMatchObject({ kind: 'configuration' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('path inválido (error de programación)', () => {
    it.each([
      ['vacío', ''],
      ['sin barra inicial', 'clientes'],
      ['protocol-relative', '//otro-host.example/x'],
      ['URL absoluta', 'https://otro-host.example/x'],
      ['con ".." para salir del prefijo', '/../admin'],
      ['con ".." intermedio', '/clientes/../../admin'],
      ['con ".." codificado', '/%2e%2e/admin'],
      ['con "." y ".." mezclados', '/./%2E./admin'],
    ])('rechaza un path %s con TypeError, sin llamar a fetch', async (_caso, path) => {
      const error = await rejection(http(path));

      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(ApiClientError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
