import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';

// Las rutas reales de la app, dentro de sus providers (como main.tsx). Solo `fetch` es simulado:
// cualquier listado responde vacío, que acá no es el tema.
const fetchMock = vi.fn<typeof fetch>();

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, user: userEvent.setup() };
}

const navSecundaria = () => screen.getByRole('navigation', { name: 'Secciones de Clientes' });
const enlaceSecundario = (nombre: string) =>
  within(navSecundaria()).getByRole('link', { name: nombre });
const enlaceDelSidebar = (nombre: string) =>
  within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: nombre });

// Simula un viewport mobile: coincide toda media query `max-width` (como en AppLayout.test).
function simularMobile() {
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
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('ClientesNav', () => {
  it('en /clientes aparece con sus dos destinos y marca solo Clientes', () => {
    renderRoute('/clientes');

    const links = within(navSecundaria()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Clientes',
      'Requisitos',
      'Tipos de documento',
    ]);
    expect(enlaceSecundario('Clientes')).toHaveAttribute('href', '/clientes');
    expect(enlaceSecundario('Clientes')).toHaveAttribute('aria-current', 'page');
    expect(enlaceSecundario('Requisitos')).toHaveAttribute('href', '/clientes/matrices');
    expect(enlaceSecundario('Requisitos')).not.toHaveAttribute('aria-current');
    expect(enlaceSecundario('Tipos de documento')).toHaveAttribute(
      'href',
      '/clientes/tipos-documento',
    );
    expect(enlaceSecundario('Tipos de documento')).not.toHaveAttribute('aria-current');
  });

  it('en /clientes/tipos-documento marca solo Tipos de documento (Clientes no coincide parcialmente)', () => {
    renderRoute('/clientes/tipos-documento');

    expect(enlaceSecundario('Tipos de documento')).toHaveAttribute('aria-current', 'page');
    expect(enlaceSecundario('Clientes')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
  });

  it('son enlaces reales en un <nav>, no pestañas', () => {
    renderRoute('/clientes');

    expect(within(navSecundaria()).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(navSecundaria()).queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lleva de Clientes a Tipos de documento y Atrás/Adelante vuelven sobre sus pasos', async () => {
    const { router, user } = renderRoute('/clientes');

    await user.click(enlaceSecundario('Tipos de documento'));
    expect(router.state.location.pathname).toBe('/clientes/tipos-documento');
    expect(
      await screen.findByText('Tipos de documento que se pueden pedir como requisito.'),
    ).toBeInTheDocument();

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/clientes');
    expect(enlaceSecundario('Clientes')).toHaveAttribute('aria-current', 'page');

    await act(() => router.navigate(1));
    expect(router.state.location.pathname).toBe('/clientes/tipos-documento');
  });

  it('desde Tipos de documento vuelve a Clientes con su enlace', async () => {
    const { router, user } = renderRoute('/clientes/tipos-documento');

    await user.click(enlaceSecundario('Clientes'));

    expect(router.state.location.pathname).toBe('/clientes');
    expect(
      await screen.findByText('Catálogo de clientes y su configuración de rendición.'),
    ).toBeInTheDocument();
  });

  it('se recorre con el teclado y Enter sigue el enlace', async () => {
    const { router, user } = renderRoute('/clientes');

    enlaceSecundario('Tipos de documento').focus();
    expect(enlaceSecundario('Tipos de documento')).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(router.state.location.pathname).toBe('/clientes/tipos-documento');
  });
});

describe('Ruta /clientes/tipos-documento en el shell', () => {
  it('la entrada directa por URL muestra el catálogo dentro del shell', async () => {
    renderRoute('/clientes/tipos-documento');

    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Clientes',
    );
    expect(await screen.findByText('Todavía no hay tipos de documento')).toBeInTheDocument();
  });

  it('el Sidebar sigue marcando Clientes como sección y no suma un destino propio', () => {
    renderRoute('/clientes/tipos-documento');

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
    expect(enlaceDelSidebar('Clientes')).toHaveAttribute('aria-current', 'page');
  });

  it('en mobile el Header dice "Tipos de documento"', () => {
    simularMobile();
    renderRoute('/clientes/tipos-documento');

    expect(within(screen.getByRole('banner')).getByText('Tipos de documento')).toBeInTheDocument();
  });

  it('en mobile, en /clientes, el Header sigue diciendo "Clientes"', () => {
    simularMobile();
    renderRoute('/clientes');

    expect(within(screen.getByRole('banner')).getByText('Clientes')).toBeInTheDocument();
  });

  it.each(['/clientes/otra-ruta-invalida', '/clientes/tipos-documento/extra'])(
    '%s no existe: muestra la página no encontrada',
    (path) => {
      renderRoute(path);

      expect(
        screen.getByRole('heading', { level: 1, name: 'Página no encontrada' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Secciones de Clientes' })).toBeNull();
    },
  );

  it('/ sigue redirigiendo a /clientes', async () => {
    const { router } = renderRoute('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clientes');
  });
});
