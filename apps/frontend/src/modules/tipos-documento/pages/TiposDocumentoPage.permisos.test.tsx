// El catálogo de tipos de documento según el rol (HU4.3). CONSULTA lo lee entero (nombres,
// descripciones, estados, con o sin desactivados) en escritorio y en celular, sin "Nuevo tipo",
// sin menús, sin columna "Acciones" y con el nombre como texto. ADMINISTRATIVO y ADMINISTRADOR
// conservan sus acciones.

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { CATALOGO_COMPACTO_QUERY } from '@/modules/tipos-documento/components/TiposDocumentoListado';
import { TiposDocumentoPage } from '@/modules/tipos-documento/pages/TiposDocumentoPage';

const fetchMock = vi.fn<typeof fetch>();

const fechas = { creadoEn: '2026-10-21T12:00:00.000Z', actualizadoEn: '2026-10-21T12:00:00.000Z' };
const factura = {
  id: '22222222-2222-4222-a222-222222222222',
  nombre: 'Factura',
  descripcion: null,
  activo: true,
  ...fechas,
};
const oc = {
  ...factura,
  id: '33333333-3333-4333-a333-333333333333',
  nombre: 'OC',
  descripcion: 'Orden de compra',
};
const print = {
  ...factura,
  id: '44444444-4444-4444-a444-444444444444',
  nombre: 'Print',
  activo: false,
};
const CATALOGO = [factura, oc, print];

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function simularServidor(catalogo: typeof CATALOGO) {
  fetchMock.mockImplementation((entrada, init) => {
    if ((init?.method ?? 'GET') !== 'GET')
      return Promise.resolve(new Response('{}', { status: 500 }));
    const incluir = new URL(urlDe(entrada)).searchParams.get('incluirInactivos') === 'true';
    return Promise.resolve(
      new Response(JSON.stringify(incluir ? catalogo : catalogo.filter((t) => t.activo)), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

function simularCelular() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string): MediaQueryList =>
      ({
        matches: query === CATALOGO_COMPACTO_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

function renderPage(rol: RolUsuarioType) {
  const router = createMemoryRouter([{ path: '/documentos', element: <TiposDocumentoPage /> }], {
    initialEntries: ['/documentos'],
  });
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

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

const sinPreparar = (): void => undefined;

describe.each([
  ['escritorio', sinPreparar],
  ['celular', simularCelular],
] as const)('TiposDocumentoPage con CONSULTA (%s)', (vista, preparar: () => void) => {
  it('lee nombres, descripciones y estados, y suma los desactivados, sin ninguna acción', async () => {
    preparar();
    simularServidor(CATALOGO);
    const { user } = renderPage('CONSULTA');

    expect(await screen.findByText('Factura')).toBeInTheDocument();
    expect(screen.getByText('Orden de compra')).toBeInTheDocument();
    expect(screen.queryByText('Print')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Incluir desactivados' }));
    expect(await screen.findByText('Print')).toBeInTheDocument();
    expect(screen.getAllByText('Desactivado').length).toBeGreaterThan(0);

    // El nombre es texto: no hay ningún botón (ni del nombre, ni ⋯, ni "Nuevo tipo").
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('OC').closest('[aria-haspopup]')).toBeNull();
    if (vista === 'escritorio') {
      expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
        'Tipo',
        'Estado',
      ]);
    }
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});

describe('TiposDocumentoPage con CONSULTA: vacíos', () => {
  it('sin ningún tipo, el aviso es neutro y sin botón', async () => {
    simularServidor([]);
    renderPage('CONSULTA');

    expect(
      await screen.findByRole('heading', {
        name: 'Todavía no hay tipos de documento registrados.',
      }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('con solo desactivados, deja verlos: es un filtro', async () => {
    simularServidor([print]);
    const { user } = renderPage('CONSULTA');

    await user.click(await screen.findByRole('button', { name: 'Ver desactivados' }));

    expect(await screen.findByText('Print')).toBeInTheDocument();
  });
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('TiposDocumentoPage con %s', (rol) => {
  it('conserva "Nuevo tipo", el nombre que edita y el menú con Editar y Desactivar', async () => {
    simularServidor(CATALOGO);
    const { user } = renderPage(rol);
    await screen.findByText('Factura');

    expect(screen.getByRole('button', { name: /Nuevo tipo/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Factura' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    expect(screen.getAllByRole('columnheader').at(-1)).toHaveTextContent('Acciones');
    await user.click(screen.getByRole('button', { name: 'Acciones de Factura' }));
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Editar',
      'Desactivar',
    ]);
  });

  it('sin ningún tipo, invita a crear el primero', async () => {
    simularServidor([]);
    renderPage(rol);

    expect(await screen.findByRole('button', { name: 'Crear el primer tipo' })).toBeInTheDocument();
  });
});
