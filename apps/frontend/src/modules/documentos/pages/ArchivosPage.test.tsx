import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { ArchivosPage } from '@/modules/documentos/pages/ArchivosPage';
import { elegirOpcion } from '@/test/select';

const fetchMock = vi.fn<typeof fetch>();
const BASE = 'https://api.example';

// ─── Datos ficticios ──────────────────────────────────────────────────────────

const fechas = { creadoEn: '2026-10-20T12:00:00.000Z', actualizadoEn: '2026-10-20T12:00:00.000Z' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PRINT = { id: id(1), nombre: 'Print' };
const FACTURA = { id: id(2), nombre: 'Factura' };
const tipos = [
  { ...PRINT, descripcion: null, activo: true, ...fechas },
  { ...FACTURA, descripcion: null, activo: true, ...fechas },
];

const documento = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(100 + n),
  tipoDocumento: PRINT,
  anio: 2026,
  mes: 10,
  nombreOriginal: `print-${n}.pdf`,
  tipoContenido: 'application/pdf',
  tamanioBytes: 2048,
  ...fechas,
  ...extra,
});

const EXISTENTE = documento(1, { aplicacionesVigentes: 2 });
const SIN_APLICAR = documento(2, {
  tipoDocumento: FACTURA,
  nombreOriginal: 'factura-octubre.pdf',
  aplicacionesVigentes: 0,
});
const NUEVO = documento(3, { nombreOriginal: 'constancia año.pdf' });

const CLIENTE_A = { id: id(200), denominacion: 'Municipio Alfa', estado: 'ACTIVO' };
const CLIENTE_B = { id: id(201), denominacion: 'Sindicato Beta', estado: 'INACTIVO' };
const RENDICION_A = { id: id(300), anio: 2026, mes: 10, numeroFactura: 'B 00002-00000001' };
const RENDICION_B = { id: id(301), anio: 2026, mes: 10, numeroFactura: 'B 00002-00000002' };
const item = (n: number, ordinal: number, totalOrdinal: number) => ({
  id: id(400 + n),
  tipoDocumentoId: PRINT.id,
  nombreTipoDocumento: 'Print',
  ordinal,
  totalOrdinal,
  diaAproximado: null,
});
const ITEM_A1 = item(1, 1, 2);
const ITEM_A2 = item(2, 2, 2);
const ITEM_B1 = item(3, 1, 1);
const candidato = (cliente: object, rendicion: object, it: object) => ({
  cliente,
  rendicion,
  item: it,
  elegibilidad: 'ELEGIBLE',
});
const CANDIDATOS = [
  candidato(CLIENTE_A, RENDICION_A, ITEM_A1),
  candidato(CLIENTE_A, RENDICION_A, ITEM_A2),
  candidato(CLIENTE_B, RENDICION_B, ITEM_B1),
];

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const error = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: 'x', details } }, status);

// ─── Backend simulado ─────────────────────────────────────────────────────────

interface Llamada {
  metodo: string;
  ruta: string;
  query: URLSearchParams;
  cuerpo: BodyInit | null | undefined;
}

