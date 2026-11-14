// La pantalla Rendiciones según el rol (HU4.3). Es de lectura para todos: CONSULTA cambia de mes,
// filtra, ve las atrasadas y abre el resumen y el detalle. Lo único que cambia es el mes vacío,
// que no le explica cómo abrir rendiciones.

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { RendicionesPage } from '@/modules/rendiciones/pages/RendicionesPage';

const fetchMock = vi.fn<typeof fetch>();
const HOY = new Date('2026-11-15T12:00:00-03:00');
const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION_ID = 'e1f2a3b4-c5d6-4789-8abc-000000000001';

const fila = (n: number, denominacion: string, extra: Record<string, unknown> = {}) => ({
  id: `e1f2a3b4-c5d6-4789-8abc-${String(n).padStart(12, '0')}`,
  clienteId: CLIENTE_ID,
  cliente: { denominacion, sector: 'PRIVADO', subtipo: null },
  numeroFactura: `B 00002-0000000${n}`,
  estado: 'EN_CURSO',
  avance: { reunidos: 1, total: 2, faltantes: 1 },
  ultimoPaso: null,
  atrasada: false,
  cobro: null,
  ...extra,
});

const NOVIEMBRE = [fila(1, 'Andina Logística'), fila(2, 'Grupo Solano', { estado: 'COMPLETA' })];
const OCTUBRE = [fila(3, 'Zeta Producciones')];
const ATRASADAS = [{ ...fila(4, 'Muni Vieja', { atrasada: true }), anio: 2026, mes: 8 }];

const TEXTO_OPERATIVO = 'Las rendiciones se abren desde la ficha de cada cliente.';
const TEXTO_NEUTRO = 'No hay rendiciones registradas para este período.';

function servir(porMes: Record<string, object[]>) {
  fetchMock.mockImplementation((entrada, init) => {
    if ((init?.method ?? 'GET') !== 'GET')
      return Promise.resolve(new Response('{}', { status: 500 }));
    const url = new URL(typeof entrada === 'string' ? entrada : (entrada as Request).url);
    const clave = `${url.searchParams.get('anio')}-${url.searchParams.get('mes')}`;
    const cuerpo = url.pathname === '/rendiciones/atrasadas' ? ATRASADAS : (porMes[clave] ?? []);
    return Promise.resolve(
      new Response(JSON.stringify(cuerpo), { headers: { 'Content-Type': 'application/json' } }),
    );
  });
}

function renderPantalla(rol: RolUsuarioType) {
  const router = createMemoryRouter(
    [
      { path: '/rendiciones', element: <RendicionesPage /> },
      { path: '/clientes', element: <h1>Clientes</h1> },
      { path: '/clientes/:id/rendiciones/:rendicionId', element: <h1>Detalle</h1> },
    ],
    { initialEntries: ['/rendiciones'] },
  );
  render(
    <QueryClientProvider
      client={sembrarSesion(new QueryClient({ defaultOptions: { queries: { retry: false } } }), {
        rol,
      })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const tarjeta = (titulo: string) =>
  within(screen.getByRole('group', { name: 'Resumen por estado' })).getByRole('button', {
    name: new RegExp(`^${titulo}`),
  });

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

describe('RendicionesPage con CONSULTA', () => {
  it('cambia de mes, filtra por estado y ve las atrasadas, solo con lecturas', async () => {
    servir({ '2026-11': NOVIEMBRE, '2026-10': OCTUBRE });
    const { router, user } = renderPantalla('CONSULTA');
    await screen.findByRole('list', { name: 'Rendiciones de Noviembre 2026' });

    await user.click(tarjeta('Completa'));
    expect(router.state.location.search).toContain('estado=COMPLETA');
    await user.click(tarjeta('Completa'));

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(
      await screen.findByRole('list', { name: 'Rendiciones de Octubre 2026' }),
    ).toBeInTheDocument();

    await user.click(tarjeta('Atrasadas'));
    expect(await screen.findByRole('list', { name: 'Rendiciones atrasadas' })).toBeInTheDocument();
    expect(screen.getByText('Muni Vieja')).toBeInTheDocument();

    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('abre el resumen de una rendición y desde ahí su detalle', async () => {
    servir({ '2026-11': NOVIEMBRE });
    const { router, user } = renderPantalla('CONSULTA');

    await user.click(await screen.findByRole('link', { name: /Andina Logística/ }));
    await screen.findByRole('region', { name: 'Resumen de la rendición de Andina Logística' });
    await user.click(await screen.findByRole('link', { name: 'Ir a la rendición' }));

    expect(router.state.location.pathname).toBe(
      `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
    );
  });

  it('el mes vacío no explica cómo abrir rendiciones y deja ir a Clientes', async () => {
    servir({});
    const { router, user } = renderPantalla('CONSULTA');

    expect(await screen.findByText('No hay rendiciones en Noviembre 2026')).toBeInTheDocument();
    expect(screen.getByText(TEXTO_NEUTRO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_OPERATIVO)).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Ir a Clientes' }));

    expect(router.state.location.pathname).toBe('/clientes');
  });
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('RendicionesPage con %s', (rol) => {
  it('el mes vacío conserva la explicación de dónde se abren', async () => {
    servir({});
    renderPantalla(rol);

    expect(await screen.findByText(TEXTO_OPERATIVO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_NEUTRO)).not.toBeInTheDocument();
  });
});
