// Flujos de autenticación de punta a punta en el frontend (HU4.1): las rutas reales de la app,
// sus providers y su QueryClient, igual que main.tsx. Lo único simulado es `fetch`, con un
// servidor de mentira que responde el contrato de `/auth/*` (ADR-0006).
//
//   A. Sin sesión → /login, y de vuelta a la página pedida
//   B. Inicio de sesión correcto
//   C. Credenciales incorrectas
//   D. Límites y servicio no disponible en el login (429, 503, red)
//   E. Contraseña temporal → cambio obligatorio → volver a entrar
//   F. Cierre de sesión (204 y 503)
//   G. Recuperación de la sesión y pérdida durante la navegación (401, 403)
//   H. CONSULTA bloqueado y servicio no disponible al entrar

import type { SesionActual, UsuarioDeSesion } from '@realpolitik/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, queryClient } from '@/app/providers';
import { routes } from '@/app/router';
import { CLAVE_SESION } from '@/modules/auth/sesion';
import { sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';

type Respuesta = () => Response | Promise<Response>;

const json = (status: number, cuerpo?: unknown, headers: Record<string, string> = {}) =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const error = (status: number, code: string, details?: unknown, headers = {}) =>
  json(status, { error: { code, message: 'mensaje interno que no se muestra', details } }, headers);

const SIN_SESION = () => error(401, 'UNAUTHENTICATED', { motivo: 'SESION_REQUERIDA' });
const NO_DISPONIBLE = () => error(503, 'SERVICE_UNAVAILABLE', undefined, { 'Retry-After': '5' });

/** Servidor de mentira: la sesión vive acá (como la cookie HttpOnly), nunca en el navegador. */
const servidor = {
  sesion: null as SesionActual | null,
  /** Respuestas forzadas por `MÉTODO /ruta`; si no hay, la del contrato. */
  forzadas: new Map<string, Respuesta>(),
  /** Qué responden las rutas de negocio. */
  negocio: (() => json(200, [])) as Respuesta,
};

const fetchMock = vi.fn<typeof fetch>();

const urlDe = (entrada: RequestInfo | URL): string =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function responder(url: string, init: RequestInit = {}): Response | Promise<Response> {
  const clave = `${init.method ?? 'GET'} ${url}`;
  const forzada = servidor.forzadas.get(clave);
  if (forzada) {
    return forzada();
  }
  switch (clave) {
    case 'GET /api/auth/sesion':
      return servidor.sesion ? json(200, servidor.sesion) : SIN_SESION();
    case 'POST /api/auth/logout':
      servidor.sesion = null;
      return new Response(null, { status: 204 });
    default:
      return servidor.sesion ? servidor.negocio() : SIN_SESION();
  }
}

/** Los pedidos hechos, como `MÉTODO /ruta`. */
const pedidos = () =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${urlDe(url)}`);
const pedidosDeNegocio = () => pedidos().filter((p) => !p.includes(' /api/auth/'));
const cuerpoDe = (clave: string) => {
  const llamada = fetchMock.mock.calls.find(
    ([url, init]) => `${init?.method ?? 'GET'} ${urlDe(url)}` === clave,
  );
  return JSON.parse(llamada?.[1]?.body as string) as unknown;
};

function abrir(ruta: string) {
  const router = createMemoryRouter(routes, { initialEntries: [ruta] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  const donde = () => `${router.state.location.pathname}${router.state.location.search}`;
  return { router, donde };
}

/** El login responde 200 con este usuario y el servidor queda con esa sesión. */
function loginResponde(usuario: Partial<UsuarioDeSesion> = {}) {
  servidor.forzadas.set('POST /api/auth/login', () => {
    servidor.sesion = sesionDePrueba(usuario);
    return json(200, servidor.sesion);
  });
}

async function completarLogin(email = 'ana@realpolitik.test', password = 'mi contraseña larga') {
  const usuario = userEvent.setup();
  await usuario.type(await screen.findByLabelText('Email'), email);
  await usuario.type(screen.getByLabelText('Contraseña'), password);
  await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
  return usuario;
}

const enElShell = () => screen.findByRole('navigation', { name: 'Principal' });
const sinShell = () =>
  expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();

beforeEach(() => {
  queryClient.clear();
  servidor.sesion = null;
  servidor.forzadas.clear();
  servidor.negocio = () => json(200, []);
  vi.stubEnv('VITE_API_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((url, init) => Promise.resolve(responder(urlDe(url), init)));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('A. sin sesión', () => {
  it('cualquier ruta protegida lleva a /login con la ruta y la query originales', async () => {
    const { router, donde } = abrir('/clientes?estado=inactivos&q=muni');

    expect(await screen.findByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
    expect(donde()).toBe('/login?volverA=%2Fclientes%3Festado%3Dinactivos%26q%3Dmuni');
    // Reemplaza el historial: Atrás no vuelve a la ruta protegida.
    expect(router.state.historyAction).toBe('REPLACE');
    sinShell();
    // Nada del sistema se pidió ni se mostró: solo se preguntó por la sesión.
    expect(pedidosDeNegocio()).toEqual([]);
    expect(pedidos()).toEqual(['GET /api/auth/sesion']);
  });

  it('mientras se resuelve la sesión no se muestra el shell ni el login', async () => {
    let soltar: (respuesta: Response) => void = () => undefined;
    servidor.forzadas.set(
      'GET /api/auth/sesion',
      () => new Promise<Response>((resolve) => (soltar = resolve)),
    );
    abrir('/clientes');

    expect(await screen.findByRole('status')).toHaveTextContent('Cargando…');
    sinShell();
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).not.toBeInTheDocument();

    soltar(SIN_SESION());
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  });

  it('una ruta desconocida tampoco se revela sin sesión', async () => {
    const { donde } = abrir('/no-existe');

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(donde()).toBe('/login?volverA=%2Fno-existe');
    expect(screen.queryByText('Página no encontrada')).not.toBeInTheDocument();
  });
});

describe('B. inicio de sesión correcto', () => {
  it('entra, vuelve a la página pedida con su query y muestra quién es', async () => {
    loginResponde();
    const { donde } = abrir('/documentos/tipos?desactivados=1');
    await completarLogin('  Ana@Realpolitik.test ', 'mi contraseña larga');

    const nav = await enElShell();
    expect(donde()).toBe('/documentos/tipos?desactivados=1');
    expect(nav).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Cuenta de Ana Administrativa (Administrativo)' }),
    ).toBeVisible();
    // El email viaja normalizado y la contraseña tal cual, solo en el cuerpo.
    expect(cuerpoDe('POST /api/auth/login')).toEqual({
      email: 'ana@realpolitik.test',
      password: 'mi contraseña larga',
    });
    // El login ya trajo la sesión: no se vuelve a pedir.
    expect(pedidos().filter((p) => p === 'GET /api/auth/sesion')).toHaveLength(1);
  });

  it('sin volverA va a Rendiciones; un volverA externo se ignora', async () => {
    loginResponde();
    const { donde } = abrir('/login?volverA=https%3A%2F%2Fmalo.example%2F');
    await completarLogin();

    await enElShell();
    expect(donde()).toBe('/rendiciones');
  });

  it('no guarda nada de la sesión en el almacenamiento del navegador', async () => {
    loginResponde();
    abrir('/login');
    await completarLogin();
    await enElShell();

    const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(guardado).not.toMatch(/realpolitik\.test|Ana Administrativa|mi contraseña larga/);
    expect(document.cookie).toBe('');
  });

  it('con sesión, /login no se muestra: lleva al sistema', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/login?volverA=%2Fclientes');

    await enElShell();
    expect(donde()).toBe('/clientes');
  });

  it('valida antes de enviar: email con formato y contraseña obligatoria', async () => {
    abrir('/login');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Email'), 'no-es-un-email');
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));

    const email = screen.getByLabelText('Email');
    expect(email).toBeInvalid();
    expect(email).toHaveAccessibleDescription('Ingresá un email válido.');
    expect(screen.getByLabelText('Contraseña')).toHaveAccessibleDescription(
      'Ingresá la contraseña.',
    );
    expect(email).toHaveFocus();
    expect(pedidos()).not.toContain('POST /api/auth/login');
  });

  it('la contraseña se puede mostrar y ocultar con un botón accesible', async () => {
    abrir('/login');
    const usuario = userEvent.setup();
    const campo = await screen.findByLabelText('Contraseña');
    expect(campo).toHaveAttribute('type', 'password');
    expect(campo).toHaveAttribute('autocomplete', 'current-password');

    const boton = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    await usuario.click(boton);

    expect(campo).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('C. credenciales incorrectas', () => {
  it('muestra un mensaje genérico, conserva el email y vacía la contraseña', async () => {
    servidor.forzadas.set('POST /api/auth/login', () =>
      error(401, 'UNAUTHENTICATED', { motivo: 'CREDENCIALES_INVALIDAS' }),
    );
    const { donde } = abrir('/login?volverA=%2Fclientes');
    await completarLogin('ana@realpolitik.test', 'equivocada');

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Email o contraseña incorrectos.');
    expect(aviso).not.toHaveTextContent('mensaje interno');
    expect(aviso).toHaveFocus();
    expect(screen.getByLabelText('Email')).toHaveValue('ana@realpolitik.test');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    // No insinúa qué dato falló, no navega y no hay sesión.
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Contraseña')).not.toHaveAttribute('aria-invalid');
    expect(donde()).toBe('/login?volverA=%2Fclientes');
    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    sinShell();
  });
});

describe('D. límites y servicio no disponible en el login', () => {
  it.each([
    [
      '429 con Retry-After',
      () =>
        error(
          429,
          'TOO_MANY_REQUESTS',
          { motivo: 'DEMASIADOS_INTENTOS' },
          { 'Retry-After': '120' },
        ),
      'Demasiados intentos. Probá de nuevo en 2 minutos.',
      'status',
    ],
    [
      '429 por otro intento en curso',
      () => error(429, 'TOO_MANY_REQUESTS', { motivo: 'INTENTO_EN_CURSO' }, { 'Retry-After': '1' }),
      'Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo.',
      'status',
    ],
    [
      '503',
      NO_DISPONIBLE,
      'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.',
      'alert',
    ],
    [
      'red caída',
      () => Promise.reject(new TypeError('Failed to fetch')),
      'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.',
      'alert',
    ],
    [
      '403 de origen',
      () => error(403, 'FORBIDDEN', { motivo: 'ORIGEN_NO_PERMITIDO' }),
      'No pudimos validar el pedido. Recargá la página y probá de nuevo.',
      'alert',
    ],
  ] as const)(
    '%s: avisa sin dar por incorrectas las credenciales',
    async (_, respuesta, texto, rol) => {
      servidor.forzadas.set('POST /api/auth/login', respuesta);
      const { donde } = abrir('/login');
      await completarLogin();

      expect(await screen.findByRole(rol)).toHaveTextContent(texto);
      expect(screen.queryByText('Email o contraseña incorrectos.')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toHaveValue('ana@realpolitik.test');
      // Se puede reintentar: el botón no queda bloqueado.
      expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
      expect(donde()).toBe('/login');
    },
  );
});

describe('E. contraseña temporal y cambio obligatorio', () => {
  const TEMPORAL = 'Temporal-7Kq2-Xp9';
  const NUEVA = 'una frase larga y propia';

  async function llegarAlCambio(ruta = '/clientes?estado=inactivos') {
    loginResponde({ debeCambiarPassword: true });
    const vista = abrir(ruta);
    const usuario = await completarLogin('ana@realpolitik.test', TEMPORAL);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Configurá tu contraseña' }),
    ).toBeVisible();
    return { ...vista, usuario };
  }

  async function completarCambio(
    usuario: ReturnType<typeof userEvent.setup>,
    {
      actual = TEMPORAL,
      nueva = NUEVA,
      confirmacion = nueva,
    }: { actual?: string; nueva?: string; confirmacion?: string } = {},
  ) {
    if (actual) await usuario.type(screen.getByLabelText('Contraseña temporal'), actual);
    if (nueva) await usuario.type(screen.getByLabelText('Nueva contraseña'), nueva);
    if (confirmacion) {
      await usuario.type(screen.getByLabelText('Confirmar nueva contraseña'), confirmacion);
    }
    await usuario.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
  }

  it('después del login solo se puede cambiar la contraseña: sin shell ni datos', async () => {
    const { donde } = await llegarAlCambio();

    expect(donde()).toBe('/cambiar-contrasena?volverA=%2Fclientes%3Festado%3Dinactivos');
    expect(screen.getByText(/Ana Administrativa · administrativo@realpolitik\.test/)).toBeVisible();
    sinShell();
    expect(pedidosDeNegocio()).toEqual([]);
  });

  it('una ruta protegida con contraseña temporal también lleva al cambio', async () => {
    servidor.sesion = sesionDePrueba({ debeCambiarPassword: true });
    const { donde } = abrir('/rendiciones?mes=2026-10');

    expect(await screen.findByRole('heading', { name: 'Configurá tu contraseña' })).toBeVisible();
    expect(donde()).toBe('/cambiar-contrasena?volverA=%2Frendiciones%3Fmes%3D2026-10');
    expect(pedidosDeNegocio()).toEqual([]);
  });

  it('valida la política compartida antes de enviar', async () => {
    const { usuario } = await llegarAlCambio();
    await completarCambio(usuario, { nueva: 'corta', confirmacion: 'otra' });

    expect(screen.getByLabelText('Nueva contraseña')).toHaveAccessibleDescription(
      /La contraseña tiene que tener al menos 8 caracteres\./,
    );
    expect(screen.getByLabelText('Confirmar nueva contraseña')).toHaveAccessibleDescription(
      'Las contraseñas no coinciden.',
    );
    expect(screen.getByLabelText('Nueva contraseña')).toHaveFocus();
    expect(pedidos()).not.toContain('PUT /api/auth/password');
  });

  it('la nueva no puede ser la temporal, y los requisitos se van marcando', async () => {
    const { usuario } = await llegarAlCambio();
    const requisitos = within(screen.getByRole('list', { name: 'Requisitos de la contraseña' }));
    expect(requisitos.getByText('Al menos 8 caracteres').closest('li')).toHaveTextContent(
      '(pendiente)',
    );

    await completarCambio(usuario, { nueva: TEMPORAL });

    expect(requisitos.getByText('Al menos 8 caracteres').closest('li')).toHaveTextContent(
      '(cumplido)',
    );
    expect(screen.getByLabelText('Nueva contraseña')).toHaveAccessibleDescription(
      /La contraseña nueva tiene que ser distinta de la actual\./,
    );
    expect(pedidos()).not.toContain('PUT /api/auth/password');
  });

  it('con el 204 termina la sesión y vuelve a /login para entrar con la nueva', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () => {
      servidor.sesion = null; // el servidor revocó todas las sesiones y borró la cookie
      return new Response(null, { status: 204 });
    });
    const { usuario, donde } = await llegarAlCambio();
    await completarCambio(usuario);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Elegiste tu contraseña. Ingresá con la nueva.',
    );
    expect(donde()).toBe('/login?motivo=contrasena&volverA=%2Fclientes%3Festado%3Dinactivos');
    expect(cuerpoDe('PUT /api/auth/password')).toEqual({ actual: TEMPORAL, nueva: NUEVA });
    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    // El formulario de login arranca vacío: no arrastra ninguna contraseña.
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
  });

  it('temporal incorrecta (400 en "actual"): error en su campo, sin cerrar la sesión', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(400, 'VALIDATION_ERROR', [
        { campo: 'actual', mensaje: 'La contraseña actual no es correcta.' },
      ]),
    );
    const { usuario, donde } = await llegarAlCambio();
    await completarCambio(usuario);

    const temporal = await screen.findByLabelText('Contraseña temporal');
    await waitFor(() =>
      expect(temporal).toHaveAccessibleDescription('La contraseña actual no es correcta.'),
    );
    expect(temporal).toHaveValue('');
    expect(temporal).toHaveFocus();
    expect(screen.getByLabelText('Nueva contraseña')).toHaveValue(NUEVA);
    expect(donde()).toMatch(/^\/cambiar-contrasena/);
  });

  it('contraseña previsible (400 en "nueva"): el mensaje de la política en su campo', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(400, 'VALIDATION_ERROR', [{ campo: 'nueva', mensaje: 'Invalid input' }]),
    );
    const { usuario } = await llegarAlCambio();
    await completarCambio(usuario);

    await waitFor(() =>
      expect(screen.getByLabelText('Nueva contraseña')).toHaveAccessibleDescription(
        /Esa contraseña es muy común o fácil de adivinar\. Elegí otra\./,
      ),
    );
  });

  it.each([
    ['503', NO_DISPONIBLE],
    ['red caída', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('%s: no dice que se guardó y conserva lo escrito', async (_, respuesta) => {
    servidor.forzadas.set('PUT /api/auth/password', respuesta);
    const { usuario, donde } = await llegarAlCambio();
    await completarCambio(usuario);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos guardar la contraseña. Lo que escribiste sigue acá: probá de nuevo.',
    );
    expect(screen.getByLabelText('Contraseña temporal')).toHaveValue(TEMPORAL);
    expect(screen.getByLabelText('Nueva contraseña')).toHaveValue(NUEVA);
    expect(donde()).toMatch(/^\/cambiar-contrasena/);
    expect(queryClient.getQueryData(CLAVE_SESION)).not.toBeNull();
  });

  it('429: avisa la espera de Retry-After', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(429, 'TOO_MANY_REQUESTS', { motivo: 'DEMASIADOS_INTENTOS' }, { 'Retry-After': '30' }),
    );
    const { usuario } = await llegarAlCambio();
    await completarCambio(usuario);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Demasiados intentos. Probá de nuevo en 30 segundos.',
    );
  });

  it('si la sesión venció en el medio (401), va a /login con el aviso', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' }),
    );
    const { usuario, donde } = await llegarAlCambio();
    servidor.sesion = null;
    await completarCambio(usuario);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Iniciá sesión de nuevo.',
    );
    expect(donde()).toMatch(/^\/login\?motivo=vencida/);
  });

  it('"Salir sin cambiarla" cierra la sesión en el servidor', async () => {
    const { usuario, donde } = await llegarAlCambio();
    await usuario.click(screen.getByRole('button', { name: 'Salir sin cambiarla' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(pedidos()).toContain('POST /api/auth/logout');
    expect(donde()).toMatch(/^\/login\?motivo=cerrada/);
  });

  it('sin contraseña temporal, /cambiar-contrasena no se muestra', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/cambiar-contrasena?volverA=%2Fclientes');

    await enElShell();
    expect(donde()).toBe('/clientes');
  });
});

describe('F. cierre de sesión', () => {
  async function abrirMenuDeCuenta() {
    const usuario = userEvent.setup();
    await usuario.click(
      await screen.findByRole('button', { name: /^Cuenta de Ana Administrativa/ }),
    );
    return usuario;
  }

  it('con el 204: sin datos en memoria y a /login', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/clientes');
    const usuario = await abrirMenuDeCuenta();
    queryClient.setQueryData(['dato-de-negocio'], 'secreto');
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Cerraste la sesión.');
    expect(pedidos()).toContain('POST /api/auth/logout');
    expect(queryClient.getQueryData(['dato-de-negocio'])).toBeUndefined();
    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
    // Volver a entrar lleva a la pantalla de entrada, no a donde estaba la otra sesión... salvo
    // que el servidor diga otra cosa: el destino sale solo de `volverA`.
    expect(donde()).toBe('/login?motivo=cerrada&volverA=%2Fclientes');
    sinShell();
  });

  it.each([
    ['503', NO_DISPONIBLE],
    ['red caída', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)(
    'con %s: NO dice que se cerró; la sesión sigue y se puede reintentar',
    async (_, r) => {
      servidor.sesion = sesionDePrueba();
      servidor.forzadas.set('POST /api/auth/logout', r);
      const { donde } = abrir('/clientes');
      const usuario = await abrirMenuDeCuenta();
      await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

      expect(
        await screen.findByText(
          'No pudimos cerrar la sesión: seguís con la sesión abierta. Probá de nuevo.',
        ),
      ).toBeVisible();
      expect(screen.queryByText('Cerraste la sesión.')).not.toBeInTheDocument();
      expect(donde()).toBe('/clientes');
      expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
      expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible();

      // Reintento, ahora con el servidor respondiendo.
      servidor.forzadas.delete('POST /api/auth/logout');
      await usuario.click(screen.getByRole('button', { name: /^Cuenta de Ana Administrativa/ }));
      await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));
      expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    },
  );

  it('si la sesión ya no existía (401), el cierre vale igual', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.forzadas.set('POST /api/auth/logout', SIN_SESION);
    abrir('/clientes');
    const usuario = await abrirMenuDeCuenta();
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Cerraste la sesión.');
  });
});

describe('G. recuperación y pérdida de la sesión', () => {
  it('al recargar, la sesión se recupera del servidor (no del navegador)', async () => {
    servidor.sesion = sesionDePrueba({ nombre: 'Rita Recargada', rol: 'ADMINISTRADOR' });
    const { donde } = abrir('/documentos/tipos?desactivados=1');

    await enElShell();
    expect(
      screen.getByRole('button', { name: 'Cuenta de Rita Recargada (Administrador)' }),
    ).toBeVisible();
    expect(donde()).toBe('/documentos/tipos?desactivados=1');
    expect(pedidos()[0]).toBe('GET /api/auth/sesion');
  });

  it('un 401 de cualquier pedido termina la sesión: una sola redirección, con aviso y volverA', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.negocio = () => error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' });
    const { donde } = abrir('/documentos/tipos?desactivados=1');

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Iniciá sesión de nuevo.',
    );
    expect(donde()).toBe('/login?motivo=vencida&volverA=%2Fdocumentos%2Ftipos%3Fdesactivados%3D1');
    sinShell();
    // Nada de la sesión anterior queda en memoria.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] !== 'sesion' && q.state.data !== undefined),
    ).toEqual([]);
  });

  it('un 401 por sesión revocada usa el aviso genérico', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.negocio = SIN_SESION;
    const { donde } = abrir('/clientes');

    expect(await screen.findByText('Tu sesión terminó. Iniciá sesión de nuevo.')).toBeVisible();
    expect(donde()).toBe('/login?motivo=terminada&volverA=%2Fclientes');
  });

  it('403 CAMBIO_DE_PASSWORD_REQUERIDO: revalida y lleva al cambio obligatorio', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.negocio = () => {
      // Le restablecieron la contraseña con la app abierta.
      servidor.sesion = sesionDePrueba({ debeCambiarPassword: true });
      return error(403, 'FORBIDDEN', { motivo: 'CAMBIO_DE_PASSWORD_REQUERIDO' });
    };
    const { donde } = abrir('/clientes');

    expect(await screen.findByRole('heading', { name: 'Configurá tu contraseña' })).toBeVisible();
    expect(donde()).toBe('/cambiar-contrasena?volverA=%2Fclientes');
    sinShell();
  });

  it('403 PERMISO_INSUFICIENTE y 503 no cierran la sesión ni mandan a /login', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.negocio = () => error(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' });
    const { donde } = abrir('/clientes');
    await enElShell();
    await waitFor(() => expect(pedidosDeNegocio().length).toBeGreaterThan(0));

    servidor.negocio = NO_DISPONIBLE;
    await queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' });

    expect(donde()).toBe('/clientes');
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });
});

describe('H. CONSULTA bloqueado y servicio no disponible al entrar', () => {
  it('CONSULTA inicia sesión pero no ve el sistema: pantalla de rol no habilitado', async () => {
    loginResponde({ rol: 'CONSULTA', nombre: 'Carla Consulta' });
    const { donde } = abrir('/clientes');
    await completarLogin();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tu cuenta todavía no tiene acceso al sistema.',
      }),
    ).toBeVisible();
    expect(screen.getByText('Carla Consulta')).toBeVisible();
    sinShell();
    expect(screen.queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument();
    // Ni una pantalla de negocio se montó: no hubo pedidos de negocio.
    expect(pedidosDeNegocio()).toEqual([]);
    expect(donde()).toBe('/clientes');
  });

  it.each(['/rendiciones', '/clientes/1/matriz', '/documentos/archivos', '/no-existe'])(
    'CONSULTA tampoco entra por URL directa a %s, y puede cerrar sesión',
    async (ruta) => {
      servidor.sesion = sesionDePrueba({ rol: 'CONSULTA' });
      abrir(ruta);

      expect(
        await screen.findByRole('heading', {
          name: 'Tu cuenta todavía no tiene acceso al sistema.',
        }),
      ).toBeVisible();
      sinShell();
      expect(pedidosDeNegocio()).toEqual([]);

      await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
      expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
      expect(pedidos()).toContain('POST /api/auth/logout');
    },
  );

  it('403 ROL_NO_HABILITADO de la API: revalida y bloquea, sin cerrar la sesión', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.negocio = () => {
      servidor.sesion = sesionDePrueba({ rol: 'CONSULTA' }); // le cambiaron el rol
      return error(403, 'FORBIDDEN', { motivo: 'ROL_NO_HABILITADO' });
    };
    abrir('/clientes');

    expect(
      await screen.findByRole('heading', { name: 'Tu cuenta todavía no tiene acceso al sistema.' }),
    ).toBeVisible();
    expect(pedidos()).not.toContain('POST /api/auth/logout');
  });

  it.each([
    ['503', NO_DISPONIBLE, 'HTTP_503'],
    ['red caída', () => Promise.reject(new TypeError('Failed to fetch')), 'NETWORK_ERROR'],
    ['502 del proxy sin cuerpo', () => new Response('<html>', { status: 502 }), 'HTTP_502'],
  ] as const)(
    'al entrar con %s: "Servicio no disponible", sin ir a /login; Reintentar entra',
    async (_, respuesta, diagnostico) => {
      servidor.sesion = sesionDePrueba();
      servidor.forzadas.set('GET /api/auth/sesion', respuesta);
      const { donde } = abrir('/documentos/tipos?desactivados=1');

      const aviso = await screen.findByRole('alert', {}, { timeout: 4000 });
      expect(aviso).toHaveTextContent('No pudimos conectarnos con el sistema');
      expect(aviso).toHaveTextContent('Tu sesión no se cerró.');
      expect(aviso).toHaveTextContent(diagnostico);
      expect(aviso).not.toHaveTextContent('mensaje interno');
      expect(donde()).toBe('/documentos/tipos?desactivados=1');
      sinShell();
      expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
      expect(pedidosDeNegocio()).toEqual([]);

      servidor.forzadas.delete('GET /api/auth/sesion');
      await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

      await enElShell();
      expect(donde()).toBe('/documentos/tipos?desactivados=1');
    },
  );
});