/** Lo que responde el backend en cada test. Se puede pisar cualquier parte. */
let servidor: {
  documentos: object[];
  candidatos: Record<string, object[]>;
  detalle: (documentoId: string) => Response;
  carga: () => Response;
  aplicacion: (documentoId: string) => Response;
  archivo: () => Response;
};
let llamadas: Llamada[];

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function responder({ metodo, ruta, query }: Llamada): Response {
  if (ruta === '/tipos-documento') return json(tipos);
  if (ruta === '/documentos' && metodo === 'GET') {
    const tipo = query.get('tipoDocumentoId');
    return json(
      servidor.documentos.filter(
        (d) => tipo === null || (d as { tipoDocumento: { id: string } }).tipoDocumento.id === tipo,
      ),
    );
  }
  if (ruta === '/documentos' && metodo === 'POST') return servidor.carga();
  const [, , documentoId = '', accion] = ruta.split('/');
  if (accion === 'candidatos') return json(servidor.candidatos[documentoId] ?? []);
  if (accion === 'aplicaciones') return servidor.aplicacion(documentoId);
  if (accion === 'archivo') return servidor.archivo();
  return servidor.detalle(documentoId);
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', BASE);
  vi.stubGlobal('fetch', fetchMock);
  llamadas = [];
  servidor = {
    documentos: [EXISTENTE, SIN_APLICAR],
    candidatos: { [NUEVO.id]: CANDIDATOS, [EXISTENTE.id]: CANDIDATOS },
    detalle: (documentoId) =>
      json({ ...(documentoId === NUEVO.id ? NUEVO : EXISTENTE), aplicaciones: [] }),
    carga: () => json({ documento: NUEVO, posiblesDuplicados: [] }, 201),
    aplicacion: (documentoId) =>
      json({ ...(documentoId === NUEVO.id ? NUEVO : EXISTENTE), aplicaciones: [] }),
    archivo: () =>
      new Response(new Blob(['%PDF-1.7']), { headers: { 'Content-Type': 'application/pdf' } }),
  };
  fetchMock.mockImplementation((entrada, init) => {
    const url = new URL(urlDe(entrada));
    const llamada: Llamada = {
      metodo: init?.method ?? 'GET',
      ruta: url.pathname,
      query: url.searchParams,
      cuerpo: init?.body,
    };
    llamadas.push(llamada);
    return Promise.resolve(responder(llamada));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const llamadasA = (metodo: string, ruta: string | RegExp) =>
  llamadas.filter(
    (l) => l.metodo === metodo && (typeof ruta === 'string' ? l.ruta === ruta : ruta.test(l.ruta)),
  );

function renderPage(url = '/documentos/archivos?anio=2026&mes=10') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/documentos/archivos', element: <ArchivosPage /> },
      { path: '/documentos', element: <h1>Tipos</h1> },
      { path: '/clientes/:id/rendiciones/:rendicionId', element: <h1>Rendición</h1> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // `applyAccept: false`: deja elegir un archivo que el `accept` del input filtraría, para probar
  // la validación propia.
  return { router, user: userEvent.setup({ applyAccept: false }) };
}

const filaDe = (nombre: string) => screen.getByRole('button', { name: nombre }).closest('tr');

// ─── Repositorio ──────────────────────────────────────────────────────────────

describe('ArchivosPage: repositorio', () => {
  it('lista los archivos del período de la URL, con tipo, fecha y aplicaciones', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'print-1.pdf' })).toBeInTheDocument();
    expect(llamadasA('GET', '/documentos')[0]?.query.toString()).toBe('anio=2026&mes=10');
    expect(
      screen.getByText(
        'Repositorio de Octubre 2026. Un mismo archivo puede aplicarse a varias rendiciones.',
      ),
    ).toBeInTheDocument();

    const fila = within(filaDe('print-1.pdf') as HTMLElement);
    expect(fila.getByText('Print')).toBeInTheDocument();
    expect(fila.getByText('2 ítems')).toBeInTheDocument();
    expect(fila.getByText('PDF · 2 KB')).toBeInTheDocument();
    expect(
      within(filaDe('factura-octubre.pdf') as HTMLElement).getByText('Sin aplicar'),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Secciones de Documentos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Archivos' })).toHaveAttribute('aria-current', 'page');
  });

  it('filtra por tipo de documento (en la URL y en el pedido)', async () => {
    const { router, user } = renderPage();
    await screen.findByRole('button', { name: 'print-1.pdf' });

    await elegirOpcion(user, screen.getByLabelText('Tipo de documento'), 'Factura');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'print-1.pdf' })).not.toBeInTheDocument(),
    );
    expect(router.state.location.search).toContain(`tipo=${FACTURA.id}`);
    expect(llamadasA('GET', '/documentos').at(-1)?.query.get('tipoDocumentoId')).toBe(FACTURA.id);
  });

  it('cambia el período desde los filtros', async () => {
    const { router, user } = renderPage();
    await screen.findByRole('button', { name: 'print-1.pdf' });

    await elegirOpcion(user, screen.getByLabelText('Mes'), '9');

    await waitFor(() => expect(router.state.location.search).toContain('mes=9'));
    expect(llamadasA('GET', '/documentos').at(-1)?.query.get('mes')).toBe('9');
  });

  it('busca por nombre sin distinguir acentos y ofrece limpiar los filtros', async () => {
    const { user } = renderPage();
    await screen.findByRole('button', { name: 'print-1.pdf' });

    await user.type(screen.getByLabelText('Buscar por nombre'), 'FACTURA');
    expect(screen.queryByRole('button', { name: 'print-1.pdf' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'factura-octubre.pdf' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Buscar por nombre'));
    await user.type(screen.getByLabelText('Buscar por nombre'), 'zzz');
    expect(
      screen.getByRole('heading', { name: 'Ningún archivo coincide con estos filtros' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(screen.getByRole('button', { name: 'print-1.pdf' })).toBeInTheDocument();
  });

  it('un período sin archivos lo dice y ofrece cargar uno', async () => {
    servidor.documentos = [];
    renderPage();

    expect(
      await screen.findByRole('heading', {
        name: 'Todavía no se cargaron documentos en Octubre 2026',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cargar documento' })).toHaveLength(2);
  });

  it('un error de la API no se confunde con un repositorio vacío y se puede reintentar', async () => {
    let fallar = true;
    const original = responder;
    fetchMock.mockImplementation((entrada, init) => {
      const url = new URL(urlDe(entrada));
      if (url.pathname === '/documentos' && fallar)
        return Promise.resolve(error(500, 'INTERNAL_ERROR'));
      return Promise.resolve(
        original({
          metodo: init?.method ?? 'GET',
          ruta: url.pathname,
          query: url.searchParams,
          cuerpo: null,
        }),
      );
    });
    const { user } = renderPage();

    expect(
      await screen.findByRole('heading', { name: 'No pudimos cargar los archivos' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Todavía no se cargaron/)).not.toBeInTheDocument();

    fallar = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: 'print-1.pdf' })).toBeInTheDocument();
  });

  it('descarga a través del backend y guarda con el nombre original', async () => {
    const crear = vi.fn(() => 'blob:prueba');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() }));
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('print-1.pdf');
      expect(this.href).toBe('blob:prueba');
    });
    const { user } = renderPage();
    await screen.findByRole('button', { name: 'print-1.pdf' });

    await user.click(screen.getByRole('button', { name: 'Descargar print-1.pdf' }));

    await waitFor(() => expect(clic).toHaveBeenCalledTimes(1));
    expect(llamadasA('GET', `/documentos/${EXISTENTE.id}/archivo`)).toHaveLength(1);
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('si la descarga falla, lo avisa', async () => {
    servidor.archivo = () => error(503, 'SERVICE_UNAVAILABLE');
    const { user } = renderPage();
    await screen.findByRole('button', { name: 'print-1.pdf' });

    await user.click(screen.getByRole('button', { name: 'Descargar print-1.pdf' }));

    expect(
      await screen.findByText('No se pudo descargar print-1.pdf. Probá de nuevo.'),
    ).toBeInTheDocument();
  });
});

// ─── Detalle ──────────────────────────────────────────────────────────────────

describe('ArchivosPage: detalle de un documento', () => {
  it('muestra dónde está vigente y el historial, con rendiciones anuladas y clientes inactivos', async () => {
    const ubicacion = (cliente: object, rendicion: object, estado: string, it: object) => ({
      cliente,
      rendicion: { ...rendicion, estado },
      item: it,
    });
    servidor.detalle = () =>
      json({
        ...EXISTENTE,
        aplicaciones: [
          {
            id: id(500),
            documentoId: EXISTENTE.id,
            itemChecklistId: ITEM_A1.id,
            estado: 'VIGENTE',
            aplicadaEn: '2026-10-21T10:00:00.000Z',
            reemplazadaEn: null,
            reemplazaAId: null,
            ubicacion: ubicacion(CLIENTE_A, RENDICION_A, 'ACTIVA', ITEM_A1),
          },
          {
            id: id(501),
            documentoId: EXISTENTE.id,
            itemChecklistId: ITEM_B1.id,
            estado: 'VIGENTE',
            aplicadaEn: '2026-10-21T10:00:00.000Z',
            reemplazadaEn: null,
            reemplazaAId: null,
            ubicacion: ubicacion(CLIENTE_B, RENDICION_B, 'ANULADA', ITEM_B1),
          },
          {
            id: id(502),
            documentoId: EXISTENTE.id,
            itemChecklistId: ITEM_A2.id,
            estado: 'REEMPLAZADA',
            aplicadaEn: '2026-10-20T10:00:00.000Z',
            reemplazadaEn: '2026-10-22T10:00:00.000Z',
            reemplazaAId: null,
            ubicacion: ubicacion(CLIENTE_A, RENDICION_A, 'ACTIVA', ITEM_A2),
          },
        ],
      });
    const { user } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'print-1.pdf' }));

    const detalle = await screen.findByRole('dialog', { name: 'print-1.pdf' });
    const vigentes = await within(detalle).findByRole('region', { name: 'Dónde está vigente' });
    expect(within(vigentes).getAllByRole('listitem')).toHaveLength(2);
    expect(within(vigentes).getByText('Rendición anulada')).toBeInTheDocument();
    expect(within(vigentes).getByText('Cliente inactivo')).toBeInTheDocument();
    const historial = within(detalle).getByRole('region', { name: 'Historial (reemplazado)' });
    expect(within(historial).getByText(/reemplazado el/)).toBeInTheDocument();
    expect(within(detalle).getAllByRole('link', { name: /Ver la rendición/ })[0]).toHaveAttribute(
      'href',
      `/clientes/${CLIENTE_A.id}/rendiciones/${RENDICION_A.id}`,
    );
    expect(detalle.textContent).not.toMatch(/sha256|claveAlmacenamiento|documentos\//);
  });
});

