import { act, render, screen, within } from '@testing-library/react';
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

  it('muestra el catálogo de tipos en /documentos, como sección propia y no como matriz de un cliente', () => {
    renderRoute('/documentos');

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Documentos' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Documentos',
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'Secciones de Clientes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Volver a clientes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Página no encontrada' })).not.toBeInTheDocument();
  });

  it('en /documentos la navegación secundaria marca Tipos de documento (HU2.8)', () => {
    renderRoute('/documentos');

    const secciones = screen.getByRole('navigation', { name: 'Secciones de Documentos' });
    expect(within(secciones).getByRole('link', { name: 'Tipos de documento' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(secciones).getByRole('link', { name: 'Archivos' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('abre el repositorio en /documentos/archivos, dentro de la sección Documentos', () => {
    renderRoute('/documentos/archivos');

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Documentos' })).toBeInTheDocument();
    const secciones = screen.getByRole('navigation', { name: 'Secciones de Documentos' });
    expect(within(secciones).getByRole('link', { name: 'Archivos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Documentos',
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Página no encontrada' })).not.toBeInTheDocument();
  });

  describe('la ruta vieja /clientes/tipos-documento', () => {
    it('redirige a /documentos', async () => {
      const router = renderRoute('/clientes/tipos-documento');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Documentos' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/documentos');
    });

    it('conserva la query string: ?desactivados=1 sigue incluyendo los desactivados', async () => {
      const router = renderRoute('/clientes/tipos-documento?desactivados=1');

      await screen.findByRole('heading', { level: 1, name: 'Documentos' });
      expect(router.state.location.pathname).toBe('/documentos');
      expect(router.state.location.search).toBe('?desactivados=1');
    });

    it('conserva varios parámetros, también los que la página no usa', async () => {
      const router = renderRoute('/clientes/tipos-documento?desactivados=1&otro=x');

      await screen.findByRole('heading', { level: 1, name: 'Documentos' });
      expect(router.state.location.search).toBe('?desactivados=1&otro=x');
    });

    it('reemplaza la entrada del historial: Atrás no vuelve a la ruta vieja', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/clientes'] });
      render(
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>,
      );
      await act(() => router.navigate('/clientes/tipos-documento'));
      await screen.findByRole('heading', { level: 1, name: 'Documentos' });
      expect(router.state.location.pathname).toBe('/documentos');

      await act(() => router.navigate(-1));

      expect(router.state.location.pathname).toBe('/clientes');
    });

    it('solo redirige la ruta exacta: una subruta sigue sin existir', () => {
      renderRoute('/clientes/tipos-documento/extra');

      expect(
        screen.getByRole('heading', { level: 1, name: 'Página no encontrada' }),
      ).toBeInTheDocument();
    });
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
    expect(within(secciones).getByRole('link', { name: 'Requisitos' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(secciones).queryByRole('link', { name: 'Tipos de documento' })).toBeNull();
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
