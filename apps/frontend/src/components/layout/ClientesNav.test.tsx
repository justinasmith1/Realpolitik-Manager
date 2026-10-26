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
  it('en /clientes aparece solo con Clientes y Requisitos, y marca solo Clientes', () => {
    renderRoute('/clientes');

    const links = within(navSecundaria()).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Clientes', 'Requisitos']);
    expect(enlaceSecundario('Clientes')).toHaveAttribute('href', '/clientes');
    expect(enlaceSecundario('Clientes')).toHaveAttribute('aria-current', 'page');
    expect(enlaceSecundario('Requisitos')).toHaveAttribute('href', '/clientes/matrices');
    expect(enlaceSecundario('Requisitos')).not.toHaveAttribute('aria-current');
  });

  it('ya no ofrece Tipos de documento: es una sección propia, Documentos', () => {
    renderRoute('/clientes');

    expect(
      within(navSecundaria()).queryByRole('link', { name: 'Tipos de documento' }),
    ).not.toBeInTheDocument();
    expect(within(navSecundaria()).queryByRole('link', { name: 'Documentos' })).toBeNull();
  });

  it('en /clientes/matrices marca solo Requisitos (Clientes no coincide parcialmente)', () => {
    renderRoute('/clientes/matrices');

    expect(enlaceSecundario('Requisitos')).toHaveAttribute('aria-current', 'page');
    expect(enlaceSecundario('Clientes')).not.toHaveAttribute('aria-current');
  });

  it('son enlaces reales en un <nav>, no pestañas', () => {
    renderRoute('/clientes');

    expect(within(navSecundaria()).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(navSecundaria()).queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('lleva de Clientes a Requisitos y Atrás/Adelante vuelven sobre sus pasos', async () => {
    const { router, user } = renderRoute('/clientes');

    await user.click(enlaceSecundario('Requisitos'));
    expect(router.state.location.pathname).toBe('/clientes/matrices');
    expect(enlaceSecundario('Requisitos')).toHaveAttribute('aria-current', 'page');

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/clientes');
    expect(enlaceSecundario('Clientes')).toHaveAttribute('aria-current', 'page');

    await act(() => router.navigate(1));
    expect(router.state.location.pathname).toBe('/clientes/matrices');
  });

  it('desde Requisitos vuelve a Clientes con su enlace', async () => {
    const { router, user } = renderRoute('/clientes/matrices');

    await user.click(enlaceSecundario('Clientes'));

    expect(router.state.location.pathname).toBe('/clientes');
    expect(
      await screen.findByText('Catálogo de clientes y su configuración de rendición.'),
    ).toBeInTheDocument();
  });

  it('se recorre con el teclado y Enter sigue el enlace', async () => {
    const { router, user } = renderRoute('/clientes');

    enlaceSecundario('Requisitos').focus();
    expect(enlaceSecundario('Requisitos')).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(router.state.location.pathname).toBe('/clientes/matrices');
  });
});

describe('Ruta /documentos en el shell', () => {
  it('la entrada directa por URL muestra el catálogo dentro del shell, con el encabezado Documentos', async () => {
    renderRoute('/documentos');

    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Documentos',
    );
    expect(
      screen.getByText('Catálogo de tipos de documento que se pueden pedir como requisito.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Todavía no hay tipos de documento')).toBeInTheDocument();
  });

  it('no muestra la navegación secundaria de Clientes', () => {
    renderRoute('/documentos');

    expect(screen.queryByRole('navigation', { name: 'Secciones de Clientes' })).toBeNull();
  });

  it('el Sidebar ofrece Clientes y Documentos, y marca solo Documentos', () => {
    renderRoute('/documentos');

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Clientes', 'Documentos']);
    expect(enlaceDelSidebar('Documentos')).toHaveAttribute('href', '/documentos');
    expect(enlaceDelSidebar('Documentos')).toHaveAttribute('aria-current', 'page');
    expect(enlaceDelSidebar('Clientes')).not.toHaveAttribute('aria-current');
  });

  it('en /clientes el Sidebar marca Clientes y no Documentos', () => {
    renderRoute('/clientes');

    expect(enlaceDelSidebar('Clientes')).toHaveAttribute('aria-current', 'page');
    expect(enlaceDelSidebar('Documentos')).not.toHaveAttribute('aria-current');
  });

  it('se llega a Documentos desde el Sidebar sin pasar por Clientes, y Atrás vuelve', async () => {
    const { router, user } = renderRoute('/clientes/matrices');

    await user.click(enlaceDelSidebar('Documentos'));
    expect(router.state.location.pathname).toBe('/documentos');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Documentos' }),
    ).toBeInTheDocument();

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/clientes/matrices');
  });

  it('en mobile el Header dice "Documentos"', () => {
    simularMobile();
    renderRoute('/documentos');

    expect(within(screen.getByRole('banner')).getByText('Documentos')).toBeInTheDocument();
  });

  it('en mobile, en /clientes, el Header sigue diciendo "Clientes"', () => {
    simularMobile();
    renderRoute('/clientes');

    expect(within(screen.getByRole('banner')).getByText('Clientes')).toBeInTheDocument();
  });

  it.each(['/clientes/otra-ruta-invalida', '/documentos/extra'])(
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
