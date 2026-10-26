import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { CATALOGO_COMPACTO_QUERY } from '@/modules/tipos-documento/components/TiposDocumentoListado';
import { TiposDocumentoPage } from '@/modules/tipos-documento/pages/TiposDocumentoPage';

const fetchMock = vi.fn<typeof fetch>();
const BASE = 'https://api.example';

function renderPage(url = '/documentos') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/documentos', element: <TiposDocumentoPage /> }], {
    initialEntries: [url],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

// ─── Datos ficticios ──────────────────────────────────────────────────────────

/** Un tipo de documento como lo devuelve la API. */
interface TipoJson {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

const fechas = { creadoEn: '2026-10-21T12:00:00.000Z', actualizadoEn: '2026-10-21T12:00:00.000Z' };

const cae: TipoJson = {
  id: '11111111-1111-4111-a111-111111111111',
  nombre: 'CAE',
  descripcion: null,
  activo: true,
  ...fechas,
};
const factura: TipoJson = { ...cae, id: '22222222-2222-4222-a222-222222222222', nombre: 'Factura' };
const oc: TipoJson = {
  ...cae,
  id: '33333333-3333-4333-a333-333333333333',
  nombre: 'OC',
  descripcion: 'Orden de compra',
};
const print: TipoJson = {
  ...cae,
  id: '44444444-4444-4444-a444-444444444444',
  nombre: 'Print',
  activo: false,
};

/** URL de un pedido de fetch, venga como texto, URL o Request. */
const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Hace lo que el backend: sin `incluirInactivos`, solo los activos; el orden, el recibido. */
function simularServidor(catalogo: TipoJson[]) {
  fetchMock.mockImplementation((entrada) => {
    const incluir = new URL(urlDe(entrada)).searchParams.get('incluirInactivos') === 'true';
    return Promise.resolve(json(incluir ? catalogo : catalogo.filter((tipo) => tipo.activo)));
  });
}

/** Respuestas que llegan cuando el test lo decide, por URL pedida. */
function servidorEnPausa() {
  const pendientes = new Map<string, (respuesta: Response) => void>();
  fetchMock.mockImplementation((entrada) => {
    return new Promise<Response>((resolve) => {
      pendientes.set(urlDe(entrada), resolve);
    });
  });
  return async (ruta: string, cuerpo: unknown) => {
    await act(async () => {
      pendientes.get(`${BASE}${ruta}`)?.(json(cuerpo));
      await Promise.resolve();
    });
  };
}

const urlsPedidas = () => fetchMock.mock.calls.map(([entrada]) => urlDe(entrada));

// ─── Utilidades de la UI ──────────────────────────────────────────────────────

const filtro = () => screen.getByRole('checkbox', { name: 'Incluir desactivados' });
const tabla = () => screen.getByRole('table', { name: 'Tipos de documento' });
/** Los nombres de la columna Tipo, en el orden de la tabla. */
const nombresEnTabla = () =>
  within(tabla())
    .getAllByRole('rowheader')
    .map((celda) => celda.querySelector('span')?.textContent);
const filaDe = (nombre: string) => screen.getByRole('row', { name: new RegExp(`^${nombre}`) });

/** Simula una pantalla angosta: solo coincide la media query del catálogo. */
function simularPantallaAngosta() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: query === CATALOGO_COMPACTO_QUERY,
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
  vi.stubEnv('VITE_API_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe('TiposDocumentoPage: encabezado', () => {
  it('titula la sección "Documentos", con una sola frase que explica el catálogo, sin la navegación de Clientes', async () => {
    simularServidor([factura]);
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Documentos' })).toBeInTheDocument();
    expect(screen.getAllByText(/se pueden pedir como requisito/)).toHaveLength(1);
    expect(
      screen.getByText('Catálogo de tipos de documento que se pueden pedir como requisito.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nombres repetidos/)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Secciones de Clientes' })).toBeNull();
    await screen.findByRole('table', { name: 'Tipos de documento' });
  });

  it('ofrece "Nuevo tipo" en el encabezado, junto al título', async () => {
    simularServidor([factura, oc]);
    renderPage();

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(screen.getByRole('button', { name: 'Nuevo tipo' })).toBeInTheDocument();
  });
});

