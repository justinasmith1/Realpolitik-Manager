import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionesPage } from '@/modules/rendiciones/pages/RendicionesPage';

// Pantalla Rendiciones (HU3.2): el listado del mes elegido, con el mes en la URL.

const fetchMock = vi.fn<typeof fetch>();
// Mediados de noviembre de 2026 en Buenos Aires.
const HOY = new Date('2026-11-15T12:00:00-03:00');

const fila = (n: number, denominacion: string) => ({
  id: `e1f2a3b4-c5d6-4789-8abc-${String(n).padStart(12, '0')}`,
  clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  cliente: { denominacion, sector: 'PRIVADO', subtipo: null },
  numeroFactura: `B 00002-0000000${n}`,
  estado: 'EN_CURSO',
  avance: { reunidos: 1, total: 2, faltantes: 1 },
  ultimoPaso: null,
});

/** El backend simulado: el listado de cada mes, por `anio-mes`. */
function servir(porMes: Record<string, object[]>) {
  fetchMock.mockImplementation((entrada) => {
    const url = new URL(typeof entrada === 'string' ? entrada : (entrada as Request).url);
    const clave = `${url.searchParams.get('anio')}-${url.searchParams.get('mes')}`;
    return Promise.resolve(
      new Response(JSON.stringify(porMes[clave] ?? []), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderPantalla(url = '/rendiciones') {
  const router = createMemoryRouter(
    [
      { path: '/rendiciones', element: <RendicionesPage /> },
      { path: '/clientes', element: <h1>Clientes</h1> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const pedidos = () =>
  fetchMock.mock.calls.map(([entrada]) => {
    const url = new URL(typeof entrada === 'string' ? entrada : (entrada as Request).url);
    return `${url.pathname}${url.search}`;
  });
const mesVisible = () => within(screen.getByRole('group', { name: 'Mes' })).getByText(/\d{4}/);

describe('RendicionesPage (HU3.2)', () => {
  it('sin parámetros muestra el mes actual (Buenos Aires), con una fila por rendición', async () => {
    servir({ '2026-11': [fila(1, 'Muni Ejemplo'), fila(2, 'Muni Ejemplo')] });
    const { router } = renderPantalla();

    const lista = await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
    expect(mesVisible()).toHaveTextContent('Noviembre 2026');
    expect(pedidos()).toEqual(['/rendiciones?anio=2026&mes=11']);
    // El mes actual no se escribe en la URL.
    expect(router.state.location.search).toBe('');
  });

  it('debajo del título dice qué día es hoy y cuántas rendiciones hay en el mes', async () => {
    servir({
      '2026-11': [fila(1, 'Muni Ejemplo'), fila(2, 'Zeta')],
      '2025-12': [fila(3, 'Zeta')],
    });
    renderPantalla();

    expect(
      await screen.findByText('Hoy es domingo 15/11 · 2 rendiciones en noviembre'),
    ).toBeInTheDocument();

    // Un mes de otro año lo aclara, y "hoy" sigue siendo hoy.
    renderPantalla('/rendiciones?anio=2025&mes=12');
    expect(
      await screen.findByText('Hoy es domingo 15/11 · 1 rendición en diciembre de 2025'),
    ).toBeInTheDocument();
  });

  it('las filas van en una sola tarjeta, separadas por una línea', async () => {
    servir({ '2026-11': [fila(1, 'Muni Ejemplo'), fila(2, 'Zeta')] });
    renderPantalla();

    const lista = await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });
    expect(lista).toHaveClass('divide-y', 'rounded-card', 'border');
  });

  it('las flechas cambian de mes, lo guardan en la URL y piden ese mes', async () => {
    servir({ '2026-11': [fila(1, 'Muni Ejemplo')], '2026-10': [fila(2, 'Zeta')] });
    const { router, user } = renderPantalla();
    await screen.findByRole('link', { name: /Muni Ejemplo/ });

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));

    await waitFor(() => expect(router.state.location.search).toBe('?anio=2026&mes=10'));
    expect(mesVisible()).toHaveTextContent('Octubre 2026');
    expect(await screen.findByRole('link', { name: /Zeta/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Muni Ejemplo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    await waitFor(() => expect(router.state.location.search).toBe('?anio=2026&mes=12'));
    expect(mesVisible()).toHaveTextContent('Diciembre 2026');
  });

  it('las flechas cruzan de año', async () => {
    servir({});
    const { router, user } = renderPantalla('/rendiciones?anio=2026&mes=12');
    await screen.findByText('No hay rendiciones en Diciembre 2026');

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));

    await waitFor(() => expect(router.state.location.search).toBe('?anio=2027&mes=1'));
    expect(mesVisible()).toHaveTextContent('Enero 2027');
  });

  it('abrir la URL con un mes lo muestra y lo pide', async () => {
    servir({ '2026-3': [fila(1, 'Muni Ejemplo')] });
    renderPantalla('/rendiciones?anio=2026&mes=3');

    expect(
      await screen.findByRole('list', { name: 'Rendiciones de Marzo 2026' }),
    ).toBeInTheDocument();
    expect(pedidos()).toEqual(['/rendiciones?anio=2026&mes=3']);
  });

  it.each(['?anio=2026&mes=13', '?anio=abc&mes=3', '?anio=2026', '?anio=2026&mes=3&mes=4'])(
    'un mes inválido en la URL (%s) vuelve al mes actual y se quita',
    async (query) => {
      servir({ '2026-11': [fila(1, 'Muni Ejemplo')] });
      const { router } = renderPantalla(`/rendiciones${query}`);

      await waitFor(() => expect(router.state.location.search).toBe(''));
      expect(
        await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' }),
      ).toBeInTheDocument();
    },
  );

  it('sin rendiciones en el mes lo dice y ofrece ir a Clientes', async () => {
    servir({});
    const { router, user } = renderPantalla();

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ir a Clientes' }));

    expect(router.state.location.pathname).toBe('/clientes');
  });

  it('si la consulta falla lo avisa y deja reintentar', async () => {
    let fallar = true;
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fallar
          ? new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x' } }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const { user } = renderPantalla();

    expect(await screen.findByText('No pudimos cargar las rendiciones.')).toBeInTheDocument();
    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
  });

  it('no deja pasar de los años que admite una rendición (2020 a 2100)', async () => {
    servir({});
    renderPantalla('/rendiciones?anio=2020&mes=1');

    await screen.findByText('No hay rendiciones en Enero 2020');
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeEnabled();
  });
});
