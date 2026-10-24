import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';

const fetchMock = vi.fn<typeof fetch>();

const ID = '11111111-1111-4111-a111-111111111111';
const TIPO = '33333333-3333-4333-a333-333333333333';
const TIPO_INACTIVO = '44444444-4444-4444-a444-444444444444';
const REQ_A = '55555555-5555-4555-a555-555555555555';
const REQ_B = '66666666-6666-4666-a666-666666666666';

const fechas = {
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const clientePublico = {
  id: ID,
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
  estado: 'ACTIVO',
  matrizConfigurada: true,
  ...fechas,
};

const notaLarga = `${'Llevar tres copias firmadas. '.repeat(20).trim()} Fin.`;

const requisitoPrimero = {
  id: REQ_A,
  clienteId: ID,
  tipoDocumento: { id: TIPO, nombre: 'Zócalo', activo: true },
  cantidad: 3,
  diasAproximados: [15, 1, 8],
  canalEntrega: null,
  nota: null,
  ...fechas,
};

const requisitoSegundo = {
  id: REQ_B,
  clienteId: ID,
  tipoDocumento: { id: TIPO_INACTIVO, nombre: 'Acta', activo: false },
  cantidad: 100,
  diasAproximados: [],
  canalEntrega: 'WHATSAPP',
  nota: notaLarga,
  ...fechas,
};

const requisitos = [requisitoPrimero, requisitoSegundo];

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function servir(cliente: unknown, lista: unknown) {
  fetchMock.mockImplementation((entrada) => {
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/requisitos')) return Promise.resolve(json(lista));
    if (path === '/clientes') return Promise.resolve(json([cliente]));
    return Promise.resolve(json(cliente));
  });
}

function renderEn(entrada: string | { pathname: string; state?: unknown }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/clientes', element: <ClientesPage /> },
      { path: '/clientes/:id/matriz', element: <MatrizPage /> },
    ],
    { initialEntries: [entrada] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

function simularCompacto() {
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

const volver = () => screen.getByRole('link', { name: 'Volver a clientes' });

describe('MatrizPage: navegación', () => {
  it('desde el listado abre la matriz del cliente y al volver restaura la búsqueda real', async () => {
    const inactivo = { ...clientePublico, estado: 'INACTIVO', matrizConfigurada: false };
    servir(inactivo, [requisitoPrimero]);
    const { router, user } = renderEn('/clientes?estado=INACTIVO&q=muni&matrizConfigurada=false');

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Acciones de Municipalidad de Ejemplo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Matriz de requisitos' }));

    expect(router.state.location.pathname).toBe(`/clientes/${ID}/matriz`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Muni Ejemplo' }),
    ).toBeInTheDocument();

    await user.click(volver());

    expect(router.state.location.pathname).toBe('/clientes');
    expect(router.state.location.search).toBe('?estado=INACTIVO&q=muni&matrizConfigurada=false');
  });

  it('una entrada directa, o un state que no es una búsqueda, vuelve a /clientes', async () => {
    servir(clientePublico, []);
    const { user } = renderEn(`/clientes/${ID}/matriz`);

    expect(volver()).toHaveAttribute('href', '/clientes');
    await user.click(volver());
    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
  });

  it('no acepta una URL arbitraria como destino de vuelta', () => {
    servir(clientePublico, []);
    renderEn({
      pathname: `/clientes/${ID}/matriz`,
      state: { busquedaClientes: 'https://evil.test/robar', cliente: clientePublico },
    });

    expect(volver()).toHaveAttribute('href', '/clientes');
  });
});

describe('MatrizPage: cliente', () => {
  it('un UUID inválido no consulta y explica el enlace', async () => {
    renderEn('/clientes/no-es-uuid/matriz');

    const titulo = await screen.findByRole('heading', {
      level: 1,
      name: 'El enlace a esta matriz no es válido',
    });
    expect(titulo).toHaveFocus();
    expect(volver()).toHaveAttribute('href', '/clientes');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mientras carga muestra el esqueleto y no el vacío', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    renderEn(`/clientes/${ID}/matriz`);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Matriz de requisitos' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando la matriz');
    expect(screen.queryByText('Esta matriz todavía no tiene requisitos')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('un 404 del cliente no se muestra junto con un error de requisitos', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ error: { code: 'NOT_FOUND', message: 'No existe' } }, 404)),
    );
    renderEn(`/clientes/${ID}/matriz`);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este cliente ya no está disponible' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('No pudimos cargar los requisitos')).not.toBeInTheDocument();
    expect(screen.queryByText('Esta matriz todavía no tiene requisitos')).not.toBeInTheDocument();
  });

  it('un error de servidor del cliente se distingue y se puede reintentar', async () => {
    let intentos = 0;
    fetchMock.mockImplementation((entrada) => {
      const path = new URL(urlDe(entrada)).pathname;
      if (path.endsWith('/requisitos')) return Promise.resolve(json([]));
      intentos += 1;
      return intentos === 1
        ? Promise.resolve(json({ error: { code: 'INTERNAL_ERROR' } }, 500))
        : Promise.resolve(json(clientePublico));
    });
    const { user } = renderEn(`/clientes/${ID}/matriz`);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos cargar el cliente');
    expect(alerta).toHaveTextContent('Error del servidor');
    expect(within(alerta).getByText('HTTP_500')).toBeInTheDocument();
    expect(screen.queryByText('No pudimos cargar los requisitos')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Muni Ejemplo' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sin conexión muestra el diagnóstico de red y no la matriz', async () => {
    fetchMock.mockImplementation((entrada) => {
      const path = new URL(urlDe(entrada)).pathname;
      if (path.endsWith('/requisitos')) return Promise.resolve(json(requisitos));
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    renderEn(`/clientes/${ID}/matriz`);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Error de conexión');
    expect(within(alerta).getByText('NETWORK_ERROR')).toBeInTheDocument();
    expect(screen.queryByText('Zócalo')).not.toBeInTheDocument();
  });

  it('sin la dirección del servidor es un error de configuración y no llama a la red', async () => {
    vi.stubEnv('VITE_API_URL', '');
    renderEn(`/clientes/${ID}/matriz`);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Error de configuración');
    expect(within(alerta).getByText('CONFIG_ERROR')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un cliente activo muestra su identidad y que la matriz tiene requisitos', async () => {
    servir(clientePublico, requisitos);
    renderEn(`/clientes/${ID}/matriz`);

    const titulo = await screen.findByRole('heading', { level: 1, name: 'Muni Ejemplo' });
    expect(titulo).toHaveFocus();
    expect(screen.getByText('Municipalidad de Ejemplo')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Público')).toBeInTheDocument();
    expect(screen.getByText('Municipio')).toBeInTheDocument();
    expect(screen.getByText('Canal habitual')).toBeInTheDocument();
    expect(screen.getAllByText('Correo')).toHaveLength(2);
    expect(screen.getByText('Periodicidad')).toBeInTheDocument();
    expect(screen.getByText('Mensual')).toBeInTheDocument();
    expect(screen.getByText('Con requisitos')).toBeInTheDocument();
    expect(screen.queryByText('Sin requisitos configurados')).not.toBeInTheDocument();
    expect(screen.queryByText(/matriz completa/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Este cliente debe estar activo para modificar su matriz.'),
    ).not.toBeInTheDocument();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    'un cliente %s se puede leer y avisa que no se puede modificar',
    async (estado) => {
      servir({ ...clientePublico, estado }, requisitos);
      renderEn(`/clientes/${ID}/matriz`);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Muni Ejemplo' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Este cliente debe estar activo para modificar su matriz.',
      );
      expect(screen.getByText('Zócalo')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /agregar|quitar|editar requisito/i })).toBeNull();
    },
  );
});

describe('MatrizPage: requisitos', () => {
  it('lista los requisitos en el orden recibido, sin tratar los días como fechas', async () => {
    servir(clientePublico, requisitos);
    renderEn(`/clientes/${ID}/matriz`);

    const tabla = await screen.findByRole('table', { name: 'Requisitos de Muni Ejemplo' });
    const filas = within(tabla).getAllByRole('row');
    expect(within(filas[1] as HTMLElement).getByRole('rowheader')).toHaveTextContent('Zócalo');
    expect(within(filas[2] as HTMLElement).getByRole('rowheader')).toHaveTextContent('Acta');
    expect(within(filas[2] as HTMLElement).getByText('Desactivado')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).queryByText('Desactivado')).not.toBeInTheDocument();
    expect(screen.getByText('Cantidad: 3')).toBeInTheDocument();
    expect(screen.getByText('Cantidad: 100')).toBeInTheDocument();
    expect(screen.getByText('15, 1, 8')).toBeInTheDocument();
    expect(screen.queryByText('1, 8, 15')).not.toBeInTheDocument();
    expect(screen.getByText('Sin días aproximados')).toBeInTheDocument();
    expect(screen.getByText('Canal heredado')).toBeInTheDocument();
    expect(screen.getByText('Canal de este requisito')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Sin nota')).toBeInTheDocument();
    expect(screen.queryByText(/por mes|por rendición/i)).not.toBeInTheDocument();
    expect(
      within(tabla)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Documento', 'Cantidad', 'Días', 'Canal', 'Nota', 'Acciones']);
  });

  it('una nota larga se lee en la tabla sin quedar solo en title', async () => {
    servir(clientePublico, [requisitoSegundo]);
    const { user } = renderEn(`/clientes/${ID}/matriz`);

    const resumen = await screen.findByText('Mostrar nota completa');
    const details = resumen.closest('details');
    const summary = resumen.closest('summary');
    expect(details).toHaveTextContent(notaLarga);
    expect(details?.querySelector('[title]')).toBeNull();

    summary?.focus();
    expect(summary).toHaveFocus();
    await user.click(resumen);
    expect(details).toHaveAttribute('open');
  });

  it('sin requisitos es un vacío, no un error, y no inventa la factura', async () => {
    servir({ ...clientePublico, matrizConfigurada: false }, []);
    renderEn(`/clientes/${ID}/matriz`);

    expect(
      await screen.findByRole('heading', { name: 'Esta matriz todavía no tiene requisitos' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin requisitos configurados')).toBeInTheDocument();
    expect(
      screen.getByText('La factura también se configura como un requisito. No se agrega sola.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Factura')).not.toBeInTheDocument();
  });

  it('un fallo al cargar los requisitos no se muestra como lista vacía', async () => {
    let intentos = 0;
    fetchMock.mockImplementation((entrada) => {
      const path = new URL(urlDe(entrada)).pathname;
      if (!path.endsWith('/requisitos')) return Promise.resolve(json(clientePublico));
      intentos += 1;
      return intentos === 1
        ? Promise.resolve(json({ error: { code: 'INTERNAL_ERROR' } }, 500))
        : Promise.resolve(json(requisitos));
    });
    const { user } = renderEn(`/clientes/${ID}/matriz`);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos cargar los requisitos');
    expect(alerta).toHaveTextContent('Error del servidor');
    expect(screen.getByRole('heading', { level: 1, name: 'Muni Ejemplo' })).toBeInTheDocument();
    expect(screen.queryByText('Esta matriz todavía no tiene requisitos')).not.toBeInTheDocument();

    await user.click(within(alerta).getByRole('button', { name: 'Reintentar' }));

    expect(
      await screen.findByRole('table', { name: 'Requisitos de Muni Ejemplo' }),
    ).toBeInTheDocument();
  });

  it('en compacto son tarjetas y la nota larga se lee sin hover', async () => {
    simularCompacto();
    servir(
      {
        ...clientePublico,
        sector: 'PRIVADO',
        subtipo: undefined,
        denominacion: 'Zeta',
        razonSocial: 'Zeta',
        periodicidad: null,
      },
      [requisitoSegundo],
    );
    renderEn(`/clientes/${ID}/matriz`);

    const lista = await screen.findByRole('list', { name: 'Requisitos de Zeta' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(within(lista).getByRole('heading', { level: 2, name: /Acta/ })).toHaveTextContent(
      'Desactivado',
    );
    expect(screen.getByText(/Llevar tres copias firmadas/)).toHaveTextContent(notaLarga);
    expect(screen.queryByText('Mostrar nota completa')).not.toBeInTheDocument();
    expect(screen.getAllByText('Zeta')).toHaveLength(1);
    expect(screen.queryByText('Periodicidad')).not.toBeInTheDocument();
    expect(screen.queryByText('Municipio')).not.toBeInTheDocument();
  });
});
