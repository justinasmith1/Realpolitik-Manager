import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';

const fetchMock = vi.fn<typeof fetch>();

function renderPage(url = '/clientes') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <ClientesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, user: userEvent.setup() };
}

// ─── Datos ficticios ──────────────────────────────────────────────────────────

const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };
const comunes = { ivaCondicion: 'EXENTO', emailsAdicionales: [], estado: 'ACTIVO', ...fechas };

const clienteMunicipal = {
  ...comunes,
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  emailContacto: 'muni@ejemplo.example',
};

const clienteProvincial = {
  ...comunes,
  id: '22222222-2222-4222-a222-222222222222',
  razonSocial: 'Ministerio de Ejemplo',
  denominacion: 'Min Ejemplo',
  cuit: '30-62494418-2',
  sector: 'PUBLICO',
  subtipo: 'PROVINCIAL_ORGANISMO',
  emailContacto: 'min@ejemplo.example',
};

const clientePrivado = {
  ...comunes,
  id: '33333333-3333-4333-a333-333333333333',
  razonSocial: 'Zeta Producciones S.A.',
  denominacion: 'Zeta',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'zeta@ejemplo.example',
};

const catalogo = [clienteMunicipal, clienteProvincial, clientePrivado];

type ClienteJson = (typeof catalogo)[number];

/** URL de un pedido de fetch, venga como texto, URL o Request. */
const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const respuesta201 = () =>
  json(
    {
      id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
      razonSocial: 'Empresa de Ejemplo S.A.',
      denominacion: 'Empresa Ejemplo',
      cuit: '20-12345678-6',
      sector: 'PRIVADO',
      ivaCondicion: 'RESPONSABLE_INSCRIPTO',
      emailContacto: 'admin@empresa.example',
      emailsAdicionales: [],
      estado: 'ACTIVO',
      ...fechas,
    },
    201,
  );

/** Hace lo que haría el backend con los filtros del GET, para poder probar la UI de punta a punta. */
function listadoSegunQuery(url: string, clientes: ClienteJson[]) {
  const query = new URL(url).searchParams;
  const q = query.get('q')?.toLowerCase();
  const digitos = q?.replace(/\D/g, '');
  return clientes.filter((c) => {
    if (query.has('sector') && c.sector !== query.get('sector')) return false;
    if (query.has('subtipo') && !('subtipo' in c && c.subtipo === query.get('subtipo'))) {
      return false;
    }
    if (q === undefined) return true;
    return (
      c.razonSocial.toLowerCase().includes(q) ||
      c.denominacion.toLowerCase().includes(q) ||
      (digitos !== '' && c.cuit.replace(/-/g, '').includes(digitos ?? ''))
    );
  });
}

/** Servidor simulado: GET filtra el catálogo, POST crea. */
function simularServidor(clientes: ClienteJson[] = catalogo) {
  fetchMock.mockImplementation((entrada, init) => {
    if (init?.method === 'POST') return Promise.resolve(respuesta201());
    return Promise.resolve(json(listadoSegunQuery(urlDe(entrada), clientes)));
  });
}

const urlsPedidas = () => fetchMock.mock.calls.map(([url]) => urlDe(url));
const llamadasPost = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const ultimaUrl = () => urlsPedidas().at(-1) ?? '';

// ─── Utilidades de la UI ──────────────────────────────────────────────────────

const emptyHeading = () => screen.queryByRole('heading', { name: 'Todavía no cargaste clientes' });
const panelDeAlta = () => screen.queryByRole('dialog', { name: 'Nuevo cliente' });
const filaDe = (razonSocial: string) => screen.getByRole('row', { name: new RegExp(razonSocial) });

const camposDelAlta = [
  'Razón social',
  'Denominación',
  'CUIT',
  'Sector',
  'Condición frente al IVA',
  'Email de contacto',
];

/** Completa el panel abierto con un alta privada válida. */
async function completarAltaValida(user: UserEvent) {
  const dialog = panelDeAlta();
  const q = dialog ? within(dialog) : screen;
  await user.type(q.getByLabelText('Razón social'), 'Empresa de Ejemplo S.A.');
  await user.type(q.getByLabelText('Denominación'), 'Empresa Ejemplo');
  await user.type(q.getByLabelText('CUIT'), '20-12345678-6');
  await user.selectOptions(q.getByLabelText('Sector'), 'PRIVADO');
  await user.selectOptions(q.getByLabelText('Condición frente al IVA'), 'RESPONSABLE_INSCRIPTO');
  await user.type(q.getByLabelText('Email de contacto'), 'admin@empresa.example');
}

