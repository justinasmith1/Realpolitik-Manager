import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

// El `fetch` del setup, que no sale a la red: lo que este archivo no simula pasa por ahí y hace
// fallar el test con la URL pedida.
const fetchSinSimular = globalThis.fetch;

const CLIENTE_DE_LA_MATRIZ = '11111111-1111-4111-a111-111111111111';

// Las páginas reales piden sus datos al montarse. Estos tests son sobre las rutas, no sobre los
// datos: el backend simulado responde los listados vacíos y el cliente de la matriz.
const LISTADOS_VACIOS = [
  /^\/clientes$/,
  /^\/rendiciones$/,
  /^\/rendiciones\/atrasadas$/,
  /^\/tipos-documento$/,
  /^\/documentos$/,
  /^\/clientes\/[^/]+\/(requisitos|rendiciones)$/,
];

const clienteDeLaMatriz = {
  id: CLIENTE_DE_LA_MATRIZ,
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const json = (cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const fetchMock = vi.fn<typeof fetch>((entrada, init) => {
  const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
  if ((init?.method ?? 'GET') === 'GET') {
    if (LISTADOS_VACIOS.some((ruta) => ruta.test(url.pathname))) {
      return Promise.resolve(json([]));
    }
    if (url.pathname === `/clientes/${CLIENTE_DE_LA_MATRIZ}`) {
      return Promise.resolve(json(clienteDeLaMatriz));
    }
  }
  return fetchSinSimular(entrada, init);
});

// Simulado para todo el archivo, no por test: las páginas son lazy y, en un test sincrónico,
// terminan de montarse (y piden sus datos) después de que el test terminó. Si el mock se quitara
// en cada `afterEach`, ese pedido tardío caería en el test siguiente como "no simulado".
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

  it('redirige / a /rendiciones, la pantalla de entrada (HU3.2)', async () => {
    const router = renderRoute('/');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rendiciones' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/rendiciones');
    expect(
      within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', {
        name: 'Rendiciones',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('muestra el catálogo de tipos en /documentos/tipos, dentro de Documentos y no como matriz de un cliente', () => {
    renderRoute('/documentos/tipos');

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

  it('en /documentos/tipos la navegación secundaria marca Tipos de documento (HU2.8)', () => {
    renderRoute('/documentos/tipos');

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

  describe('/documentos abre el repositorio', () => {
    it('redirige a /documentos/archivos, con Archivos marcado', async () => {
      const router = renderRoute('/documentos');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Documentos' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/documentos/archivos');
      const secciones = screen.getByRole('navigation', { name: 'Secciones de Documentos' });
      expect(within(secciones).getByRole('link', { name: 'Archivos' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('conserva la query string: el período y el tipo de la URL siguen filtrando', async () => {
      // `tipo` tiene que ser un uuid: el repositorio descarta de la URL uno inválido.
      const query = '?anio=2026&mes=9&tipo=00000000-0000-4000-8000-000000000001';
      const router = renderRoute(`/documentos${query}`);

      await screen.findByRole('heading', { level: 1, name: 'Documentos' });
      expect(router.state.location.pathname).toBe('/documentos/archivos');
      expect(router.state.location.search).toBe(query);
    });

    it('reemplaza la entrada del historial: Atrás no vuelve a /documentos', async () => {
      const router = createMemoryRouter(routes, { initialEntries: ['/clientes'] });
      render(
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>,
      );
      await act(() => router.navigate('/documentos'));
      await screen.findByRole('heading', { level: 1, name: 'Documentos' });
      expect(router.state.location.pathname).toBe('/documentos/archivos');

      await act(() => router.navigate(-1));

      expect(router.state.location.pathname).toBe('/clientes');
    });
  });

  describe('la ruta vieja /clientes/tipos-documento', () => {
    it('redirige al catálogo, /documentos/tipos', async () => {
      const router = renderRoute('/clientes/tipos-documento');

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Documentos' }),
      ).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/documentos/tipos');
    });

    it('conserva la query string: ?desactivados=1 sigue incluyendo los desactivados', async () => {
      const router = renderRoute('/clientes/tipos-documento?desactivados=1');

      await screen.findByRole('heading', { level: 1, name: 'Documentos' });
      expect(router.state.location.pathname).toBe('/documentos/tipos');
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
      expect(router.state.location.pathname).toBe('/documentos/tipos');

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
