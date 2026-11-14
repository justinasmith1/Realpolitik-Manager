import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';
import { conSesionDePrueba } from '@/modules/auth/test/sesionDePrueba';

// Igual que main.tsx: el router dentro de los providers de la app.
function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

// Simula un viewport mobile: coincide la media query `max-width` de useIsMobile.
function mockMobileViewport() {
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

// La página de Clientes tiene además su navegación secundaria, con otro enlace "Clientes": las
// consultas del Sidebar se hacen dentro de su `<nav>`.
const enlaceDelSidebar = (nombre: string) =>
  within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: nombre });

// El `fetch` del setup, que no sale a la red: lo que este archivo no simula pasa por ahí y hace
// fallar el test con la URL pedida.
const fetchSinSimular = globalThis.fetch;

// La página de /clientes pide el listado al montarse. El layout no depende de esos datos: se
// simula vacío, así el test no le pega a ningún backend.
const fetchMock = vi.fn<typeof fetch>((entrada, init) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  if ((init?.method ?? 'GET') === 'GET' && url.pathname === '/clientes') {
    return Promise.resolve(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  }
  return fetchSinSimular(entrada, init);
});

// Simulado para todo el archivo, no por test: la página es lazy y, en un test sincrónico, termina
// de montarse (y pide el listado) después de que el test terminó. Si el mock se quitara en cada
// `afterEach`, ese pedido tardío caería en el test siguiente como "no simulado".
beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  conSesionDePrueba();
});

afterEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockClear();
});

describe('AppLayout', () => {
  it('muestra Realpolitik Manager como identidad del producto', () => {
    renderRoute('/clientes');

    expect(screen.getByText('Realpolitik Manager')).toBeInTheDocument();
  });

  it('ofrece Rendiciones (primero), Clientes y Documentos, y marca Clientes como página actual en /clientes', () => {
    renderRoute('/clientes');

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAccessibleName('Rendiciones');
    expect(links[0]).toHaveAttribute('href', '/rendiciones');
    expect(links[0]).not.toHaveAttribute('aria-current');
    expect(links[1]).toHaveAccessibleName('Clientes');
    expect(links[1]).toHaveAttribute('href', '/clientes');
    expect(links[1]).toHaveAttribute('aria-current', 'page');
    expect(links[2]).toHaveAccessibleName('Documentos');
    expect(links[2]).toHaveAttribute('href', '/documentos/archivos');
    expect(links[2]).not.toHaveAttribute('aria-current');
  });

  it('en escritorio no repite el título: no hay Header y la página conserva su h1', () => {
    renderRoute('/clientes');

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
  });

  it('en mobile el Header muestra la sección actual junto al botón del menú', () => {
    mockMobileViewport();
    renderRoute('/clientes');

    const header = within(screen.getByRole('banner'));
    expect(header.getByText('Clientes')).toBeInTheDocument();
    expect(header.getByRole('button', { name: 'Alternar barra lateral' })).toBeInTheDocument();
  });

  it('no marca Clientes como actual en una ruta desconocida', () => {
    renderRoute('/no-existe');

    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Clientes',
      }),
    ).not.toHaveAttribute('aria-current');
  });

  it('colapsa y expande el Sidebar desde un botón en su encabezado, junto a la marca', async () => {
    const user = userEvent.setup();
    renderRoute('/clientes');

    const encabezado = screen
      .getByText('Realpolitik Manager')
      .closest('[data-slot="sidebar-header"]');
    const toggle = screen.getByRole('button', { name: 'Contraer barra lateral' });
    expect(encabezado).toContainElement(toggle);

    await user.click(toggle);
    // Colapsado, el botón cambia su nombre a la acción siguiente y la navegación sigue ahí.
    expect(screen.getByRole('button', { name: 'Expandir barra lateral' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Contraer barra lateral' }),
    ).not.toBeInTheDocument();
    expect(enlaceDelSidebar('Clientes')).toBeInTheDocument();
    expect(screen.getByText('Realpolitik Manager')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expandir barra lateral' }));
    expect(screen.getByRole('button', { name: 'Contraer barra lateral' })).toBeInTheDocument();
  });

  it('el botón del Sidebar es lo primero del recorrido con teclado y alterna con Enter sin perder el foco', async () => {
    const user = userEvent.setup();
    renderRoute('/clientes');

    await user.tab();
    const contraer = screen.getByRole('button', { name: 'Contraer barra lateral' });
    expect(contraer).toHaveFocus();
    await user.tab();
    expect(enlaceDelSidebar('Rendiciones')).toHaveFocus();

    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    const expandir = screen.getByRole('button', { name: 'Expandir barra lateral' });
    // Es el mismo botón (no se vuelve a montar): el foco sigue ahí al colapsar y al expandir.
    expect(expandir).toBe(contraer);
    expect(expandir).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Contraer barra lateral' })).toHaveFocus();
  });

  it('el botón del Sidebar tiene un tooltip que dice qué hace', async () => {
    const user = userEvent.setup();
    renderRoute('/clientes');

    await user.hover(screen.getByRole('button', { name: 'Contraer barra lateral' }));

    expect(
      await screen.findByText('Contraer barra lateral', {
        selector: '[data-slot="tooltip-content"]',
      }),
    ).toBeInTheDocument();
  });

  it('en mobile abre el menú con el teclado y un solo Escape lo cierra y devuelve el foco', async () => {
    mockMobileViewport();
    const user = userEvent.setup();
    renderRoute('/clientes');

    const toggle = screen.getByRole('button', { name: 'Alternar barra lateral' });
    // En mobile el panel es un cajón: el botón de colapsar del escritorio no existe.
    expect(screen.queryByRole('button', { name: /(Contraer|Expandir) barra lateral/ })).toBeNull();
    await user.tab();
    expect(toggle).toHaveFocus();

    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Navegación' });
    expect(within(drawer).getByRole('link', { name: 'Clientes' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});
