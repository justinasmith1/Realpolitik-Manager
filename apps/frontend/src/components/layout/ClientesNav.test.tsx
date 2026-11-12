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
  it('la entrada directa por URL al catálogo lo muestra dentro del shell, con el encabezado Documentos', async () => {
    renderRoute('/documentos/tipos');

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
    renderRoute('/documentos/archivos');

    expect(screen.queryByRole('navigation', { name: 'Secciones de Clientes' })).toBeNull();
  });

  it.each(['/documentos/archivos', '/documentos/tipos'])(
    'en %s el Sidebar ofrece Rendiciones, Clientes y Documentos, y marca solo Documentos',
    (path) => {
      renderRoute(path);

      const nav = screen.getByRole('navigation', { name: 'Principal' });
      expect(
        within(nav)
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Rendiciones', 'Clientes', 'Documentos']);
      // Documentos abre el repositorio, y queda marcado también en la pestaña de tipos.
      expect(enlaceDelSidebar('Documentos')).toHaveAttribute('href', '/documentos/archivos');
      expect(enlaceDelSidebar('Documentos')).toHaveAttribute('aria-current', 'page');
      expect(enlaceDelSidebar('Clientes')).not.toHaveAttribute('aria-current');
    },
  );

  it('en /clientes el Sidebar marca Clientes y no Documentos', () => {
    renderRoute('/clientes');

    expect(enlaceDelSidebar('Clientes')).toHaveAttribute('aria-current', 'page');
    expect(enlaceDelSidebar('Documentos')).not.toHaveAttribute('aria-current');
  });

  it('desde el Sidebar, Documentos abre el repositorio de archivos, y Atrás vuelve', async () => {
    const { router, user } = renderRoute('/clientes/matrices');

    await user.click(enlaceDelSidebar('Documentos'));
    expect(router.state.location.pathname).toBe('/documentos/archivos');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Documentos' }),
    ).toBeInTheDocument();
    const secciones = screen.getByRole('navigation', { name: 'Secciones de Documentos' });
    expect(within(secciones).getByRole('link', { name: 'Archivos' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe('/clientes/matrices');
  });

  it('desde el repositorio, la pestaña Tipos de documento lleva al catálogo', async () => {
    const { router, user } = renderRoute('/documentos/archivos');
    const secciones = () => screen.getByRole('navigation', { name: 'Secciones de Documentos' });
    expect(
      within(secciones())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Archivos', 'Tipos de documento']);

    await user.click(within(secciones()).getByRole('link', { name: 'Tipos de documento' }));

    expect(router.state.location.pathname).toBe('/documentos/tipos');
    expect(
      await screen.findByText('Catálogo de tipos de documento que se pueden pedir como requisito.'),
    ).toBeInTheDocument();
    expect(within(secciones()).getByRole('link', { name: 'Tipos de documento' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('en mobile el Header dice "Documentos"', () => {
    simularMobile();
    renderRoute('/documentos/archivos');

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

  it('/ redirige a /rendiciones (HU3.2)', async () => {
    const { router } = renderRoute('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rendiciones' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/rendiciones');
  });
});