/** El panel recién abierto: todos los campos vacíos y ninguno marcado con error. */
function expectFormularioLimpio() {
  const dialog = panelDeAlta();
  const q = dialog ? within(dialog) : screen;
  for (const etiqueta of camposDelAlta) {
    const control = q.getByLabelText(etiqueta);
    expect(control).toHaveValue('');
    expect(control).not.toHaveAttribute('aria-invalid');
  }
  expect(q.queryByLabelText('Subtipo público')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  simularServidor([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

// ─── Estados de la consulta ───────────────────────────────────────────────────

describe('ClientesPage: estados del listado', () => {
  it('mientras carga muestra el esqueleto, nunca el estado vacío ni "sin resultados"', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando clientes');
    expect(emptyHeading()).not.toBeInTheDocument();
    expect(screen.queryByText('No hay clientes que coincidan')).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('sin ningún cliente muestra el estado vacío y no los filtros', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Todavía no cargaste clientes' }),
    ).toBeVisible();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('si falla, muestra el error con su diagnóstico y permite reintentar', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'INTERNAL_ERROR' } }, 500));
    simularServidorTrasElPrimerPedido();
    const { user } = renderPage();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos cargar los clientes');
    expect(within(alerta).getByText('HTTP_500')).toBeInTheDocument();
    expect(emptyHeading()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('si no hay conexión, el diagnóstico es NETWORK_ERROR', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    renderPage();

    expect(await screen.findByText('NETWORK_ERROR')).toBeInTheDocument();
  });

  it('no queda ningún rastro del preview ?estado=', async () => {
    renderPage('/clientes?estado=error');

    expect(
      await screen.findByRole('heading', { name: 'Todavía no cargaste clientes' }),
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

function simularServidorTrasElPrimerPedido() {
  fetchMock.mockImplementation((entrada) =>
    Promise.resolve(json(listadoSegunQuery(urlDe(entrada), catalogo))),
  );
}

// ─── Tabla y badges ───────────────────────────────────────────────────────────

describe('ClientesPage: tabla', () => {
  beforeEach(() => simularServidor());

  it('muestra solo las columnas Razón social, Denominación, CUIT, Sector y Subtipo', async () => {
    renderPage();

    const tabla = await screen.findByRole('table');
    const encabezados = within(tabla)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(encabezados).toEqual(['Razón social', 'Denominación', 'CUIT', 'Sector', 'Subtipo']);
  });

  it('lista todos los clientes que trae la API, con razón social y denominación en columnas propias', async () => {
    renderPage();

    await screen.findByRole('table');
    expect(urlsPedidas()).toEqual(['https://api.example/clientes']);
    const fila = filaDe('Municipalidad de Ejemplo');
    const celdas = within(fila).getAllByRole('cell');
    expect(within(fila).getByRole('rowheader')).toHaveTextContent('Municipalidad de Ejemplo');
    expect(celdas[0]).toHaveTextContent('Muni Ejemplo');
    expect(celdas[1]).toHaveTextContent('30-50001274-5');
    expect(screen.getAllByRole('row')).toHaveLength(1 + catalogo.length);
    expect(screen.getByText('3 clientes')).toBeInTheDocument();
  });

  it('cada sector y subtipo se muestra con su texto; los privados no tienen subtipo', async () => {
    renderPage();

    await screen.findByRole('table');
    const publico = within(filaDe('Municipalidad de Ejemplo'));
    expect(publico.getByText('Público')).toBeVisible();
    expect(publico.getByText('Municipio')).toBeVisible();
    const provincial = within(filaDe('Ministerio de Ejemplo'));
    expect(provincial.getByText('Provincial u organismo público')).toBeVisible();
    const privado = within(filaDe('Zeta Producciones'));
    expect(privado.getByText('Privado')).toBeVisible();
    expect(privado.getByLabelText('Sin subtipo')).toBeVisible();
  });
});

// ─── Filtros y búsqueda ───────────────────────────────────────────────────────

describe('ClientesPage: filtros por sector y subtipo (HU1.2)', () => {
  beforeEach(() => simularServidor());

  it('filtrar por sector pide la lista filtrada y muestra solo esa clasificación', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Sector'), 'PRIVADO');

    await vi.waitFor(() => expect(screen.queryByText('Municipalidad de Ejemplo')).toBeNull());
    expect(ultimaUrl()).toBe('https://api.example/clientes?sector=PRIVADO');
    expect(screen.getByText('Zeta Producciones S.A.')).toBeInTheDocument();
    expect(screen.getByText('1 cliente')).toBeInTheDocument();
  });

  it('filtrar por subtipo muestra solo los clientes de ese subtipo', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Subtipo'), 'MUNICIPAL');

    await vi.waitFor(() => expect(screen.queryByText('Ministerio de Ejemplo')).toBeNull());
    expect(ultimaUrl()).toBe('https://api.example/clientes?subtipo=MUNICIPAL');
    expect(screen.getByText('Municipalidad de Ejemplo')).toBeInTheDocument();
    expect(screen.queryByText('Zeta Producciones S.A.')).not.toBeInTheDocument();
  });

  it('el selector de subtipo ofrece los subtipos del sector público', async () => {
    renderPage();
    await screen.findByRole('table');

    const opciones = within(screen.getByLabelText('Subtipo'))
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(opciones).toEqual([
      'Todos',
      'Municipio',
      'Provincial u organismo público',
      'Sindicato u obra social',
    ]);
  });

  it('al pasar a Privado el subtipo elegido se descarta y el selector queda deshabilitado', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Sector'), 'PUBLICO');
    await user.selectOptions(screen.getByLabelText('Subtipo'), 'MUNICIPAL');
    await vi.waitFor(() => expect(ultimaUrl()).toContain('subtipo=MUNICIPAL'));

    await user.selectOptions(screen.getByLabelText('Sector'), 'PRIVADO');

    await vi.waitFor(() => expect(ultimaUrl()).toBe('https://api.example/clientes?sector=PRIVADO'));
    expect(screen.getByLabelText('Subtipo')).toBeDisabled();
    expect(screen.getByLabelText('Subtipo')).toHaveValue('');
  });

  it('arranca con los filtros que trae la URL, ignorando el subtipo si el sector es Privado', async () => {
    renderPage('/clientes?sector=PUBLICO&subtipo=MUNICIPAL');

    await screen.findByRole('table');
    expect(urlsPedidas()).toEqual([
      'https://api.example/clientes?sector=PUBLICO&subtipo=MUNICIPAL',
    ]);
    expect(screen.getByLabelText('Sector')).toHaveValue('PUBLICO');
    expect(screen.getByLabelText('Subtipo')).toHaveValue('MUNICIPAL');
  });

  it('ignora valores inválidos de la URL', async () => {
    renderPage('/clientes?sector=MIXTO&subtipo=FEDERAL');

    await screen.findByRole('table');
    expect(urlsPedidas()).toEqual(['https://api.example/clientes']);
  });

  it('mientras llega la respuesta de un filtro nuevo, la tabla no se vacía', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    await user.selectOptions(screen.getByLabelText('Sector'), 'PRIVADO');

    await vi.waitFor(() => expect(ultimaUrl()).toContain('sector=PRIVADO'));
    expect(screen.getByText('Municipalidad de Ejemplo')).toBeInTheDocument();
    expect(emptyHeading()).not.toBeInTheDocument();
    expect(screen.queryByText('No hay clientes que coincidan')).not.toBeInTheDocument();
  });

  it('si ningún cliente coincide avisa, y "Limpiar filtros" los restablece', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Sector'), 'PRIVADO');
    await user.type(screen.getByLabelText('Buscar cliente'), 'municipalidad');

    expect(await screen.findByText('No hay clientes que coincidan')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole('search')).getByRole('button', { name: 'Limpiar filtros' }),
    );

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(1 + catalogo.length);
    expect(screen.getByLabelText('Buscar cliente')).toHaveValue('');
    expect(screen.getByLabelText('Sector')).toHaveValue('');
    expect(emptyHeading()).not.toBeInTheDocument();
  });
});

describe('ClientesPage: buscador', () => {
  beforeEach(() => simularServidor());

  it('busca por razón social o denominación sin distinguir mayúsculas', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Buscar cliente'), 'MUNI');

    await vi.waitFor(() => expect(screen.queryByText('Zeta Producciones S.A.')).toBeNull());
    expect(ultimaUrl()).toBe('https://api.example/clientes?q=MUNI');
    expect(screen.getByText('Municipalidad de Ejemplo')).toBeInTheDocument();
    expect(screen.queryByText('Ministerio de Ejemplo')).not.toBeInTheDocument();
  });

  it.each([
    ['con guiones', '30-62494418-2'],
    ['sin guiones', '30624944182'],
  ])('busca por CUIT %s', async (_caso, cuit) => {
    const { user } = renderPage();
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Buscar cliente'), cuit);

    await vi.waitFor(() => expect(screen.queryByText('Zeta Producciones S.A.')).toBeNull());
    expect(screen.getByText('Ministerio de Ejemplo')).toBeInTheDocument();
    expect(screen.queryByText('Municipalidad de Ejemplo')).not.toBeInTheDocument();
  });

  it('espera 300 ms tras la última tecla: escribir seguido hace un solo pedido', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');
    const pedidosAntes = fetchMock.mock.calls.length;

    await user.type(screen.getByLabelText('Buscar cliente'), 'zeta');

    expect(fetchMock.mock.calls.length).toBe(pedidosAntes);
    await vi.waitFor(() => expect(ultimaUrl()).toBe('https://api.example/clientes?q=zeta'));
    expect(fetchMock.mock.calls.length).toBe(pedidosAntes + 1);
  });

  it('se combina con los filtros de sector y subtipo', async () => {
    const { user } = renderPage();
    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Sector'), 'PUBLICO');
    await user.selectOptions(screen.getByLabelText('Subtipo'), 'PROVINCIAL_ORGANISMO');

    await user.type(screen.getByLabelText('Buscar cliente'), 'ejemplo');

    await vi.waitFor(() => expect(ultimaUrl()).toContain('q=ejemplo'));
    const query = new URL(ultimaUrl()).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      q: 'ejemplo',
      sector: 'PUBLICO',
      subtipo: 'PROVINCIAL_ORGANISMO',
    });
    expect(screen.getByText('Ministerio de Ejemplo')).toBeInTheDocument();
    expect(screen.queryByText('Municipalidad de Ejemplo')).not.toBeInTheDocument();
  });

  it('arranca con el texto de la URL (?q=) y lo pide a la API', async () => {
    renderPage('/clientes?q=zeta');

    await screen.findByRole('table');
    expect(urlsPedidas()).toEqual(['https://api.example/clientes?q=zeta']);
    expect(screen.getByLabelText('Buscar cliente')).toHaveValue('zeta');
  });
});

