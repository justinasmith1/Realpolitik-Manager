import { QueryClient } from '@tanstack/react-query';

import {
  CLAVE_CAMBIO_DE_CONTRASENA,
  CLAVE_SESION,
  confirmarSesion,
  destinoDespuesDeEntrar,
  establecerSesion,
  marcarRotacion,
  opcionesDeSesion,
  terminarSesion,
  urlDeCambioDeContrasena,
  urlDeLogin,
  volverAValido,
} from '@/modules/auth/sesion';
import { sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';

const json = (status: number, cuerpo?: unknown) =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const sinSesion = (motivo: 'SESION_REQUERIDA' | 'SESION_VENCIDA' = 'SESION_REQUERIDA') =>
  json(401, { error: { code: 'UNAUTHENTICATED', message: 'x', details: { motivo } } });

describe('volverA: solo rutas internas (sin redirecciones abiertas)', () => {
  it.each(['/rendiciones', '/rendiciones?mes=2026-10&estado=ABIERTA', '/clientes/1/matriz'])(
    'acepta %s',
    (ruta) => {
      expect(volverAValido(ruta)).toBe(ruta);
    },
  );

  it.each([
    null,
    undefined,
    '',
    'rendiciones',
    'https://malo.example/',
    '//malo.example/',
    '/\\malo.example/',
    '/\t/malo.example',
    'javascript:alert(1)',
    '/login',
    '/login?volverA=/x',
    '/login/otra',
    '/cambiar-contrasena',
    '/cambiar-contrasena?volverA=/x',
  ])('ignora %s', (valor) => {
    expect(volverAValido(valor)).toBeNull();
    expect(destinoDespuesDeEntrar(valor)).toBe('/rendiciones');
  });
});

describe('estado de sesión en la caché', () => {
  it('terminar la sesión deja "no autenticado", descarta los datos y recuerda el motivo', () => {
    const queryClient = new QueryClient();
    establecerSesion(queryClient, sesionDePrueba());
    queryClient.setQueryData(['clientes'], [{ id: 1 }]);

    terminarSesion(queryClient, 'vencida');

    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    expect(queryClient.getQueryData(['clientes'])).toBeUndefined();
    expect(urlDeLogin(queryClient, '/clientes?x=1')).toBe(
      '/login?motivo=vencida&volverA=%2Fclientes%3Fx%3D1',
    );
  });

  it('entrar de nuevo borra el motivo anterior', () => {
    const queryClient = new QueryClient();
    terminarSesion(queryClient, 'cerrada');
    establecerSesion(queryClient, sesionDePrueba());
    terminarSesion(queryClient);

    expect(urlDeLogin(queryClient, null)).toBe('/login');
  });

  it('las URLs de acceso no llevan un volverA inválido ni el de la pantalla de entrada', () => {
    const queryClient = new QueryClient();
    expect(urlDeLogin(queryClient, '//malo.example')).toBe('/login');
    expect(urlDeLogin(queryClient, '/rendiciones')).toBe('/login');
    expect(urlDeCambioDeContrasena('https://malo.example')).toBe('/cambiar-contrasena');
    expect(urlDeCambioDeContrasena('/clientes')).toBe('/cambiar-contrasena?volverA=%2Fclientes');
  });
});

describe('HU4.2: la sesión con el servidor como autoridad', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '/api');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  function conSesion() {
    const queryClient = new QueryClient();
    establecerSesion(queryClient, sesionDePrueba());
    return queryClient;
  }

  describe('la query de sesión', () => {
    it('se revalida al volver a la pestaña o recuperar la red, sin polling', () => {
      const opciones = opcionesDeSesion(new QueryClient());

      expect(opciones).toMatchObject({
        staleTime: 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: false,
      });
      expect(opciones).not.toHaveProperty('refetchInterval');
    });

    it('en la primera carga, una cookie vencida deja el aviso de vencida; sin cookie, ninguno', async () => {
      const conCookieVencida = new QueryClient();
      fetchMock.mockResolvedValueOnce(sinSesion('SESION_VENCIDA'));
      await expect(
        conCookieVencida.fetchQuery(opcionesDeSesion(conCookieVencida)),
      ).resolves.toBeNull();
      expect(urlDeLogin(conCookieVencida, '/clientes')).toBe(
        '/login?motivo=vencida&volverA=%2Fclientes',
      );

      const primeraVez = new QueryClient();
      fetchMock.mockResolvedValueOnce(sinSesion());
      await expect(primeraVez.fetchQuery(opcionesDeSesion(primeraVez))).resolves.toBeNull();
      expect(urlDeLogin(primeraVez, '/clientes')).toBe('/login?volverA=%2Fclientes');
    });

    it('si había sesión y el servidor dice que no, termina con su motivo y descarta los datos', async () => {
      const queryClient = conSesion();
      queryClient.setQueryData(['clientes'], [{ id: 1 }]);
      fetchMock.mockResolvedValueOnce(sinSesion());

      await queryClient.fetchQuery({ ...opcionesDeSesion(queryClient), staleTime: 0 });

      expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
      expect(queryClient.getQueryData(['clientes'])).toBeUndefined();
      expect(urlDeLogin(queryClient, null)).toBe('/login?motivo=terminada');
    });

    it('si la sesión es de otra cuenta, descarta los datos de la anterior', async () => {
      const queryClient = conSesion();
      queryClient.setQueryData(['clientes'], [{ id: 1 }]);
      const otra = sesionDePrueba({ id: '0000a000-0000-4000-8000-000000000002' });
      fetchMock.mockResolvedValueOnce(json(200, otra));

      await queryClient.fetchQuery({ ...opcionesDeSesion(queryClient), staleTime: 0 });

      expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(otra);
      expect(queryClient.getQueryData(['clientes'])).toBeUndefined();
    });
  });

  describe('confirmarSesion (un 401 se confirma con el servidor)', () => {
    it('si la cookie actual vale, el 401 era atrasado: la sesión sigue y no queda ningún motivo', async () => {
      const queryClient = conSesion();
      queryClient.setQueryData(['clientes'], [{ id: 1 }]);
      fetchMock.mockResolvedValue(json(200, sesionDePrueba()));

      await expect(
        confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: false }),
      ).resolves.toBe(true);

      expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
      expect(queryClient.getQueryData(['clientes'])).toEqual([{ id: 1 }]);
      expect(urlDeLogin(queryClient, '/clientes')).toBe('/login?volverA=%2Fclientes');
    });

    it('varios 401 a la vez: una sola consulta y una sola limpieza; el motivo original no se pisa y "sin guardar" se suma', async () => {
      const queryClient = conSesion();
      queryClient.setQueryData(['clientes'], [{ id: 1 }]);
      let responder: (respuesta: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (responder = resolve)));

      const confirmaciones = [
        confirmarSesion(queryClient, { motivo: 'vencida', sinGuardar: false }),
        confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: true }),
        confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: false }),
      ];
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      // El 401 del vencimiento borró la cookie: la confirmación responde "sin sesión" a secas.
      responder(sinSesion());

      await expect(Promise.all(confirmaciones)).resolves.toEqual([false, false, false]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
      expect(queryClient.getQueryData(['clientes'])).toBeUndefined();
      expect(urlDeLogin(queryClient, '/clientes?x=1')).toBe(
        '/login?motivo=vencida&sinGuardar=1&volverA=%2Fclientes%3Fx%3D1',
      );
    });

    it('si la confirmación dice que venció, prevalece el vencimiento', async () => {
      const queryClient = conSesion();
      fetchMock.mockResolvedValue(sinSesion('SESION_VENCIDA'));

      await confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: false });

      expect(urlDeLogin(queryClient, null)).toBe('/login?motivo=vencida');
    });

    it.each([
      ['503', () => Promise.resolve(json(503, { error: { code: 'SERVICE_UNAVAILABLE' } }))],
      ['red caída', () => Promise.reject(new TypeError('Failed to fetch'))],
    ] as const)(
      'si la confirmación no tiene respuesta (%s), la sesión NO se da por terminada',
      async (_, respuesta) => {
        const queryClient = conSesion();
        fetchMock.mockImplementation(respuesta);

        await expect(
          confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: false }),
        ).resolves.toBe(true);

        expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
        expect(urlDeLogin(queryClient, null)).toBe('/login');
      },
    );

    it('si ya no había sesión (otro camino la terminó), no se pisa el motivo', async () => {
      const queryClient = conSesion();
      terminarSesion(queryClient, 'cerrada');
      fetchMock.mockResolvedValue(sinSesion('SESION_VENCIDA'));

      await confirmarSesion(queryClient, { motivo: 'vencida', sinGuardar: true });

      expect(urlDeLogin(queryClient, null)).toBe('/login?motivo=cerrada');
    });

    it('espera a que termine un cambio de contraseña en curso antes de preguntar (la cookie está rotando)', async () => {
      const queryClient = conSesion();
      fetchMock.mockResolvedValue(json(200, sesionDePrueba()));
      let terminar: () => void = () => undefined;
      const cambio = queryClient.getMutationCache().build(queryClient, {
        mutationKey: CLAVE_CAMBIO_DE_CONTRASENA,
        mutationFn: () => new Promise<void>((resolve) => (terminar = resolve)),
      });
      marcarRotacion(queryClient);
      const enCurso = cambio.execute(undefined);

      const confirmacion = confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: false });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetchMock).not.toHaveBeenCalled();

      terminar();
      await enCurso;
      await expect(confirmacion).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('si mientras preguntaba empezó un cambio de contraseña, un "sin sesión" se vuelve a preguntar', async () => {
      const queryClient = conSesion();
      fetchMock
        .mockImplementationOnce(() => {
          marcarRotacion(queryClient); // la respuesta pudo salir con el token anterior
          return Promise.resolve(sinSesion());
        })
        .mockResolvedValueOnce(json(200, sesionDePrueba()));

      await expect(
        confirmarSesion(queryClient, { motivo: 'terminada', sinGuardar: false }),
      ).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
