import { ClienteSchema } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';
import { stateDeListado } from '@/modules/clientes/matriz.navegacion';
import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';

// El nombre de cada cliente del listado abre su pantalla (`/clientes/:id/matriz`), con los filtros
// de la URL en el `state` para que "Volver a clientes" los conserve. El menú ⋯ sigue aparte.

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };
const comunes = {
  ivaCondicion: 'EXENTO',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  ...fechas,
};
const municipal = {
  ...comunes,
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  emailContacto: 'muni@ejemplo.example',
};
const privado = {
  ...comunes,
  id: '33333333-3333-4333-a333-333333333333',
  razonSocial: 'Zeta Producciones S.A.',
  denominacion: 'Zeta',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'zeta@ejemplo.example',
};
const catalogo = [municipal, privado];

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

/** El listado y lo que pide la pantalla del cliente. */
function simularServidor() {
  fetchMock.mockImplementation((entrada) => {
    const { pathname } = new URL(urlDe(entrada));
    if (pathname === '/clientes') return Promise.resolve(json(catalogo));
    if (pathname === `/clientes/${municipal.id}`) return Promise.resolve(json(municipal));
    if (pathname.endsWith('/observaciones')) return Promise.resolve(json({ observaciones: null }));
    if (pathname.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    return Promise.resolve(json([]));
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  simularServidor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

/** Muestra dónde está el router, para comprobar la ruta y el `state` de cada navegación. */
function Ubicacion() {
  const location = useLocation();
  return (
    <output data-testid="ubicacion" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}`}
    </output>
  );
}

const FILTROS = '?q=Muni&sector=PUBLICO';

function renderApp(url = `/clientes${FILTROS}`) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/clientes" element={<ClientesPage />} />
          <Route path="/clientes/:id/matriz" element={<MatrizPage />} />
        </Routes>
        <Ubicacion />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const ubicacion = () => screen.getByTestId('ubicacion');
const stateActual = () => JSON.parse(ubicacion().dataset.state ?? 'null') as unknown;
const enlaceDe = (razonSocial: string) => screen.getByRole('link', { name: razonSocial });
const RUTA_MUNICIPAL = `/clientes/${municipal.id}/matriz`;

function simularViewportCompacto() {
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

/** Avanza con Tab hasta el elemento (como lo haría alguien con el teclado). */
async function tabularHasta(user: UserEvent, destino: HTMLElement) {
  for (let i = 0; i < 60 && document.activeElement !== destino; i++) {
    await user.tab();
  }
  expect(destino).toHaveFocus();
}

describe('ClientesPage: el nombre del cliente abre su pantalla', () => {
  it('el nombre es un enlace a la pantalla del cliente', async () => {
    renderApp();

    await screen.findByRole('table');
    const fila = within(screen.getByRole('row', { name: /Municipalidad de Ejemplo/ }));
    expect(fila.getByRole('link', { name: 'Municipalidad de Ejemplo' })).toHaveAttribute(
      'href',
      RUTA_MUNICIPAL,
    );
    // Un solo enlace por fila: el de su nombre.
    expect(fila.getAllByRole('link')).toHaveLength(1);
  });

  it('el enlace se estira solo sobre la celda del nombre, no sobre el resto de la fila', async () => {
    renderApp();

    await screen.findByRole('table');
    const enlace = enlaceDe('Municipalidad de Ejemplo');
    const celdaNombre = screen.getByRole('rowheader', { name: /Municipalidad de Ejemplo/ });
    const fila = enlace.closest('tr');
    // El `after:absolute` del enlace toma como referencia la celda: la fila no está posicionada.
    expect(enlace.parentElement).toBe(celdaNombre);
    expect(celdaNombre).toHaveClass('relative', 'cursor-pointer');
    expect(fila).not.toHaveClass('relative');
    expect(fila).not.toHaveClass('cursor-pointer');

    // El CUIT y el email quedan fuera del enlace y de su celda: se pueden seleccionar y copiar.
    for (const dato of [municipal.cuit, municipal.emailContacto]) {
      const celda = within(fila as HTMLElement)
        .getByText(dato)
        .closest('td');
      expect(celda).not.toBeNull();
      expect(enlace).not.toContainElement(celda);
      expect(celdaNombre).not.toContainElement(celda);
      expect(celda?.querySelector('a')).toBeNull();
    }
  });

  it('tocar el nombre navega con los filtros de la URL en el state', async () => {
    const user = renderApp();

    await user.click(await screen.findByRole('link', { name: 'Municipalidad de Ejemplo' }));

    expect(ubicacion()).toHaveTextContent(RUTA_MUNICIPAL);
    expect(stateActual()).toEqual(stateDeListado(FILTROS));
  });

  it('el menú ⋯ de la fila no navega', async () => {
    const user = renderApp();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Acciones de Municipalidad de Ejemplo' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(ubicacion()).toHaveTextContent(`/clientes${FILTROS}`);
  });

  it('"Ver requisitos" del menú sigue llevando a la misma pantalla, con el mismo state', async () => {
    const user = renderApp();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Acciones de Municipalidad de Ejemplo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ver requisitos' }));

    expect(ubicacion()).toHaveTextContent(RUTA_MUNICIPAL);
    expect(stateActual()).toEqual(stateDeListado(FILTROS));
  });

  it('se llega con Tab y se abre con Enter', async () => {
    const user = renderApp();
    await screen.findByRole('table');

    await tabularHasta(user, enlaceDe('Municipalidad de Ejemplo'));
    await user.keyboard('{Enter}');

    expect(ubicacion()).toHaveTextContent(RUTA_MUNICIPAL);
    expect(stateActual()).toEqual(stateDeListado(FILTROS));
  });

  it('"Volver a clientes" vuelve al listado con los mismos filtros', async () => {
    const user = renderApp();

    await user.click(await screen.findByRole('link', { name: 'Municipalidad de Ejemplo' }));
    await user.click(await screen.findByRole('link', { name: 'Volver a clientes' }));

    expect(ubicacion()).toHaveTextContent(`/clientes${FILTROS}`);
    expect(await screen.findByLabelText('Buscar cliente')).toHaveValue('Muni');
  });

  it('en la vista compacta, el nombre de la tarjeta también abre la pantalla y el menú no navega', async () => {
    simularViewportCompacto();
    const user = renderApp();

    const tarjetas = await screen.findByRole('list', { name: 'Clientes' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      within(tarjetas).getByRole('link', { name: 'Municipalidad de Ejemplo' }),
    ).toHaveAttribute('href', RUTA_MUNICIPAL);

    await user.click(screen.getByRole('button', { name: 'Acciones de Municipalidad de Ejemplo' }));
    await user.keyboard('{Escape}');
    expect(ubicacion()).toHaveTextContent(`/clientes${FILTROS}`);

    await user.click(within(tarjetas).getByRole('link', { name: 'Municipalidad de Ejemplo' }));
    expect(ubicacion()).toHaveTextContent(RUTA_MUNICIPAL);
    expect(stateActual()).toEqual(stateDeListado(FILTROS));
  });
});

describe('ClientesTabla: el enlace no depende de las columnas visibles', () => {
  const clientes = catalogo.map((c) => ClienteSchema.parse(c));
  const enlaceDeCliente = (cliente: (typeof clientes)[number]) => ({
    to: `/clientes/${cliente.id}/matriz`,
    state: stateDeListado(''),
  });

  it.each([[[]], [['cuit', 'email', 'canal']]] as const)(
    'con las columnas %j, cada nombre es un enlace',
    (columnasVisibles) => {
      render(
        <MemoryRouter>
          <ClientesTabla
            clientes={clientes}
            columnasVisibles={columnasVisibles}
            onLimpiarFiltros={() => undefined}
            enlaceDe={enlaceDeCliente}
          />
        </MemoryRouter>,
      );

      expect(enlaceDe('Zeta Producciones S.A.')).toHaveAttribute(
        'href',
        `/clientes/${privado.id}/matriz`,
      );
      expect(screen.getAllByRole('link')).toHaveLength(clientes.length);
    },
  );

  it('sin enlaceDe, el nombre es texto (no hace falta un router)', () => {
    render(
      <ClientesTabla
        clientes={clientes}
        columnasVisibles={[]}
        onLimpiarFiltros={() => undefined}
      />,
    );

    expect(screen.getByText('Zeta Producciones S.A.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