// ─── Asistente ────────────────────────────────────────────────────────────────

const pdf = () => new File(['%PDF-1.7'], 'constancia año.pdf', { type: 'application/pdf' });

async function abrirAsistente(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'print-1.pdf' });
  await user.click(screen.getByRole('button', { name: 'Cargar documento' }));
  return screen.findByRole('dialog', { name: 'Cargar y aplicar un documento' });
}

async function subirPdf(user: ReturnType<typeof userEvent.setup>, asistente: HTMLElement) {
  await user.upload(within(asistente).getByLabelText('Archivo'), pdf());
  await elegirOpcion(user, within(asistente).getByLabelText('Tipo de documento'), 'Print');
  await user.click(within(asistente).getByRole('button', { name: 'Subir y continuar' }));
}

/** Los campos de texto del formulario de carga que llegó al backend. */
function formularioCargado(): Record<string, FormDataEntryValue | null> {
  const cuerpo = llamadasA('POST', '/documentos')[0]?.cuerpo;
  expect(cuerpo).toBeInstanceOf(FormData);
  const formulario = cuerpo as FormData;
  return {
    tipoDocumentoId: formulario.get('tipoDocumentoId'),
    anio: formulario.get('anio'),
    mes: formulario.get('mes'),
    archivo: formulario.get('archivo'),
  };
}

