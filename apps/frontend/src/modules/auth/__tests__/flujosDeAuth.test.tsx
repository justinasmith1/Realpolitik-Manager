// Flujos de autenticación de punta a punta en el frontend (HU4.1 y HU4.2): las rutas reales de la
// app, sus providers y su QueryClient, igual que main.tsx. Lo único simulado es `fetch`, con un
// servidor de mentira que responde el contrato de `/auth/*` (ADR-0006).
//
//   A. Sin sesión → /login, y de vuelta a la página pedida
//   B. Inicio de sesión correcto
//   C. Credenciales incorrectas
//   D. Límites y servicio no disponible en el login (429, 503, red)
//   E. Contraseña temporal → cambio obligatorio → volver a entrar
//   F. Cierre de sesión (204 y 503)
//   G. Recuperación de la sesión y pérdida durante la navegación (401, 403)
//   H. CONSULTA en el sistema (HU4.3) y servicio no disponible al entrar
//   I. Menú de cuenta y cambio voluntario de contraseña, con la sesión rotada (HU4.2)
//   J. Expiración, revocación, 401 atrasados y varias pestañas (HU4.2)

import {
  MENSAJE_CONTRASENA_CORTA,
  MENSAJE_CONTRASENA_PREVISIBLE,
  MENSAJE_CONTRASENA_REPETIDA,
  type SesionActual,
  type UsuarioDeSesion,
} from '@realpolitik/shared';
import { focusManager } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, queryClient } from '@/app/providers';
import { routes } from '@/app/router';
import { http } from '@/lib/http';
import { CLAVE_SESION, REVALIDACION_DE_SESION_MS } from '@/modules/auth/sesion';
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

/**
 * El shell, con la página ya pidiendo sus datos. Las páginas se cargan en diferido: si el test
 * terminara apenas aparece el shell, la página podría montarse después y pedir con `fetch` ya
 * restaurado (el bloqueo de `setup.ts` lo marcaría como un pedido no simulado). `previos`: los
 * pedidos de negocio que ya había antes de llegar a esta página.
 */