describe('TiposDocumentoPage: listado', () => {
  it('muestra los tipos que devuelve la API, en ese orden, con nombre, descripción y estado', async () => {
    // Fuera del orden alfabético a propósito: la página no reordena.
    simularServidor([oc, cae, factura]);
    renderPage();

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(nombresEnTabla()).toEqual(['OC', 'CAE', 'Factura']);
    expect(within(filaDe('OC')).getByText('Orden de compra')).toBeInTheDocument();
    expect(within(filaDe('OC')).getByText('Activo')).toBeInTheDocument();
  });

  it('las columnas son Tipo, Estado y Acciones: sin Uso', async () => {
    simularServidor([factura]);
    renderPage();

    const columnas = within(await screen.findByRole('table')).getAllByRole('columnheader');
    expect(columnas.map((columna) => columna.textContent)).toEqual(['Tipo', 'Estado', 'Acciones']);
  });

  it('un tipo sin descripción no recibe un texto inventado', async () => {
    simularServidor([factura]);
    renderPage();

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(within(filaDe('Factura')).getByRole('rowheader')).toHaveTextContent(/^Factura$/);
  });

  it('con desactivados, cada tipo dice su estado con texto', async () => {
    simularServidor([factura, print]);
    renderPage('/documentos?desactivados=1');

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(within(filaDe('Factura')).getByText('Activo')).toBeInTheDocument();
    expect(within(filaDe('Print')).getByText('Desactivado')).toBeInTheDocument();
    // Activos y desactivados quedan en el orden de la API, sin agruparlos.
    expect(nombresEnTabla()).toEqual(['Factura', 'Print']);
  });

  it('no muestra la clave normalizada, los ids ni las fechas', async () => {
    simularServidor([{ ...factura, nombreNormalizado: 'clave interna' } as TipoJson]);
    renderPage();

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(screen.queryByText('clave interna')).not.toBeInTheDocument();
    expect(screen.queryByText(factura.id)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });
});

describe('TiposDocumentoPage: pantallas angostas', () => {
  it('muestra tarjetas con la misma información que la tabla', async () => {
    simularPantallaAngosta();
    simularServidor([oc, print]);
    renderPage('/documentos?desactivados=1');

    const lista = await screen.findByRole('list', { name: 'Tipos de documento' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const tarjetas = within(lista).getAllByRole('listitem');
    expect(tarjetas).toHaveLength(2);
    expect(tarjetas[0]).toHaveTextContent('OC');
    expect(tarjetas[0]).toHaveTextContent('Orden de compra');
    expect(tarjetas[0]).toHaveTextContent('Activo');
    expect(tarjetas[1]).toHaveTextContent('Print');
    expect(tarjetas[1]).toHaveTextContent('Desactivado');
  });

  it('en escritorio muestra la tabla y no las tarjetas', async () => {
    simularServidor([oc]);
    renderPage();

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(screen.queryByRole('list', { name: 'Tipos de documento' })).not.toBeInTheDocument();
  });
});

describe('TiposDocumentoPage: filtro "Incluir desactivados"', () => {
  it('sin parámetros está desmarcado y pide solo los activos, una sola vez', async () => {
    simularServidor([factura, print]);
    renderPage();

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(filtro()).not.toBeChecked();
    expect(urlsPedidas()).toEqual([`${BASE}/tipos-documento`]);
    expect(screen.queryByText('Print')).not.toBeInTheDocument();
  });

  it('con ?desactivados=1 arranca marcado y pide todos (sobrevive a una recarga)', async () => {
    simularServidor([factura, print]);
    renderPage('/documentos?desactivados=1');

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(filtro()).toBeChecked();
    expect(urlsPedidas()).toEqual([`${BASE}/tipos-documento?incluirInactivos=true`]);
  });

  it('marcarlo agrega ?desactivados=1 como entrada nueva del historial y muestra los desactivados', async () => {
    simularServidor([factura, print]);
    const { router, user } = renderPage();
    await screen.findByRole('table', { name: 'Tipos de documento' });

    await user.click(filtro());

    expect(router.state.location.search).toBe('?desactivados=1');
    expect(router.state.historyAction).toBe('PUSH');
    expect(await screen.findByText('Print')).toBeInTheDocument();
    expect(filtro()).toBeChecked();
  });

  it('desmarcarlo quita el parámetro y vuelve a los activos', async () => {
    simularServidor([factura, print]);
    const { router, user } = renderPage('/documentos?desactivados=1');
    await screen.findByText('Print');

    await user.click(filtro());

    expect(router.state.location.search).toBe('');
    expect(filtro()).not.toBeChecked();
    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(nombresEnTabla()).toEqual(['Factura']);
  });

  it('Atrás y Adelante restauran el filtro', async () => {
    simularServidor([factura, print]);
    const { router, user } = renderPage();
    await screen.findByRole('table', { name: 'Tipos de documento' });
    await user.click(filtro());
    expect(filtro()).toBeChecked();

    await act(() => router.navigate(-1));
    expect(filtro()).not.toBeChecked();

    await act(() => router.navigate(1));
    expect(filtro()).toBeChecked();
  });

  it('conserva los demás parámetros de la URL al marcar y desmarcar', async () => {
    simularServidor([factura]);
    const { router, user } = renderPage('/documentos?otro=x');
    await screen.findByRole('table', { name: 'Tipos de documento' });

    await user.click(filtro());
    expect(new URLSearchParams(router.state.location.search).get('otro')).toBe('x');

    await user.click(filtro());
    expect(router.state.location.search).toBe('?otro=x');
  });

  it.each([
    ['un valor desconocido', '?desactivados=true&otro=x', '?otro=x', false],
    ['un cero', '?desactivados=0', '', false],
    ['el parámetro repetido', '?desactivados=1&desactivados=1', '?desactivados=1', true],
  ])('normaliza %s, sin sumar una entrada al historial', async (_caso, query, limpia, marcado) => {
    simularServidor([factura, print]);
    const { router } = renderPage(`/documentos${query}`);

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(router.state.location.search).toBe(limpia);
    expect(router.state.historyAction).toBe('REPLACE');
    expect(filtro()).toHaveAttribute('aria-checked', String(marcado));
  });

  it('un valor equivalente a "sin filtro" no genera otra consulta', async () => {
    simularServidor([factura]);
    renderPage('/documentos?desactivados=0');

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(urlsPedidas()).toEqual([`${BASE}/tipos-documento`]);
  });
});

describe('TiposDocumentoPage: estados de la consulta', () => {
  it('mientras carga muestra el esqueleto con el filtro a la vista, nunca un estado vacío', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    renderPage();

    expect(screen.getByText('Cargando tipos de documento…')).toBeInTheDocument();
    expect(filtro()).toBeInTheDocument();
    expect(screen.queryByText('Todavía no hay tipos de documento')).not.toBeInTheDocument();
    expect(screen.queryByText('No hay tipos activos')).not.toBeInTheDocument();
  });

  /** El error de carga: lo que se dice, con su causa y su código, y nunca un estado vacío. */
  async function esperarError(etiqueta: string, codigo: string) {
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText('No pudimos cargar los tipos de documento')).toBeVisible();
    expect(within(alerta).getByText(etiqueta)).toBeInTheDocument();
    expect(within(alerta).getByText(codigo)).toBeInTheDocument();
    expect(screen.queryByText('Todavía no hay tipos de documento')).not.toBeInTheDocument();
  }

  it('sin conexión dice que no pudo cargar, con la causa y el diagnóstico', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();

    await esperarError('Error de conexión', 'NETWORK_ERROR');
  });

  it('ante un error del servidor dice que no pudo cargar, con la causa y el diagnóstico', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ error: { code: 'INTERNAL_ERROR' } }, 500)),
    );
    renderPage();

    await esperarError('Error del servidor', 'HTTP_500');
  });

  it('con la dirección del servidor mal configurada lo dice, sin pedir nada', async () => {
    vi.stubEnv('VITE_API_URL', '');
    renderPage();

    await esperarError('Error de configuración', 'CONFIG_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el error no muestra detalles internos del servidor', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ error: { message: 'SELECT * FROM "TipoDocumento"' } }, 500)),
    );
    renderPage();

    await screen.findByRole('alert');
    expect(screen.queryByText(/SELECT/)).not.toBeInTheDocument();
  });

  it('Reintentar vuelve a pedir el catálogo y, si sale bien, lo muestra', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { user } = renderPage();
    await screen.findByRole('alert');
    simularServidor([factura]);

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sin ningún tipo (ni desactivados) dice que todavía no hay tipos e invita a crear el primero', async () => {
    simularServidor([]);
    renderPage();

    expect(await screen.findByText('Todavía no hay tipos de documento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear el primer tipo' })).toBeInTheDocument();
    // Para saber si había desactivados se pidió el catálogo completo.
    expect(urlsPedidas()).toContain(`${BASE}/tipos-documento?incluirInactivos=true`);
  });

  it('sin activos pero con desactivados no dice que el catálogo está vacío y deja verlos', async () => {
    simularServidor([print]);
    const { router, user } = renderPage();

    expect(await screen.findByText('No hay tipos activos')).toBeInTheDocument();
    expect(screen.getByText(/Hay 1 tipo desactivado/)).toBeInTheDocument();
    expect(screen.queryByText('Todavía no hay tipos de documento')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver desactivados' }));

    expect(router.state.location.search).toBe('?desactivados=1');
    expect(filtro()).toBeChecked();
    expect(within(await screen.findByRole('table')).getByText('Desactivado')).toBeInTheDocument();
  });

  it('si no se pudo comprobar si hay desactivados, no afirma que el catálogo está vacío', async () => {
    fetchMock.mockImplementation((entrada) =>
      Promise.resolve(
        urlDe(entrada).includes('incluirInactivos')
          ? json({ error: { code: 'INTERNAL_ERROR' } }, 500)
          : json([]),
      ),
    );
    renderPage();

    expect(await screen.findByText('No hay tipos activos')).toBeInTheDocument();
    expect(screen.getByText(/No pudimos comprobar si hay tipos desactivados/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver desactivados' })).toBeInTheDocument();
    expect(screen.queryByText('Todavía no hay tipos de documento')).not.toBeInTheDocument();
  });

  it('con desactivados incluidos y el catálogo vacío, el filtro sigue a la vista para volver', async () => {
    simularServidor([]);
    renderPage('/documentos?desactivados=1');

    expect(await screen.findByText('Todavía no hay tipos de documento')).toBeInTheDocument();
    expect(filtro()).toBeChecked();
    // Es la consulta de la vista: no hace falta otra para saber si hay desactivados.
    expect(urlsPedidas()).toEqual([`${BASE}/tipos-documento?incluirInactivos=true`]);
  });
});

describe('TiposDocumentoPage: cambio de filtro en curso', () => {
  it('mientras llega el filtro nuevo sigue mostrando la lista anterior, marcada como actualizándose', async () => {
    const responder = servidorEnPausa();
    const { user } = renderPage();
    await responder('/tipos-documento', [factura]);
    await screen.findByRole('table', { name: 'Tipos de documento' });

    await user.click(filtro());

    expect(screen.getByText('Actualizando…')).toBeInTheDocument();
    expect(nombresEnTabla()).toEqual(['Factura']);
    expect(tabla().closest('[aria-busy="true"]')).not.toBeNull();

    await responder('/tipos-documento?incluirInactivos=true', [factura, print]);

    expect(await screen.findByText('Print')).toBeInTheDocument();
    expect(screen.queryByText('Actualizando…')).not.toBeInTheDocument();
    expect(tabla().closest('[aria-busy="true"]')).toBeNull();
  });

  it('si la lista anterior estaba vacía, no muestra un estado vacío mientras llega la nueva', async () => {
    const responder = servidorEnPausa();
    const { user } = renderPage('/documentos?desactivados=1');
    await responder('/tipos-documento?incluirInactivos=true', []);
    await screen.findByText('Todavía no hay tipos de documento');

    await user.click(filtro());

    expect(screen.getByText('Cargando tipos de documento…')).toBeInTheDocument();
    expect(screen.queryByText('Todavía no hay tipos de documento')).not.toBeInTheDocument();

    await responder('/tipos-documento', [factura]);

    await screen.findByRole('table', { name: 'Tipos de documento' });
    expect(nombresEnTabla()).toEqual(['Factura']);
  });
});