// ─── Alta ─────────────────────────────────────────────────────────────────────

describe('ClientesPage: alta de cliente', () => {
  it.each([
    ['el encabezado', 'Nuevo cliente'],
    ['el estado vacío', 'Registrar el primer cliente'],
  ])('se abre desde %s', async (_origen, boton) => {
    const { user } = renderPage();
    await screen.findByRole('heading', { name: 'Todavía no cargaste clientes' });
    expect(panelDeAlta()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: boton }));

    expect(panelDeAlta()).toBeInTheDocument();
  });

  it('Cancelar cierra el panel sin enviar nada', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(llamadasPost()).toHaveLength(0);
  });

  it('al registrar cierra el panel, confirma el alta e invalida las queries de clientes', async () => {
    const { user, queryClient } = renderPage();
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    await completarAltaValida(user);
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se registró el cliente Empresa de Ejemplo S.A. (CUIT 20-12345678-6).',
    );
    await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('después del alta el listado se vuelve a pedir y muestra al cliente nuevo', async () => {
    const creado = {
      ...clientePrivado,
      razonSocial: 'Empresa de Ejemplo S.A.',
      denominacion: 'Empresa Ejemplo',
    };
    let clientes: ClienteJson[] = [];
    fetchMock.mockImplementation((entrada, init) => {
      if (init?.method === 'POST') {
        clientes = [creado];
        return Promise.resolve(respuesta201());
      }
      return Promise.resolve(json(listadoSegunQuery(urlDe(entrada), clientes)));
    });
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Registrar el primer cliente' }));

    await completarAltaValida(user);
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Empresa de Ejemplo S.A.', { selector: 'th' })).toBeInTheDocument();
    expect(emptyHeading()).not.toBeInTheDocument();
  });

  it('al reabrir después de un alta, el formulario está vacío y sin la confirmación anterior', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    // Un primer envío vacío deja errores marcados antes del alta exitosa.
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
    expect(screen.getByText('Ingresá la razón social.')).toBeInTheDocument();
    await completarAltaValida(user);
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Se registró el cliente');
    await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));

    expect(panelDeAlta()).toBeInTheDocument();
    expectFormularioLimpio();
    // Por texto y no por rol: con el panel modal abierto, el resto de la página queda oculto
    // para la API de accesibilidad y `queryByRole` no encontraría el mensaje aunque estuviera.
    expect(screen.queryByText(/Se registró el cliente/)).not.toBeInTheDocument();
  });

  it('al reabrir después de cancelar, no quedan datos ni errores', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    await user.type(screen.getByLabelText('CUIT'), '20-12345678-5');
    await user.selectOptions(screen.getByLabelText('Sector'), 'PUBLICO');
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
    expect(screen.getByLabelText('CUIT')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));

    expectFormularioLimpio();
    expect(llamadasPost()).toHaveLength(0);
  });

  it('Escape cierra el panel', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    await user.keyboard('{Escape}');

    await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
  });

  it('mientras guarda, Escape no cierra el panel ni repite el envío', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    fetchMock.mockImplementation((entrada, init) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            responder = resolve;
          })
        : Promise.resolve(json(listadoSegunQuery(urlDe(entrada), []))),
    );
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
    await completarAltaValida(user);
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
    expect(await screen.findByRole('button', { name: 'Guardando…' })).toBeDisabled();

    await user.keyboard('{Escape}');

    expect(panelDeAlta()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeInTheDocument();
    expect(llamadasPost()).toHaveLength(1);

    responder(respuesta201());
    await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(llamadasPost()).toHaveLength(1);
  });
});