describe('ArchivosPage: asistente de carga y aplicación', () => {
  it('sube, elige varios ítems de distintas rendiciones y clientes, y aplica al confirmar', async () => {
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);

    await subirPdf(user, asistente);

    // Paso 2: agrupado por cliente y rendición, nada marcado.
    const clienteA = await within(asistente).findByRole('region', { name: 'Municipio Alfa' });
    const clienteB = within(asistente).getByRole('region', { name: /Sindicato Beta/ });
    expect(within(clienteB).getByText('Cliente inactivo')).toBeInTheDocument();
    expect(within(asistente).queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    expect(within(asistente).getByRole('button', { name: /Revisar/ })).toBeDisabled();

    const formulario = formularioCargado();
    expect(formulario).toMatchObject({ tipoDocumentoId: PRINT.id, anio: '2026', mes: '10' });
    expect((formulario.archivo as File).name).toBe('constancia año.pdf');

    await user.click(within(clienteA).getByRole('checkbox', { name: 'Print 1 de 2' }));
    await user.click(within(clienteA).getByRole('checkbox', { name: 'Print 2 de 2' }));
    await user.click(within(clienteB).getByRole('checkbox', { name: 'Print' }));
    expect(within(asistente).getByText('3 ítems en 2 rendiciones')).toBeInTheDocument();

    // Paso 3: el resumen antes de aplicar.
    await user.click(within(asistente).getByRole('button', { name: /Revisar/ }));
    expect(
      within(asistente).getByRole('heading', { name: 'Se aplica a 3 ítems en 2 rendiciones' }),
    ).toBeInTheDocument();
    expect(within(asistente).getByText(/Print 1 de 2, Print 2 de 2/)).toBeInTheDocument();
    expect(llamadasA('POST', /aplicaciones$/)).toHaveLength(0);

    await user.click(within(asistente).getByRole('button', { name: 'Confirmar y aplicar' }));

    expect(
      await screen.findByText('Se aplicó constancia año.pdf a 3 ítems en 2 rendiciones.'),
    ).toBeInTheDocument();
    const [aplicar] = llamadasA('POST', `/documentos/${NUEVO.id}/aplicaciones`);
    expect(JSON.parse(aplicar?.cuerpo as string)).toEqual({
      itemIds: [ITEM_A1.id, ITEM_A2.id, ITEM_B1.id],
    });
    expect(llamadasA('POST', '/documentos')).toHaveLength(1);
  });

  it('no sube nada sin el archivo y el tipo, ni un formato que no se admite', async () => {
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);

    await user.click(within(asistente).getByRole('button', { name: 'Subir y continuar' }));
    expect(within(asistente).getByText('Elegí el archivo.')).toBeInTheDocument();
    expect(within(asistente).getByText('Elegí el tipo de documento.')).toBeInTheDocument();

    await user.upload(
      within(asistente).getByLabelText('Archivo'),
      new File(['MZ'], 'programa.exe', { type: 'application/octet-stream' }),
    );
    expect(
      within(asistente).getByText(/El formato del archivo no está admitido/),
    ).toBeInTheDocument();
    expect(llamadasA('POST', '/documentos')).toHaveLength(0);
  });

  it('muestra el error del servidor al subir sin perder lo elegido', async () => {
    servidor.carga = () => error(503, 'SERVICE_UNAVAILABLE');
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);

    await subirPdf(user, asistente);

    expect(
      await within(asistente).findByText(/El almacenamiento de documentos no respondió/),
    ).toBeInTheDocument();
    expect(within(asistente).getByRole('button', { name: 'Subir y continuar' })).toBeEnabled();
  });

  it('avisa de un posible duplicado y permite usar el que ya estaba', async () => {
    servidor.carga = () => json({ documento: NUEVO, posiblesDuplicados: [EXISTENTE] }, 201);
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);

    await subirPdf(user, asistente);

    expect(
      await within(asistente).findByText(/con el mismo contenido, tipo y período/),
    ).toBeInTheDocument();
    await user.click(within(asistente).getByRole('button', { name: 'Usar este' }));

    expect(
      await within(asistente).findByRole('region', { name: 'Municipio Alfa' }),
    ).toBeInTheDocument();
    expect(llamadasA('GET', `/documentos/${EXISTENTE.id}/candidatos`)).toHaveLength(1);
    expect(llamadasA('GET', `/documentos/${NUEVO.id}/candidatos`)).toHaveLength(0);
  });

  it('reutiliza un documento ya cargado del período, sin subir nada', async () => {
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);

    await user.click(within(asistente).getByRole('radio', { name: /Usar uno ya cargado/ }));
    await user.click(await within(asistente).findByRole('radio', { name: /print-1\.pdf/ }));
    await user.click(within(asistente).getByRole('button', { name: /Siguiente/ }));

    expect(
      await within(asistente).findByRole('region', { name: 'Municipio Alfa' }),
    ).toBeInTheDocument();
    expect(llamadasA('GET', `/documentos/${EXISTENTE.id}/candidatos`)).toHaveLength(1);
    expect(llamadasA('POST', '/documentos')).toHaveLength(0);
  });

  it('desde un archivo del repositorio arranca en "Dónde aplica"', async () => {
    const { user } = renderPage();
    await screen.findByRole('button', { name: 'print-1.pdf' });

    await user.click(screen.getByRole('button', { name: 'Aplicar print-1.pdf' }));

    const asistente = await screen.findByRole('dialog', { name: 'Aplicar documento' });
    expect(within(asistente).getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'Dónde aplica',
    );
    expect(
      await within(asistente).findByRole('region', { name: 'Municipio Alfa' }),
    ).toBeInTheDocument();
  });

  it('ante un 409, vuelve a elegir sin el ítem que dejó de estar disponible y sin volver a subir', async () => {
    servidor.aplicacion = () => {
      // Mientras tanto alguien aplicó otro documento a Print 2 de 2.
      servidor.candidatos[NUEVO.id] = CANDIDATOS.filter((c) => c.item !== ITEM_A2);
      return error(409, 'CONFLICT', { motivo: 'ITEM_NO_PENDIENTE', itemId: ITEM_A2.id });
    };
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);
    await subirPdf(user, asistente);
    const clienteA = await within(asistente).findByRole('region', { name: 'Municipio Alfa' });
    await user.click(within(clienteA).getByRole('checkbox', { name: 'Print 1 de 2' }));
    await user.click(within(clienteA).getByRole('checkbox', { name: 'Print 2 de 2' }));
    await user.click(within(asistente).getByRole('button', { name: /Revisar/ }));

    await user.click(within(asistente).getByRole('button', { name: 'Confirmar y aplicar' }));

    expect(
      await within(asistente).findByText(
        /Print 2 de 2 de Municipio Alfa \(factura B 00002-00000001\) ya tiene un documento/,
      ),
    ).toBeInTheDocument();
    expect(
      within(asistente).queryByRole('checkbox', { name: 'Print 2 de 2' }),
    ).not.toBeInTheDocument();
    expect(within(asistente).getByText('1 ítem en 1 rendición')).toBeInTheDocument();
    expect(llamadasA('POST', '/documentos')).toHaveLength(1);
  });

  it('si se cierra después de subir, el documento queda guardado y no se vuelve a subir', async () => {
    const { user } = renderPage();
    const asistente = await abrirAsistente(user);
    await subirPdf(user, asistente);
    await within(asistente).findByRole('region', { name: 'Municipio Alfa' });

    // Volver al paso 1 no vuelve a subir: el archivo ya está en el repositorio.
    await user.click(within(asistente).getByRole('button', { name: /Atrás/ }));
    expect(within(asistente).getByText(/ya está en el repositorio/)).toBeInTheDocument();
    expect(
      within(asistente).queryByRole('button', { name: 'Subir y continuar' }),
    ).not.toBeInTheDocument();

    await user.click(within(asistente).getByRole('button', { name: 'Cerrar sin aplicar' }));

    expect(
      await screen.findByText(
        'Se guardó constancia año.pdf en el repositorio, sin aplicar. Podés aplicarlo cuando quieras.',
      ),
    ).toBeInTheDocument();
    expect(llamadasA('POST', '/documentos')).toHaveLength(1);
    expect(llamadasA('POST', /aplicaciones$/)).toHaveLength(0);
  });
});
