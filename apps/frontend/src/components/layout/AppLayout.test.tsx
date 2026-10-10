import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders } from '@/app/providers';
import { routes } from '@/app/router';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppLayout', () => {
  it('muestra Realpolitik Manager como identidad del producto', () => {
    renderRoute('/clientes');

    expect(screen.getByText('Realpolitik Manager')).toBeInTheDocument();
  });

  it('ofrece Clientes como único destino de navegación y lo marca como página actual', () => {
    renderRoute('/clientes');

    const nav = screen.getByRole('navigation', { name: 'Principal' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Clientes');
    expect(links[0]).toHaveAttribute('href', '/clientes');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
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
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveFocus();

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