async function enElShell(previos = 0) {
  const nav = await screen.findByRole('navigation', { name: 'Principal' });
  await waitFor(() => expect(pedidosDeNegocio().length).toBeGreaterThan(previos));
  return nav;
}
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

  it('si la sesión venció en el medio (401), va a /login con el aviso y avisa que no se guardó', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' }),
    );
    const { usuario, donde } = await llegarAlCambio();
    servidor.sesion = null;
    await completarCambio(usuario);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Ingresá de nuevo para continuar. Lo que estabas guardando no se guardó.',
    );
    expect(donde()).toMatch(/^\/login\?motivo=vencida&sinGuardar=1/);
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

  it('con la barra lateral colapsada, el error del cierre se ve en la página (no queda oculto)', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.forzadas.set('POST /api/auth/logout', NO_DISPONIBLE);
    const { donde } = abrir('/clientes');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Contraer barra lateral' }));
    await usuario.click(screen.getByRole('button', { name: /^Cuenta de Ana Administrativa/ }));
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    // El aviso va arriba de la página: colapsada a íconos, la barra no tiene lugar para mostrarlo
    // (antes quedaba `sr-only` en el pie, invisible).
    const aviso = await within(screen.getByRole('main')).findByRole('alert');
    expect(aviso).toHaveTextContent(
      'No pudimos cerrar la sesión: seguís con la sesión abierta. Probá de nuevo.',
    );
    const sidebar = document.querySelector<HTMLElement>('[data-slot="sidebar"]');
    expect(sidebar).not.toBeNull();
    expect(within(sidebar as HTMLElement).queryByRole('alert')).not.toBeInTheDocument();
    expect(donde()).toBe('/clientes');
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());

    // Al expandir la barra, el aviso no se repite en el pie.
    await usuario.click(screen.getByRole('button', { name: 'Expandir barra lateral' }));
    expect(within(sidebar as HTMLElement).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con la barra lateral colapsada, mientras se cierra la sesión hay un indicador a la vista', async () => {
    servidor.sesion = sesionDePrueba();
    let responder: (respuesta: Response) => void = () => undefined;
    servidor.forzadas.set(
      'POST /api/auth/logout',
      () => new Promise<Response>((resolver) => (responder = resolver)),
    );
    abrir('/clientes');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Contraer barra lateral' }));
    await usuario.click(screen.getByRole('button', { name: /^Cuenta de Ana Administrativa/ }));
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    // En curso: el estado no depende solo de la animación (`aria-busy` y el nombre lo dicen).
    const disparador = await screen.findByRole('button', { name: /, cerrando sesión$/ });
    expect(disparador).toHaveAttribute('aria-busy', 'true');

    // jsdom no aplica Tailwind: se comprueba lo que decide la visibilidad con la barra colapsada.
    // Algún spinner del botón no puede estar debajo de una clase que lo oculte colapsada (el de la
    // derecha se desvanece con las etiquetas, `group-data-[collapsible=icon]:opacity-0`), y su
    // contenedor oculto por defecto tiene que mostrarse colapsada.
    const seVeColapsada = (nodo: Element) => {
      for (let actual: Element | null = nodo; actual && actual !== disparador;) {
        const clases = actual.getAttribute('class') ?? '';
        if (/group-data-\[collapsible=icon\]:(opacity-0|sr-only|hidden)/.test(clases)) return false;
        if (
          /(^|\s)hidden(\s|$)/.test(clases) &&
          !clases.includes('group-data-[collapsible=icon]:flex')
        )
          return false;
        actual = actual.parentElement;
      }
      return true;
    };
    const spinners = Array.from(disparador.querySelectorAll('.animate-spin'));
    expect(spinners.some(seVeColapsada)).toBe(true);

    // No se pide dos veces: las opciones del menú quedan deshabilitadas mientras tanto.
    await usuario.click(disparador);
    expect(await screen.findByRole('menuitem', { name: 'Cerrar sesión' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await usuario.keyboard('{Escape}');

    // Termina (el servidor no confirma): el indicador se va y el aviso va a la página, como antes.
    act(() => responder(NO_DISPONIBLE()));
    const aviso = await within(screen.getByRole('main')).findByRole('alert');
    expect(aviso).toHaveTextContent('seguís con la sesión abierta');
    const enReposo = screen.getByRole('button', { name: /^Cuenta de Ana Administrativa/ });
    expect(enReposo).not.toHaveAttribute('aria-busy');
    expect(enReposo).not.toHaveAccessibleName(/cerrando sesión/);
    expect(enReposo.querySelector('.animate-spin')).toBeNull();
    expect(pedidos().filter((p) => p === 'POST /api/auth/logout')).toHaveLength(1);
  });

  it('con el origen rechazado (403), también dice que la sesión sigue abierta', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.forzadas.set('POST /api/auth/logout', () =>
      error(403, 'FORBIDDEN', { motivo: 'ORIGEN_NO_PERMITIDO' }),
    );
    abrir('/clientes');
    const usuario = await abrirMenuDeCuenta();
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(
      await screen.findByText(
        'No pudimos cerrar la sesión: seguís con la sesión abierta. Recargá la página y probá de nuevo.',
      ),
    ).toBeVisible();
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
  });

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
    servidor.negocio = () => {
      // Venció en el servidor: el 401 de un vencimiento también borra la cookie.
      servidor.sesion = null;
      return error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' });
    };
    const { donde } = abrir('/documentos/tipos?desactivados=1');

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Ingresá de nuevo para continuar.',
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
    servidor.negocio = () => {
      servidor.sesion = null; // la revocaron (logout en otra pestaña, otro equipo)
      return SIN_SESION();
    };
    const { donde } = abrir('/clientes');

    expect(await screen.findByText('Tu sesión terminó. Ingresá de nuevo.')).toBeVisible();
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

  it('un 401 al descargar un documento termina la sesión igual: a /login con el aviso, sin "no se guardó"', async () => {
    // La descarga no es una query ni una mutation (HU4.4): su 401 pasa por el mismo manejo global.
    servidor.sesion = sesionDePrueba();
    const documento = {
      id: '00000000-0000-4000-8000-000000000401',
      tipoDocumento: { id: '00000000-0000-4000-8000-000000000402', nombre: 'Print' },
      anio: 2026,
      mes: 10,
      nombreOriginal: 'print-octubre.pdf',
      tipoContenido: 'application/pdf',
      tamanioBytes: 1024,
      creadoEn: '2026-10-20T12:00:00.000Z',
      actualizadoEn: '2026-10-20T12:00:00.000Z',
      aplicacionesVigentes: 0,
    };
    servidor.forzadas.set('GET /api/documentos?anio=2026&mes=10', () => json(200, [documento]));
    servidor.forzadas.set(`GET /api/documentos/${documento.id}/archivo`, () => {
      servidor.sesion = null; // venció en el servidor
      return error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' });
    });
    const { donde } = abrir('/documentos/archivos?anio=2026&mes=10');
    const usuario = userEvent.setup();

    await usuario.click(await screen.findByRole('button', { name: 'Descargar print-octubre.pdf' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Ingresá de nuevo para continuar.',
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(/no se guardó/);
    expect(donde()).toBe(
      '/login?motivo=vencida&volverA=%2Fdocumentos%2Farchivos%3Fanio%3D2026%26mes%3D10',
    );
    sinShell();
    // La sesión al entrar y una sola confirmación del 401; la descarga no se repitió.
    expect(pedidos().filter((p) => p === 'GET /api/auth/sesion')).toHaveLength(2);
    expect(pedidos().filter((p) => p.endsWith('/archivo'))).toHaveLength(1);
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

describe('H. CONSULTA en el sistema (HU4.3) y servicio no disponible al entrar', () => {
  const CONSULTA = {
    rol: 'CONSULTA',
    nombre: 'Carla Consulta',
    email: 'consulta@realpolitik.test',
  } as const;
  const MATRIZ = '/clientes/11111111-1111-4111-a111-111111111111/matriz';

  it('CONSULTA inicia sesión, ve el shell y vuelve a la página pedida; el menú dice su rol', async () => {
    loginResponde(CONSULTA);
    const { donde } = abrir('/clientes?estado=INACTIVO');
    await completarLogin();

    await enElShell();
    expect(donde()).toBe('/clientes?estado=INACTIVO');
    await userEvent.click(
      screen.getByRole('button', { name: 'Cuenta de Carla Consulta (Consulta)' }),
    );
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('consulta@realpolitik.test')).toBeVisible();
    expect(within(menu).getByText('Consulta')).toBeVisible();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Cambiar contraseña', 'Cerrar sesión']);
  });

  it.each([
    '/clientes',
    '/clientes/matrices',
    MATRIZ,
    '/rendiciones?anio=2026&mes=10',
    '/documentos/tipos?desactivados=1',
    '/documentos/archivos?anio=2026&mes=10',
  ])(
    'CONSULTA entra por URL directa a %s, con su query, y la página pide sus datos',
    async (ruta) => {
      servidor.sesion = sesionDePrueba(CONSULTA);
      const { donde } = abrir(ruta);

      await enElShell();
      expect(donde()).toBe(ruta);
      // Antes de los datos de negocio se confirmó la sesión con el servidor.
      expect(pedidos()[0]).toBe('GET /api/auth/sesion');
      expect(screen.queryByText(/todavía no tiene acceso/)).not.toBeInTheDocument();
    },
  );

  it('una ruta inexistente, con la sesión de CONSULTA, es "Página no encontrada" dentro del shell', async () => {
    servidor.sesion = sesionDePrueba(CONSULTA);
    const { donde } = abrir('/no-existe');

    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    expect(donde()).toBe('/no-existe');
  });

  it('un rol que la interfaz no conoce no entra: sin shell ni pedidos de negocio, y puede salir', async () => {
    // El contrato no lo admite: se simula con la sesión ya en la caché, como si hubiera llegado.
    servidor.sesion = sesionDePrueba();
    queryClient.setQueryData(CLAVE_SESION, sesionDePrueba({ rol: 'INVENTADO' as never }));
    abrir('/clientes');

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Tu cuenta no tiene acceso al sistema.',
      }),
    ).toBeVisible();
    sinShell();
    expect(pedidosDeNegocio()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  });

  it('CONSULTA con contraseña temporal: primero el cambio, sin shell ni datos, también por URL directa', async () => {
    servidor.sesion = sesionDePrueba({ ...CONSULTA, debeCambiarPassword: true });
    const { donde } = abrir('/rendiciones?mes=2026-10');

    expect(await screen.findByRole('heading', { name: 'Configurá tu contraseña' })).toBeVisible();
    expect(donde()).toBe('/cambiar-contrasena?volverA=%2Frendiciones%3Fmes%3D2026-10');
    sinShell();
    expect(pedidosDeNegocio()).toEqual([]);
  });

  it('CONSULTA cambia la temporal, vuelve a entrar con la nueva y llega a la página pedida', async () => {
    const TEMPORAL = 'Temporal-7Kq2-Xp9';
    const NUEVA = 'una frase larga y propia';
    loginResponde({ ...CONSULTA, debeCambiarPassword: true });
    servidor.forzadas.set('PUT /api/auth/password', () => {
      servidor.sesion = null; // el servidor revocó todas las sesiones y borró la cookie
      return new Response(null, { status: 204 });
    });
    const { donde } = abrir('/clientes/matrices');
    const usuario = await completarLogin('consulta@realpolitik.test', TEMPORAL);
    await screen.findByRole('heading', { level: 1, name: 'Configurá tu contraseña' });
    await usuario.type(screen.getByLabelText('Contraseña temporal'), TEMPORAL);
    await usuario.type(screen.getByLabelText('Nueva contraseña'), NUEVA);
    await usuario.type(screen.getByLabelText('Confirmar nueva contraseña'), NUEVA);
    await usuario.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(pedidosDeNegocio()).toEqual([]);

    loginResponde(CONSULTA);
    await completarLogin('consulta@realpolitik.test', NUEVA);
    await enElShell();
    expect(donde()).toBe('/clientes/matrices');
  });

  it('CONSULTA cierra sesión desde el menú de cuenta', async () => {
    servidor.sesion = sesionDePrueba(CONSULTA);
    abrir('/clientes');
    await enElShell();

    await userEvent.click(
      screen.getByRole('button', { name: 'Cuenta de Carla Consulta (Consulta)' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(pedidos()).toContain('POST /api/auth/logout');
    expect(queryClient.getQueryData(CLAVE_SESION)).toBeNull();
  });

  it('un 403 PERMISO_INSUFICIENTE con CONSULTA no cierra la sesión ni manda a /login', async () => {
    servidor.sesion = sesionDePrueba(CONSULTA);
    servidor.negocio = () => error(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' });
    const { donde } = abrir('/clientes');
    await enElShell();

    expect(donde()).toBe('/clientes');
    expect(pedidos()).not.toContain('POST /api/auth/logout');
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba(CONSULTA));
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).not.toBeInTheDocument();
  });

  it('si le cambian el rol con la sesión abierta, el 403 revalida y la pantalla se ajusta, sin cerrar la sesión', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/clientes');
    await enElShell();
    expect(await screen.findByRole('button', { name: /Nuevo cliente/ })).toBeVisible();

    // Pasa a CONSULTA en el servidor: su próxima escritura (o lectura operativa) es 403.
    servidor.sesion = sesionDePrueba({ rol: 'CONSULTA' });
    servidor.negocio = () => error(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' });
    await act(async () => {
      await queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' });
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Nuevo cliente/ })).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: 'Cuenta de Ana Administrativa (Consulta)' }),
    ).toBeVisible();
    expect(donde()).toBe('/clientes');
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

describe('I. menú de cuenta y cambio voluntario de contraseña (HU4.2)', () => {
  const ACTUAL = 'mi contraseña larga';
  const NUEVA = 'otra frase larga y propia';
  const AVISO_DE_EXITO = 'Cambiaste tu contraseña. Cerramos tus otras sesiones abiertas.';

  /** El cambio voluntario del contrato: 204, y la sesión sigue (rotada: el token no se ve). */
  const cambioCorrecto = () =>
    servidor.forzadas.set('PUT /api/auth/password', () => new Response(null, { status: 204 }));

  async function abrirCambio(ruta = '/clientes?estado=INACTIVO') {
    servidor.sesion ??= sesionDePrueba();
    const vista = abrir(ruta);
    const usuario = userEvent.setup();
    const cuenta = await screen.findByRole('button', { name: /^Cuenta de Ana Administrativa/ });
    await usuario.click(cuenta);
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cambiar contraseña' }));
    const panel = await screen.findByRole('dialog', { name: 'Cambiar contraseña' });
    return { ...vista, usuario, panel, cuenta };
  }

  async function completarCambio(
    usuario: ReturnType<typeof userEvent.setup>,
    {
      actual = ACTUAL,
      nueva = NUEVA,
      confirmacion = nueva,
    }: { actual?: string; nueva?: string; confirmacion?: string } = {},
  ) {
    if (actual) await usuario.type(screen.getByLabelText('Contraseña actual'), actual);
    if (nueva) await usuario.type(screen.getByLabelText('Nueva contraseña'), nueva);
    if (confirmacion) {
      await usuario.type(screen.getByLabelText('Confirmar nueva contraseña'), confirmacion);
    }
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  }

  const panelAbierto = () => screen.queryByRole('dialog', { name: 'Cambiar contraseña' });
  /** Sigue en la misma pantalla del sistema (con el panel abierto, el resto queda inerte). */
  const enLaMismaPantalla = (donde: () => string, ruta: string) => {
    expect(donde()).toBe(ruta);
    expect(screen.getByRole('navigation', { name: 'Principal', hidden: true })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Iniciar sesión', hidden: true }),
    ).not.toBeInTheDocument();
  };

  // "Usuarios" solo con `usuarios:administrar` (HU4.5): ADMINISTRADOR.
  it.each([
    ['ADMINISTRATIVO', 'Administrativo', ['Cambiar contraseña', 'Cerrar sesión']],
    ['ADMINISTRADOR', 'Administrador', ['Cambiar contraseña', 'Usuarios', 'Cerrar sesión']],
    ['CONSULTA', 'Consulta', ['Cambiar contraseña', 'Cerrar sesión']],
  ] as const)(
    'el menú de cuenta (%s) muestra nombre, email y rol, y sus opciones',
    async (rol, etiquetaDeRol, opciones) => {
      servidor.sesion = sesionDePrueba({ rol });
      abrir('/clientes');
      await userEvent.click(
        await screen.findByRole('button', {
          name: `Cuenta de Ana Administrativa (${etiquetaDeRol})`,
        }),
      );

      const menu = await screen.findByRole('menu');
      expect(within(menu).getByText('Ana Administrativa')).toBeVisible();
      expect(within(menu).getByText('administrativo@realpolitik.test')).toBeVisible();
      expect(within(menu).getByText(etiquetaDeRol)).toBeVisible();
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((item) => item.textContent),
      ).toEqual(opciones);
      expect(within(menu).getByRole('separator')).toBeInTheDocument();
    },
  );

  it('abre un panel sobre la pantalla actual: tres campos con etiqueta, autocompletado correcto y foco en el primero', async () => {
    const { panel, donde } = await abrirCambio();

    expect(donde()).toBe('/clientes?estado=INACTIVO');
    expect(
      within(panel).getByText('Ana Administrativa · administrativo@realpolitik.test'),
    ).toBeVisible();
    expect(panel).toHaveAccessibleDescription(
      'Vas a seguir con la sesión abierta en este navegador. Al cambiarla, se cierran tus otras sesiones.',
    );
    const actual = within(panel).getByLabelText('Contraseña actual');
    const nueva = within(panel).getByLabelText('Nueva contraseña');
    const confirmacion = within(panel).getByLabelText('Confirmar nueva contraseña');
    expect(actual).toHaveAttribute('autocomplete', 'current-password');
    expect(nueva).toHaveAttribute('autocomplete', 'new-password');
    expect(confirmacion).toHaveAttribute('autocomplete', 'new-password');
    for (const campo of [actual, nueva, confirmacion]) {
      expect(campo).toHaveAttribute('type', 'password');
    }
    expect(nueva).toHaveAccessibleDescription('Podés usar una frase. Los espacios cuentan.');
    expect(
      within(panel).getByRole('list', { name: 'Requisitos de la contraseña' }),
    ).toHaveTextContent(/Al menos 8 caracteres.*Distinta de la actual/);
    await waitFor(() => expect(actual).toHaveFocus());
  });

  it('cada campo se muestra y se oculta con su propio botón accesible', async () => {
    const { usuario, panel } = await abrirCambio();

    for (const [etiqueta, nombre] of [
      ['Contraseña actual', 'contraseña actual'],
      ['Nueva contraseña', 'nueva contraseña'],
      ['Confirmar nueva contraseña', 'confirmación de la contraseña'],
    ] as const) {
      const campo = within(panel).getByLabelText(etiqueta);
      const mostrar = within(panel).getByRole('button', { name: `Mostrar ${nombre}` });
      expect(mostrar).toHaveAttribute('aria-pressed', 'false');
      await usuario.click(mostrar);
      expect(campo).toHaveAttribute('type', 'text');
      const ocultar = within(panel).getByRole('button', { name: `Ocultar ${nombre}` });
      expect(ocultar).toHaveAttribute('aria-pressed', 'true');
      await usuario.click(ocultar);
      expect(campo).toHaveAttribute('type', 'password');
    }
  });

  it('valida con las reglas compartidas antes de enviar: el error en su campo y el foco en el primero', async () => {
    const { usuario, panel } = await abrirCambio();
    const actual = within(panel).getByLabelText('Contraseña actual');
    const nueva = within(panel).getByLabelText('Nueva contraseña');
    const confirmacion = within(panel).getByLabelText('Confirmar nueva contraseña');
    const guardar = within(panel).getByRole('button', { name: 'Guardar cambios' });

    await usuario.click(guardar);
    expect(actual).toHaveFocus();
    expect(actual).toHaveAttribute('aria-invalid', 'true');
    expect(actual).toHaveAccessibleDescription('Ingresá tu contraseña actual.');
    expect(nueva).toHaveAccessibleDescription(expect.stringContaining(MENSAJE_CONTRASENA_CORTA));
    expect(confirmacion).toHaveAccessibleDescription('Repetí la contraseña nueva.');

    await usuario.type(actual, ACTUAL);
    await usuario.type(nueva, 'corta');
    await usuario.type(confirmacion, 'otra');
    await usuario.click(guardar);
    expect(nueva).toHaveFocus();
    expect(nueva).toHaveAccessibleDescription(expect.stringContaining(MENSAJE_CONTRASENA_CORTA));
    expect(confirmacion).toHaveAccessibleDescription('Las contraseñas no coinciden.');

    await usuario.clear(nueva);
    await usuario.type(nueva, ACTUAL);
    await usuario.clear(confirmacion);
    await usuario.type(confirmacion, ACTUAL);
    await usuario.click(guardar);
    expect(nueva).toHaveFocus();
    expect(nueva).toHaveAccessibleDescription(expect.stringContaining(MENSAJE_CONTRASENA_REPETIDA));

    expect(pedidos()).not.toContain('PUT /api/auth/password');
  });

  it('con el 204: confirma la sesión rotada, cierra el panel, avisa y sigue en la misma pantalla sin recargar datos', async () => {
    cambioCorrecto();
    const { usuario, donde, cuenta } = await abrirCambio('/documentos/tipos?desactivados=1');
    await waitFor(() => expect(pedidosDeNegocio().length).toBeGreaterThan(0));
    const negocioAntes = pedidosDeNegocio().length;

    await completarCambio(usuario);

    expect(await screen.findByRole('button', { name: 'Guardada' })).toBeVisible();
    expect(await screen.findByText(AVISO_DE_EXITO, {}, { timeout: 3000 })).toBeVisible();
    await waitFor(() => expect(panelAbierto()).not.toBeInTheDocument());
    enLaMismaPantalla(donde, '/documentos/tipos?desactivados=1');
    // La contraseña viajó solo en el cuerpo; después se confirmó la cookie nueva con el servidor.
    expect(cuerpoDe('PUT /api/auth/password')).toEqual({ actual: ACTUAL, nueva: NUEVA });
    const orden = pedidos();
    expect(orden.lastIndexOf('GET /api/auth/sesion')).toBeGreaterThan(
      orden.indexOf('PUT /api/auth/password'),
    );
    // La identidad sigue en la caché y los datos de la página no se volvieron a pedir.
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(pedidosDeNegocio()).toHaveLength(negocioAntes);
    // El foco vuelve al menú de cuenta; nada de esto queda en el almacenamiento del navegador.
    await waitFor(() => expect(cuenta).toHaveFocus());
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('CONSULTA también cambia su contraseña: la sesión rota y sigue en la misma pantalla', async () => {
    servidor.sesion = sesionDePrueba({ rol: 'CONSULTA' });
    cambioCorrecto();
    const { usuario, donde } = await abrirCambio('/rendiciones');

    await completarCambio(usuario);

    expect(await screen.findByText(AVISO_DE_EXITO, {}, { timeout: 3000 })).toBeVisible();
    await waitFor(() => expect(panelAbierto()).not.toBeInTheDocument());
    enLaMismaPantalla(donde, '/rendiciones');
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba({ rol: 'CONSULTA' }));
  });

  it('cerrar el panel (Escape o Cancelar) descarta lo escrito: no hay borradores de contraseñas', async () => {
    const { usuario, panel } = await abrirCambio();
    await usuario.type(within(panel).getByLabelText('Contraseña actual'), ACTUAL);
    await usuario.type(within(panel).getByLabelText('Nueva contraseña'), NUEVA);
    await usuario.keyboard('{Escape}');
    await waitFor(() => expect(panelAbierto()).not.toBeInTheDocument());

    await usuario.click(screen.getByRole('button', { name: /^Cuenta de Ana Administrativa/ }));
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cambiar contraseña' }));
    const otraVez = await screen.findByRole('dialog', { name: 'Cambiar contraseña' });
    expect(within(otraVez).getByLabelText('Contraseña actual')).toHaveValue('');
    expect(within(otraVez).getByLabelText('Nueva contraseña')).toHaveValue('');

    await usuario.type(within(otraVez).getByLabelText('Nueva contraseña'), NUEVA);
    await usuario.click(within(otraVez).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(panelAbierto()).not.toBeInTheDocument());
    expect(pedidos()).not.toContain('PUT /api/auth/password');
  });

  it('sin doble envío: mientras se guarda, otro clic o Enter no repiten el pedido', async () => {
    let soltar: (respuesta: Response) => void = () => undefined;
    servidor.forzadas.set(
      'PUT /api/auth/password',
      () => new Promise<Response>((resolve) => (soltar = resolve)),
    );
    const { usuario } = await abrirCambio();
    await completarCambio(usuario);

    const guardando = await screen.findByRole('button', { name: 'Guardando…' });
    await usuario.click(guardando);
    await usuario.keyboard('{Enter}');
    expect(screen.getByLabelText('Nueva contraseña')).toHaveAttribute('readonly');
    // Tampoco se cierra mientras tanto.
    await usuario.keyboard('{Escape}');
    expect(panelAbierto()).toBeInTheDocument();

    soltar(new Response(null, { status: 204 }));
    expect(await screen.findByText(AVISO_DE_EXITO, {}, { timeout: 3000 })).toBeVisible();
    expect(pedidos().filter((p) => p === 'PUT /api/auth/password')).toHaveLength(1);
  });

  it('actual incorrecta (400 en "actual"): el error en su campo, vacío y con foco; la sesión sigue', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(400, 'VALIDATION_ERROR', [
        { campo: 'actual', mensaje: 'La contraseña actual no es correcta.' },
      ]),
    );
    const { usuario, donde } = await abrirCambio();
    await completarCambio(usuario, { actual: 'no es la mía' });

    const actual = await screen.findByLabelText('Contraseña actual');
    await waitFor(() => expect(actual).toHaveFocus());
    expect(actual).toHaveValue('');
    expect(actual).toHaveAccessibleDescription('La contraseña actual no es correcta.');
    expect(screen.getByLabelText('Nueva contraseña')).toHaveValue(NUEVA);
    expect(panelAbierto()).toBeInTheDocument();
    enLaMismaPantalla(donde, '/clientes?estado=INACTIVO');
  });

  it('nueva rechazada por la política (400 en "nueva"): el mensaje en su campo', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () =>
      error(400, 'VALIDATION_ERROR', [{ campo: 'nueva', mensaje: MENSAJE_CONTRASENA_PREVISIBLE }]),
    );
    const { usuario } = await abrirCambio();
    await completarCambio(usuario, { nueva: 'qwertyuiopasdfgh' });

    const nueva = await screen.findByLabelText('Nueva contraseña');
    await waitFor(() => expect(nueva).toHaveFocus());
    expect(nueva).toHaveAccessibleDescription(
      expect.stringContaining(MENSAJE_CONTRASENA_PREVISIBLE),
    );
    expect(screen.getByLabelText('Contraseña actual')).toHaveValue(ACTUAL);
  });

  it.each([
    [
      '429',
      () =>
        error(429, 'TOO_MANY_REQUESTS', { motivo: 'DEMASIADOS_INTENTOS' }, { 'Retry-After': '30' }),
      'Demasiados intentos. Probá de nuevo en 30 segundos.',
    ],
    [
      '503',
      NO_DISPONIBLE,
      'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.',
    ],
    [
      'red caída',
      () => Promise.reject(new TypeError('Failed to fetch')),
      'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.',
    ],
  ] as const)(
    'con %s: un aviso en el panel, lo escrito se conserva y la sesión NO se cierra',
    async (_, respuesta, texto) => {
      servidor.forzadas.set('PUT /api/auth/password', respuesta);
      const { usuario, donde } = await abrirCambio();
      await completarCambio(usuario);

      const panel = await screen.findByRole('dialog', { name: 'Cambiar contraseña' });
      const aviso = await within(panel).findByText(texto);
      await waitFor(() => expect(aviso.closest('[tabindex="-1"]')).toHaveFocus());
      expect(aviso).not.toHaveTextContent('mensaje interno');
      expect(within(panel).getByLabelText('Nueva contraseña')).toHaveValue(NUEVA);
      enLaMismaPantalla(donde, '/clientes?estado=INACTIVO');
      expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
      expect(pedidos()).not.toContain('POST /api/auth/logout');
    },
  );

  it('si la sesión terminó mientras tanto (401 confirmado): a /login, avisando que no se guardó', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () => {
      servidor.sesion = null; // la cerraron en otro lado
      return SIN_SESION();
    });
    const { usuario, donde } = await abrirCambio();
    await completarCambio(usuario);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión terminó. Ingresá de nuevo. Lo que estabas guardando no se guardó.',
    );
    expect(donde()).toBe(
      '/login?motivo=terminada&sinGuardar=1&volverA=%2Fclientes%3Festado%3DINACTIVO',
    );
  });

  it('si el servidor lo trató como obligatorio (borró la cookie), hay que volver a entrar con la nueva', async () => {
    servidor.forzadas.set('PUT /api/auth/password', () => {
      servidor.sesion = null; // le restablecieron la contraseña mientras tanto: cambio obligatorio
      return new Response(null, { status: 204 });
    });
    const { usuario, donde } = await abrirCambio();
    await completarCambio(usuario);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Elegiste tu contraseña. Ingresá con la nueva.',
    );
    expect(donde()).toBe('/login?motivo=contrasena&volverA=%2Fclientes%3Festado%3DINACTIVO');
  });
});

