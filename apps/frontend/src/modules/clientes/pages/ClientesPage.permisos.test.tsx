// ClientesPage según el rol de la sesión (HU4.3). CONSULTA lee el listado, la ficha y los
// contactos, sin ninguna acción que escriba; ADMINISTRATIVO y ADMINISTRADOR conservan todo.
// La interfaz solo decide qué se muestra: el 403 de la API lo prueba el backend.

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { elegirOpcion } from '@/test/select';

const fetchMock = vi.fn<typeof fetch>();

const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };

const activo = {
  id: '11111111-1111-4111-a111-111111111111',
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
  ...fechas,
};

const inactivo = {
  ...activo,
  id: '33333333-3333-4333-a333-333333333333',
  razonSocial: 'Zeta Producciones S.A.',
  denominacion: 'Zeta',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  subtipo: undefined,
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'zeta@ejemplo.example',
  estado: 'INACTIVO',
};

const catalogo = [activo, inactivo];

const contactos = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    clienteId: activo.id,
    nombre: 'Ana Pérez',
    area: 'Tesorería',
    email: 'ana@ejemplo.example',
    recibeRendiciones: true,
  },
];

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** El backend simulado: solo lecturas. Cualquier otro método queda registrado y falla. */
function simularServidor(clientes: typeof catalogo = catalogo) {
  fetchMock.mockImplementation((entrada, init) => {
    const url = new URL(urlDe(entrada));
    if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json({}, 500));
    const ruta = url.pathname;
    if (ruta.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: 'Enviar en un solo PDF.' }));
    }
    if (ruta.endsWith('/observaciones')) {
      return Promise.resolve(json({ observaciones: 'Prefiere el correo de tesorería.' }));
    }
    if (ruta.endsWith('/contactos')) return Promise.resolve(json(contactos));
    const detalle = /^\/clientes\/([^/]+)$/.exec(ruta);
    if (detalle) {
      const cliente = clientes.find((c) => c.id === detalle[1]);
      return Promise.resolve(cliente ? json(cliente) : json({}, 404));
    }
    const sector = url.searchParams.get('sector');
    const q = url.searchParams.get('q')?.toLowerCase();
    return Promise.resolve(
      json(
        clientes.filter(
          (c) =>
            (sector === null || c.sector === sector) &&
            (q === undefined || c.razonSocial.toLowerCase().includes(q)),
        ),
      ),
    );
  });
}

/** Los métodos de todos los pedidos que hizo la página. */
const metodosPedidos = () => fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET');
const urlsPedidas = () => fetchMock.mock.calls.map(([entrada]) => urlDe(entrada));

