import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '@/app/router';

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('router', () => {
  it('renderiza /clientes dentro del shell con su encabezado accesible', () => {
    renderRoute('/clientes');

    expect(screen.getByRole('banner')).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
  });

  it('redirige / a /clientes', async () => {
    const router = renderRoute('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/clientes');
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