describe('J. expiración, revocación, 401 atrasados y varias pestañas (HU4.2)', () => {
  const getsDeSesion = () => pedidos().filter((p) => p === 'GET /api/auth/sesion').length;
  /** El listado de tipos de documento (la página pide además los inactivos, con otra URL). */
  const LISTADO_DE_TIPOS = 'GET /api/tipos-documento';
  const deTipos = () => pedidos().filter((p) => p === LISTADO_DE_TIPOS).length;

  /** La pestaña vuelve a estar visible pasado el plazo de revalidación de la sesión. */
  function volverALaPestana() {
    const despues = Date.now() + REVALIDACION_DE_SESION_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(despues);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    focusManager.setFocused(undefined);
  });

  it('al abrir la app con una cookie vencida, /login lo dice y vuelve a la página con sus filtros', async () => {
    servidor.forzadas.set('GET /api/auth/sesion', () => {
      servidor.forzadas.delete('GET /api/auth/sesion'); // el 401 de un vencimiento borra la cookie
      return error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' });
    });
    loginResponde();
    const { donde } = abrir('/clientes?estado=INACTIVO&q=muni');

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Ingresá de nuevo para continuar.',
    );
    expect(donde()).toBe(
      '/login?motivo=vencida&volverA=%2Fclientes%3Festado%3DINACTIVO%26q%3Dmuni',
    );

    await completarLogin();
    await enElShell();
    expect(donde()).toBe('/clientes?estado=INACTIVO&q=muni');
  });

  it('quien entra sin sesión (primera vez, sin cookie) no ve ningún aviso de sesión vencida', async () => {
    const { donde } = abrir('/clientes');

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tu sesión (venció|terminó)/)).not.toBeInTheDocument();
    expect(donde()).toBe('/login?volverA=%2Fclientes');
  });

  it('un volverA externo se ignora también después de una sesión vencida (sin redirección abierta)', async () => {
    loginResponde();
    const { donde } = abrir('/login?motivo=vencida&volverA=%2F%2Fmalo.example%2Fx');

    expect(
      await screen.findByText('Tu sesión venció. Ingresá de nuevo para continuar.'),
    ).toBeVisible();
    await completarLogin();
    await enElShell();
    expect(donde()).toBe('/rendiciones');
  });

  it('al volver a la pestaña revalida la sesión, sin polling: si la cerraron en otra pestaña, va a /login', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/clientes?estado=INACTIVO');
    await enElShell();
    expect(getsDeSesion()).toBe(1);

    // La cerraron en otra pestaña: mientras esta no vuelve a estar visible, no pregunta.
    servidor.sesion = null;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getsDeSesion()).toBe(1);

    volverALaPestana();

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Tu sesión terminó. Ingresá de nuevo.');
    expect(donde()).toBe('/login?motivo=terminada&volverA=%2Fclientes%3Festado%3DINACTIVO');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] !== 'sesion' && q.state.data !== undefined),
    ).toEqual([]);
  });

  it('si al volver a la pestaña el servidor no responde, la sesión NO se pierde', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/clientes');
    await enElShell();
    servidor.forzadas.set('GET /api/auth/sesion', NO_DISPONIBLE);
    servidor.negocio = NO_DISPONIBLE;

    volverALaPestana();

    await waitFor(() => expect(getsDeSesion()).toBeGreaterThan(1));
    await waitFor(() => expect(queryClient.getQueryState(CLAVE_SESION)?.fetchStatus).toBe('idle'), {
      timeout: 3000,
    });
    expect(donde()).toBe('/clientes');
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
  });

  it('si al volver a la pestaña la sesión es de otra cuenta (otra pestaña entró con otra), no queda nada de la anterior', async () => {
    servidor.sesion = sesionDePrueba();
    abrir('/documentos/tipos');
    await enElShell();
    queryClient.setQueryData(['dato-de-negocio'], 'de Ana');
    servidor.sesion = sesionDePrueba({
      id: '0000a000-0000-4000-8000-000000000002',
      nombre: 'Beto Bermúdez',
    });

    volverALaPestana();

    expect(
      await screen.findByRole('button', { name: 'Cuenta de Beto Bermúdez (Administrativo)' }),
    ).toBeVisible();
    expect(queryClient.getQueryData(['dato-de-negocio'])).toBeUndefined();
  });

  it('un 401 de un pedido que salió con el token anterior (otra pestaña rotó la sesión): la sesión sigue y el pedido se repite', async () => {
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/documentos/tipos');
    await enElShell();
    await waitFor(() => expect(deTipos()).toBe(1));
    const sesionesAntes = getsDeSesion();

    // La cookie del navegador ya es la rotada; este pedido viajó con la anterior.
    servidor.forzadas.set(LISTADO_DE_TIPOS, () => {
      servidor.forzadas.delete(LISTADO_DE_TIPOS);
      return SIN_SESION();
    });
    await act(() => queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' }));

    // Se confirmó con el servidor (una vez) y el listado se volvió a pedir (una vez).
    await waitFor(() => expect(deTipos()).toBe(3));
    expect(getsDeSesion()).toBe(sesionesAntes + 1);
    expect(donde()).toBe('/documentos/tipos');
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible();
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
  });

  it('si el servidor sigue rechazando un pedido con la sesión válida, no se insiste en un bucle', async () => {
    servidor.sesion = sesionDePrueba();
    abrir('/documentos/tipos');
    await enElShell();
    await waitFor(() => expect(deTipos()).toBe(1));

    // El listado responde 401, pero `GET /auth/sesion` dice que la sesión vale.
    servidor.forzadas.set(LISTADO_DE_TIPOS, SIN_SESION);
    await act(() => queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' }));

    await waitFor(() => expect(deTipos()).toBe(3));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(deTipos()).toBe(3);
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeVisible();
  });

  it('un 401 atrasado durante el cambio voluntario en esta pestaña espera la rotación y no cierra la sesión nueva', async () => {
    let soltarCambio: (respuesta: Response) => void = () => undefined;
    servidor.forzadas.set(
      'PUT /api/auth/password',
      () => new Promise<Response>((resolve) => (soltarCambio = resolve)),
    );
    servidor.sesion = sesionDePrueba();
    const { donde } = abrir('/documentos/tipos');
    const usuario = userEvent.setup();
    await usuario.click(
      await screen.findByRole('button', { name: /^Cuenta de Ana Administrativa/ }),
    );
    await usuario.click(await screen.findByRole('menuitem', { name: 'Cambiar contraseña' }));
    await usuario.type(await screen.findByLabelText('Contraseña actual'), 'mi contraseña larga');
    await usuario.type(screen.getByLabelText('Nueva contraseña'), 'otra frase larga y propia');
    await usuario.type(
      screen.getByLabelText('Confirmar nueva contraseña'),
      'otra frase larga y propia',
    );
    await usuario.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByRole('button', { name: 'Guardando…' });
    await waitFor(() => expect(deTipos()).toBe(1));

    // Un pedido de la página salió con el token que el cambio está revocando.
    const sesionesAntes = getsDeSesion();
    servidor.negocio = SIN_SESION;
    await act(() => queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // No se dio por terminada ni se preguntó todavía: espera a que el cambio termine.
    expect(getsDeSesion()).toBe(sesionesAntes);
    expect(screen.queryByRole('heading', { name: 'Iniciar sesión' })).not.toBeInTheDocument();

    servidor.negocio = () => json(200, []);
    soltarCambio(new Response(null, { status: 204 }));

    expect(
      await screen.findByText(
        'Cambiaste tu contraseña. Cerramos tus otras sesiones abiertas.',
        {},
        { timeout: 3000 },
      ),
    ).toBeVisible();
    expect(donde()).toBe('/documentos/tipos');
    expect(queryClient.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    // La consulta que falló se volvió a pedir, ya con la cookie nueva.
    await waitFor(() => expect(deTipos()).toBe(3));
    // Las dos consultas de la sesión (la del cambio y la del 401) salieron después del cambio.
    const orden = pedidos();
    const despuesDelCambio = orden.slice(orden.indexOf('PUT /api/auth/password') + 1);
    expect(despuesDelCambio.filter((p) => p === 'GET /api/auth/sesion')).toHaveLength(2);
  });

  it('varios 401 a la vez: una sola confirmación y una sola navegación, sin pisar el motivo ni perder volverA', async () => {
    servidor.sesion = sesionDePrueba();
    const { router, donde } = abrir('/clientes?estado=INACTIVO&q=muni');
    await enElShell();
    const navegaciones: string[] = [];
    const dejar = router.subscribe((estado) =>
      navegaciones.push(`${estado.location.pathname}${estado.location.search}`),
    );
    const sesionesAntes = getsDeSesion();
    // Venció: el primer 401 lo dice (y borra la cookie); los siguientes ya no tienen cookie.
    servidor.negocio = () => {
      servidor.sesion = null;
      return error(401, 'UNAUTHENTICATED', { motivo: 'SESION_VENCIDA' });
    };

    await act(async () => {
      await Promise.allSettled(
        [1, 2, 3].map((n) =>
          queryClient.fetchQuery({
            queryKey: ['negocio', n],
            queryFn: () => http(`/negocio/${n}`),
            retry: false,
          }),
        ),
      );
    });

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión venció. Ingresá de nuevo para continuar.',
    );
    expect(donde()).toBe(
      '/login?motivo=vencida&volverA=%2Fclientes%3Festado%3DINACTIVO%26q%3Dmuni',
    );
    expect(getsDeSesion()).toBe(sesionesAntes + 1);
    expect(navegaciones.filter((ruta) => ruta.startsWith('/login'))).toHaveLength(1);
    dejar();
  });

  it('si la sesión se pierde al enviar un formulario, /login avisa que no se guardó y vuelve a la página', async () => {
    servidor.sesion = sesionDePrueba();
    servidor.forzadas.set('POST /api/tipos-documento', () => {
      servidor.sesion = null;
      return SIN_SESION();
    });
    const { donde } = abrir('/documentos/tipos');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Nuevo tipo' }));
    const panel = await screen.findByRole('dialog', { name: 'Nuevo tipo de documento' });
    await usuario.type(within(panel).getByLabelText('Nombre'), 'Constancia de inscripción');
    await usuario.click(within(panel).getByRole('button', { name: 'Crear tipo' }));

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu sesión terminó. Ingresá de nuevo. Lo que estabas guardando no se guardó.',
    );
    expect(donde()).toBe('/login?motivo=terminada&sinGuardar=1&volverA=%2Fdocumentos%2Ftipos');

    loginResponde();
    const antesDeVolver = pedidosDeNegocio().length;
    await completarLogin();
    await enElShell(antesDeVolver);
    expect(donde()).toBe('/documentos/tipos');
  });
});