function renderPage(rol: RolUsuarioType) {
  const queryClient = sembrarSesion(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    { rol },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/clientes']}>
        <ClientesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const botonDelMenu = (razonSocial: string) =>
  screen.getByRole('button', { name: `Acciones de ${razonSocial}` });

async function opcionesDelMenu(user: UserEvent, razonSocial: string) {
  await user.click(botonDelMenu(razonSocial));
  const menu = within(await screen.findByRole('menu'));
  return { menu, opciones: menu.getAllByRole('menuitem').map((item) => item.textContent) };
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  simularServidor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('ClientesPage con CONSULTA', () => {
  it('ve el listado, activos e inactivos, sin "Nuevo cliente"', async () => {
    renderPage('CONSULTA');

    expect(await screen.findByRole('table', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.getByText('Municipalidad de Ejemplo')).toBeInTheDocument();
    expect(screen.getByText('Zeta Producciones S.A.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nuevo cliente/ })).not.toBeInTheDocument();
    // El nombre sigue llevando a la matriz de requisitos.
    expect(screen.getByRole('link', { name: 'Municipalidad de Ejemplo' })).toHaveAttribute(
      'href',
      `/clientes/${activo.id}/matriz`,
    );
  });

  it('busca y filtra como cualquier rol', async () => {
    const { user } = renderPage('CONSULTA');
    await screen.findByRole('table');

    await elegirOpcion(user, screen.getByLabelText('Sector'), 'PRIVADO');
    await vi.waitFor(() => expect(screen.queryByText('Municipalidad de Ejemplo')).toBeNull());
    expect(urlsPedidas().at(-1)).toBe('https://api.example/clientes?sector=PRIVADO');

    await user.type(screen.getByLabelText('Buscar cliente'), 'zeta');
    await vi.waitFor(() => expect(urlsPedidas().at(-1)).toContain('q=zeta'));
    expect(screen.getByText('Zeta Producciones S.A.')).toBeInTheDocument();
  });

  it.each([
    ['activo', activo.razonSocial],
    ['inactivo', inactivo.razonSocial],
  ])(
    'el menú de un cliente %s ofrece solo lecturas: ficha, contactos y requisitos',
    async (_estado, razonSocial) => {
      const { user } = renderPage('CONSULTA');
      await screen.findByRole('table');

      const { menu, opciones } = await opcionesDelMenu(user, razonSocial);

      expect(opciones).toEqual(['Ver ficha', 'Ver contactos', 'Ver requisitos']);
      expect(menu.queryByRole('separator')).not.toBeInTheDocument();
    },
  );

  it('"Ver ficha" abre la ficha de solo lectura con los datos de la API', async () => {
    const { user } = renderPage('CONSULTA');
    await screen.findByRole('table');

    const { menu } = await opcionesDelMenu(user, activo.razonSocial);
    await user.click(menu.getByRole('menuitem', { name: 'Ver ficha' }));

    const ficha = within(
      await screen.findByRole('dialog', { name: `Ficha de ${activo.razonSocial}` }),
    );
    expect(await ficha.findByText(activo.cuit)).toBeInTheDocument();
    expect(await ficha.findByText('Enviar en un solo PDF.')).toBeInTheDocument();
    expect(await ficha.findByText('Prefiere el correo de tesorería.')).toBeInTheDocument();
    expect(urlsPedidas()).toContain(`https://api.example/clientes/${activo.id}`);
    expect(ficha.queryByRole('textbox')).not.toBeInTheDocument();
    expect(ficha.queryByRole('button', { name: /Guardar|Editar/ })).not.toBeInTheDocument();
  });

  it('"Ver contactos" abre la lista de solo lectura de ese cliente', async () => {
    const { user } = renderPage('CONSULTA');
    await screen.findByRole('table');

    const { menu } = await opcionesDelMenu(user, activo.razonSocial);
    await user.click(menu.getByRole('menuitem', { name: 'Ver contactos' }));

    const panel = within(
      await screen.findByRole('dialog', { name: `Contactos de ${activo.razonSocial}` }),
    );
    expect(await panel.findByText('Ana Pérez')).toBeInTheDocument();
    expect(urlsPedidas()).toContain(`https://api.example/clientes/${activo.id}/contactos`);
    expect(panel.queryByRole('textbox')).not.toBeInTheDocument();
    expect(panel.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('cerrar la ficha con Escape devuelve el foco al menú de la fila', async () => {
    const { user } = renderPage('CONSULTA');
    await screen.findByRole('table');

    const { menu } = await opcionesDelMenu(user, activo.razonSocial);
    await user.click(menu.getByRole('menuitem', { name: 'Ver ficha' }));
    await screen.findByRole('dialog', { name: `Ficha de ${activo.razonSocial}` });
    await user.keyboard('{Escape}');

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await vi.waitFor(() => expect(botonDelMenu(activo.razonSocial)).toHaveFocus());
  });

  it('sin ningún cliente, el vacío es neutro y no invita a registrar uno', async () => {
    simularServidor([]);
    renderPage('CONSULTA');

    expect(
      await screen.findByRole('heading', { name: 'Todavía no hay clientes cargados.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar|Nuevo cliente/ })).toBeNull();
  });

  it('con un filtro sin resultados ofrece limpiar los filtros (no escribe nada)', async () => {
    const { user } = renderPage('CONSULTA');
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Buscar cliente'), 'nadie');

    expect(
      await screen.findByRole('heading', { name: 'No hay clientes que coincidan' }),
    ).toBeInTheDocument();
    // El de la barra de filtros y el del aviso: ninguno escribe datos de negocio.
    expect(screen.getAllByRole('button', { name: 'Limpiar filtros' }).length).toBeGreaterThan(0);
  });

  it('nada de lo que hace en la pantalla manda una escritura', async () => {
    const { user } = renderPage('CONSULTA');
    await screen.findByRole('table');

    for (const opcion of ['Ver ficha', 'Ver contactos']) {
      const { menu } = await opcionesDelMenu(user, activo.razonSocial);
      await user.click(menu.getByRole('menuitem', { name: opcion }));
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    await elegirOpcion(user, screen.getByLabelText('Sector'), 'PUBLICO');

    expect(fetchMock).toHaveBeenCalled();
    expect(new Set(metodosPedidos())).toEqual(new Set(['GET']));
  });
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('ClientesPage con %s', (rol) => {
  it('conserva "Nuevo cliente" y las acciones de edición y de estado', async () => {
    const { user } = renderPage(rol);
    await screen.findByRole('table');

    expect(screen.getByRole('button', { name: /Nuevo cliente/ })).toBeInTheDocument();
    expect((await opcionesDelMenu(user, activo.razonSocial)).opciones).toEqual([
      'Editar',
      'Contactos',
      'Ver requisitos',
      'Desactivar',
    ]);
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect((await opcionesDelMenu(user, inactivo.razonSocial)).opciones).toEqual([
      'Editar',
      'Contactos',
      'Ver requisitos',
      'Reactivar',
    ]);
  });

  it('sin clientes conserva la invitación a registrar el primero', async () => {
    simularServidor([]);
    renderPage(rol);

    expect(
      await screen.findByRole('heading', { name: 'Todavía no cargaste clientes' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar el primer cliente' })).toBeInTheDocument();
  });
});
