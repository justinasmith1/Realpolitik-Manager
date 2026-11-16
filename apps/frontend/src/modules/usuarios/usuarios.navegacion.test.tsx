// Acceso a la administración de usuarios con las rutas, los providers y el QueryClient reales de
// la app (como main.tsx). Lo único simulado es `fetch`: la sesión vive en el servidor de mentira.

import type { RolUsuarioType, SesionActual } from '@realpolitik/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, queryClient } from '@/app/providers';
import { routes } from '@/app/router';
import { sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';

const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const servidor = {
  sesion: null as SesionActual | null,
  usuarios: () => json(200, []),
};

const urlDe = (entrada: RequestInfo | URL) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

const pedidos = () =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${urlDe(url)}`);
const pedidosDeUsuarios = () => pedidos().filter((p) => p.includes('/api/usuarios'));

function abrir(ruta: string) {
  const router = createMemoryRouter(routes, { initialEntries: [ruta] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

const conRol = (rol: RolUsuarioType) => {
  servidor.sesion = sesionDePrueba({ rol });
};

async function itemsDelMenuDeCuenta() {
  await userEvent.click(await screen.findByRole('button', { name: /^Cuenta de / }));
  const menu = await screen.findByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent);
}

beforeEach(() => {
  queryClient.clear();
  servidor.sesion = null;
  servidor.usuarios = () => json(200, []);
  vi.stubEnv('VITE_API_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation((entrada) => {
    const url = urlDe(entrada);
    if (url === '/api/auth/sesion') {
      return Promise.resolve(
        servidor.sesion
          ? json(200, servidor.sesion)
          : json(401, {
              error: { code: 'UNAUTHENTICATED', details: { motivo: 'SESION_REQUERIDA' } },
            }),
      );
    }
    if (url.startsWith('/api/usuarios')) return Promise.resolve(servidor.usuarios());
    return Promise.resolve(json(200, []));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('Usuarios en el menú de cuenta', () => {
  it('ADMINISTRADOR ve "Usuarios" entre "Cambiar contraseña" y "Cerrar sesión", y lleva a /usuarios', async () => {
    conRol('ADMINISTRADOR');
    const router = abrir('/clientes');
    expect(await itemsDelMenuDeCuenta()).toEqual([
      'Cambiar contraseña',
      'Usuarios',
      'Cerrar sesión',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Usuarios' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Usuarios' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/usuarios');
    await waitFor(() => expect(pedidosDeUsuarios()).toEqual(['GET /api/usuarios']));
  });

  it.each(['ADMINISTRATIVO', 'CONSULTA'] as const)('%s no ve "Usuarios"', async (rol) => {
    conRol(rol);
    abrir('/clientes');
    expect(await itemsDelMenuDeCuenta()).toEqual(['Cambiar contraseña', 'Cerrar sesión']);
  });

  it('en mobile, "Usuarios" cierra el cajón y abre la página con tarjetas', async () => {
    // Viewport angosto: coinciden las media queries `max-width` (cajón y tarjetas).
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    conRol('ADMINISTRADOR');
    servidor.usuarios = () =>
      json(200, [
        {
          id: sesionDePrueba().usuario.id,
          nombre: 'Ana Administrativa',
          email: 'administrativo@realpolitik.test',
          rol: 'ADMINISTRADOR',
          activo: true,
          debeCambiarPassword: false,
          ultimoAccesoEn: null,
        },
      ]);
    const router = abrir('/clientes');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Alternar barra lateral' }));
    const cajon = await screen.findByRole('dialog', { name: 'Navegación' });
    await user.click(within(cajon).getByRole('button', { name: /^Cuenta de / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Usuarios' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Navegación' })).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe('/usuarios');
    expect(within(screen.getByRole('banner')).getByText('Usuarios')).toBeInTheDocument();
    const tarjetas = await screen.findByRole('list', { name: 'Usuarios' });
    expect(within(tarjetas).getByText('Tu cuenta')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('el sidebar principal no gana un destino "Usuarios" (tampoco para ADMINISTRADOR)', async () => {
    conRol('ADMINISTRADOR');
    abrir('/clientes');
    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(nav).queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
  });
});

describe('/usuarios por URL', () => {
  it.each(['ADMINISTRATIVO', 'CONSULTA'] as const)(
    '%s ve "No tenés acceso", dentro del shell, sin montar la página ni pedir /usuarios',
    async (rol) => {
      conRol(rol);
      abrir('/usuarios');
      expect(
        await screen.findByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Si creés que deberías tenerlo, consultalo con quien administra las cuentas.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ir a Rendiciones' })).toHaveAttribute(
        'href',
        '/rendiciones',
      );
      expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Página no encontrada' }),
      ).not.toBeInTheDocument();
      expect(pedidosDeUsuarios()).toEqual([]);
    },
  );

  it('una ruta inexistente sigue siendo "Página no encontrada", no "sin acceso"', async () => {
    conRol('CONSULTA');
    abrir('/usuarios-viejos');
    expect(
      await screen.findByRole('heading', { name: 'Página no encontrada' }),
    ).toBeInTheDocument();
  });

  it('sin sesión, /usuarios lleva a /login sin pedir /usuarios', async () => {
    const router = abrir('/usuarios');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(pedidosDeUsuarios()).toEqual([]);
  });

  it('si le quitan el rol con la página abierta, el 403 revalida la sesión y pasa a "sin acceso", sin bucles ni cerrar la sesión', async () => {
    conRol('ADMINISTRADOR');
    const router = abrir('/usuarios');
    await screen.findByRole('heading', { level: 1, name: 'Usuarios' });
    await waitFor(() => expect(pedidosDeUsuarios()).toHaveLength(1));

    // En el servidor pasa a ADMINISTRATIVO: la API es la que decide y responde 403.
    conRol('ADMINISTRATIVO');
    servidor.usuarios = () =>
      json(403, { error: { code: 'FORBIDDEN', details: { motivo: 'PERMISO_INSUFICIENTE' } } });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['usuarios'] });
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/usuarios');
    expect(pedidos()).not.toContain('POST /api/auth/logout');
    // Un solo pedido después del cambio: no se insiste.
    expect(pedidosDeUsuarios()).toHaveLength(2);
  });
});
