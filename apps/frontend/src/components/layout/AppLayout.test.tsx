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

  it('indica en el Header la sección actual', () => {
    renderRoute('/clientes');

    expect(within(screen.getByRole('banner')).getByText('Clientes')).toBeInTheDocument();
  });

  it('no marca Clientes como actual en una ruta desconocida', () => {
    renderRoute('/no-existe');

    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Clientes',
      }),
    ).not.toHaveAttribute('aria-current');
  });

  it('colapsa y expande el Sidebar con el botón accesible, sin perder la navegación', async () => {
    const user = userEvent.setup();
    renderRoute('/clientes');

    const toggle = screen.getByRole('button', { name: 'Alternar barra lateral' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.getByText('Realpolitik Manager')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('permite alcanzar el botón del Sidebar y el enlace con el teclado', async () => {
    const user = userEvent.setup();
    renderRoute('/clientes');

    await user.tab();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Alternar barra lateral' })).toHaveFocus();
  });

  it('en mobile abre el menú con el teclado y un solo Escape lo cierra y devuelve el foco', async () => {
    mockMobileViewport();
    const user = userEvent.setup();
    renderRoute('/clientes');

    const toggle = screen.getByRole('button', { name: 'Alternar barra lateral' });
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
