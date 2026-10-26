import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

afterEach(() => {
  vi.restoreAllMocks();
});

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
  return router;
}

describe('router', () => {
  it('renderiza /clientes dentro del shell con su encabezado accesible', () => {
    renderRoute('/clientes');

    // En escritorio el shell es el Sidebar (navegación) y el contenido; el Header es solo mobile.
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
  });

  it('redirige / a /clientes', async () => {
    const router = renderRoute('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clientes');
  });

  it('sigue mostrando el catálogo de tipos en su ruta, no como matriz de un cliente', () => {
    renderRoute('/clientes/tipos-documento');

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Secciones de Clientes' })).getByRole('link', {
        name: 'Tipos de documento',
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Volver a clientes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Página no encontrada' })).not.toBeInTheDocument();
  });

  it('abre /clientes/:id/matriz dentro del shell y deja Clientes marcado en el sidebar', () => {
    renderRoute('/clientes/11111111-1111-4111-a111-111111111111/matriz');

    expect(screen.getByRole('link', { name: 'Volver a clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
    expect(screen.queryByRole('heading', { name: 'Página no encontrada' })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Clientes',
      }),
    ).toHaveAttribute('aria-current', 'page');
    const secciones = screen.getByRole('navigation', { name: 'Secciones de Clientes' });
    expect(within(secciones).getByRole('link', { name: 'Clientes' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(secciones).getByRole('link', { name: 'Tipos de documento' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('en mobile el header dice Matriz y no reemplaza al h1 de la página', () => {
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
    renderRoute('/clientes/11111111-1111-4111-a111-111111111111/matriz');

    const header = within(screen.getByRole('banner'));
    expect(header.getByText('Requisitos')).toBeInTheDocument();
    expect(header.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Requisitos');
  });

  it('muestra una página mínima, dentro del shell, para una ruta desconocida', () => {
    renderRoute('/no-existe');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Página no encontrada' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a Clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
  });
});
