import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  CLIENTE_ID,
  errorJson,
  itemJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Documentos dentro del detalle de una rendición (HU2.8, contrato 4.10): asociar uno existente a
// un ítem pendiente, descargar el vigente, reemplazarlo y consultar el historial del ítem.

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

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

const FECHA = '2026-10-08T12:00:00.000Z';
const uuid = (prefijo: string, n: number) => `${prefijo}-0000-4000-8000-00000000000${n}`;

const FACTURA_TIPO = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const PRINT_TIPO = uuid('7a7a7a7a', 1);
const FACTURA = uuid('1e1e1e1e', 0);
const PRINT_1 = uuid('1e1e1e1e', 1);
const PRINT_2 = uuid('1e1e1e1e', 2);
const DOC_VIEJO = uuid('d0d0d0d0', 0);
const DOC_A = uuid('d0d0d0d0', 1);
const DOC_B = uuid('d0d0d0d0', 2);
const APP_VIEJA = uuid('a0a0a0a0', 0);
const APP_A = uuid('a0a0a0a0', 1);

const clienteJson = {
  id: CLIENTE_ID,
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: true,
  creadoEn: FECHA,
  actualizadoEn: FECHA,
};

interface DocumentoDePrueba {
  id: string;
  nombreOriginal: string;
  tipoDocumentoId: string;
}

const documentos: Record<string, DocumentoDePrueba> = {
  [DOC_VIEJO]: { id: DOC_VIEJO, nombreOriginal: 'print-viejo.pdf', tipoDocumentoId: PRINT_TIPO },
  [DOC_A]: { id: DOC_A, nombreOriginal: 'print-octubre.pdf', tipoDocumentoId: PRINT_TIPO },
  [DOC_B]: { id: DOC_B, nombreOriginal: 'print-octubre-v2.pdf', tipoDocumentoId: PRINT_TIPO },
};

const documentoJson = (documento: DocumentoDePrueba) => ({
  id: documento.id,
  tipoDocumento: {
    id: documento.tipoDocumentoId,
    nombre: documento.tipoDocumentoId === PRINT_TIPO ? 'Print' : 'Factura',
  },
  anio: 2026,
  mes: 10,
  nombreOriginal: documento.nombreOriginal,
  tipoContenido: 'application/pdf',
  tamanioBytes: 2048,
  creadoEn: FECHA,
  actualizadoEn: FECHA,
});

interface Aplicacion {
  id: string;
  documentoId: string;
  itemId: string;
  aplicadaEn: string;
  reemplazadaEn: string | null;
  reemplazaAId: string | null;
}

/**
 * Servidor de mentira con estado. Factura y Print 2 de 2 están pendientes; Print 1 de 2 tiene
 * print-octubre.pdf, que reemplazó a print-viejo.pdf. En el repositorio de Octubre 2026 hay dos
 * Prints (A y B) y ninguna Factura. Cada `fallo` reemplaza la respuesta de ese endpoint.
 */
function servir({
  estado = 'ACTIVA',
  sinDocumentos = false,
  fallos = {},
}: {
  estado?: 'ACTIVA' | 'ANULADA';
  /** La API no informa el documento de los ítems (contrato anterior a HU2.8). */
  sinDocumentos?: boolean;
  fallos?: {
    [endpoint in 'listado' | 'aplicar' | 'reemplazo' | 'historial' | 'archivo']?:
      (() => Response) | undefined;
  };
} = {}) {
  const aplicaciones: Aplicacion[] = [
    {
      id: APP_VIEJA,
      documentoId: DOC_VIEJO,
      itemId: PRINT_1,
      aplicadaEn: '2026-10-05T12:00:00.000Z',
      reemplazadaEn: '2026-10-08T12:00:00.000Z',
      reemplazaAId: null,
    },
    {
      id: APP_A,
      documentoId: DOC_A,
      itemId: PRINT_1,
      aplicadaEn: '2026-10-08T12:00:00.000Z',
      reemplazadaEn: null,
      reemplazaAId: APP_VIEJA,
    },
  ];
  let siguiente = 5;
  const items = [
    itemJson({ id: FACTURA, tipoDocumentoId: FACTURA_TIPO }),
    itemJson({
      id: PRINT_1,
      tipoDocumentoId: PRINT_TIPO,
      nombreTipoDocumento: 'Print',
      ordinal: 1,
      totalOrdinal: 2,
      completado: true,
      completadoEn: FECHA,
    }),
    itemJson({
      id: PRINT_2,
      tipoDocumentoId: PRINT_TIPO,
      nombreTipoDocumento: 'Print',
      ordinal: 2,
      totalOrdinal: 2,
    }),
  ];
  const vigenteDe = (itemId: string) =>
    aplicaciones.find((a) => a.itemId === itemId && a.reemplazadaEn === null);

  /** Lo que haría otra persona mientras tanto: aplicar o reemplazar el documento de un ítem. */
  const aplicar = (itemId: string, documentoId: string) => {
    const anterior = vigenteDe(itemId);
    const ahora = '2026-10-15T12:00:00.000Z';
    if (anterior !== undefined) anterior.reemplazadaEn = ahora;
    aplicaciones.push({
      id: uuid('a0a0a0a0', siguiente++),
      documentoId,
      itemId,
      aplicadaEn: ahora,
      reemplazadaEn: null,
      reemplazaAId: anterior?.id ?? null,
    });
    const item = items.find((i) => i.id === itemId);
    if (item !== undefined) item.completado = true;
  };

  const detalle = () =>
    json({
      ...rendicionJson(
        estado === 'ANULADA' ? { estado, anuladaEn: '2026-10-20T15:00:00.000Z' } : {},
      ),
      items: items.map((item) => {
        if (sinDocumentos) return item;
        const vigente = vigenteDe(item.id);
        const documento = vigente === undefined ? undefined : documentos[vigente.documentoId];
        return {
          ...item,
          documento:
            vigente === undefined || documento === undefined
              ? null
              : {
                  aplicacionId: vigente.id,
                  documentoId: vigente.documentoId,
                  nombreOriginal: documento.nombreOriginal,
                  tipoContenido: 'application/pdf',
                  tamanioBytes: 2048,
                  aplicadaEn: vigente.aplicadaEn,
                },
        };
      }),
    });

  fetchMock.mockImplementation((entrada, init) => {
    const url = new URL(urlDe(entrada));
    const path = url.pathname;
    const metodo = init?.method ?? 'GET';
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (path === '/documentos' && metodo === 'GET') {
      if (fallos.listado !== undefined) return Promise.resolve(fallos.listado());
      const tipo = url.searchParams.get('tipoDocumentoId');
      return Promise.resolve(
        json(
          [DOC_A, DOC_B]
            .map((id) => documentos[id] as DocumentoDePrueba)
            .filter((documento) => documento.tipoDocumentoId === tipo)
            .map((documento) => ({
              ...documentoJson(documento),
              aplicacionesVigentes: aplicaciones.filter(
                (a) => a.documentoId === documento.id && a.reemplazadaEn === null,
              ).length,
            })),
        ),
      );
    }
    const aplicacion = /^\/documentos\/([^/]+)\/aplicaciones$/.exec(path);
    if (aplicacion !== null && metodo === 'POST') {
      if (fallos.aplicar !== undefined) return Promise.resolve(fallos.aplicar());
      const { itemIds } = JSON.parse(init?.body as string) as { itemIds: string[] };
      const documentoId = aplicacion[1] as string;
      for (const itemId of itemIds) aplicar(itemId, documentoId);
      const documento = documentos[documentoId] as DocumentoDePrueba;
      return Promise.resolve(json({ ...documentoJson(documento), aplicaciones: [] }));
    }
    const archivo = /^\/documentos\/([^/]+)\/archivo$/.exec(path);
    if (archivo !== null) {
      if (fallos.archivo !== undefined) return Promise.resolve(fallos.archivo());
      return Promise.resolve(new Response(new Blob(['%PDF-1.4']), { status: 200 }));
    }
    const reemplazo = /^\/rendiciones\/[^/]+\/items\/([^/]+)\/reemplazo$/.exec(path);
    if (reemplazo !== null && metodo === 'POST') {
      if (fallos.reemplazo !== undefined) return Promise.resolve(fallos.reemplazo());
      const itemId = reemplazo[1] as string;
      const { documentoId, aplicacionVigenteId } = JSON.parse(init?.body as string) as {
        documentoId: string;
        aplicacionVigenteId: string;
      };
      if (vigenteDe(itemId)?.id !== aplicacionVigenteId) {
        return Promise.resolve(
          errorJson(409, 'CONFLICT', {
            motivo: 'APLICACION_DESACTUALIZADA',
            aplicacionVigenteId: vigenteDe(itemId)?.id ?? null,
          }),
        );
      }
      aplicar(itemId, documentoId);
      return Promise.resolve(detalle());
    }
    const historial = /^\/rendiciones\/[^/]+\/items\/([^/]+)\/aplicaciones$/.exec(path);
    if (historial !== null) {
      if (fallos.historial !== undefined) return Promise.resolve(fallos.historial());
      const itemId = historial[1] as string;
      return Promise.resolve(
        json({
          itemChecklistId: itemId,
          aplicaciones: aplicaciones
            .filter((a) => a.itemId === itemId)
            .reverse()
            .map((a) => ({
              id: a.id,
              documentoId: a.documentoId,
              itemChecklistId: a.itemId,
              estado: a.reemplazadaEn === null ? 'VIGENTE' : 'REEMPLAZADA',
              aplicadaEn: a.aplicadaEn,
              reemplazadaEn: a.reemplazadaEn,
              reemplazaAId: a.reemplazaAId,
              documento: documentoJson(documentos[a.documentoId] as DocumentoDePrueba),
            })),
        }),
      );
    }
    if (path.startsWith('/rendiciones/')) return Promise.resolve(detalle());
    return Promise.resolve(json(clienteJson));
  });

  return { aplicar };
}

function renderDetalle() {
  const router = createMemoryRouter(
    [
      { path: '/clientes/:id/rendiciones/:rendicionId', element: <RendicionDetallePage /> },
      { path: '/documentos/archivos', element: <h1>Archivos</h1> },
    ],
    { initialEntries: [`/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router };
}

const cargado = () => screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
const fila = (nombre: string) =>
  screen.getByText(nombre, { selector: 'label, p' }).closest('li') as HTMLElement;
const panel = (nombre: string | RegExp) => screen.findByRole('dialog', { name: nombre });
const llamadas = (metodo: string, path: string | RegExp) =>
  fetchMock.mock.calls.filter(([entrada, init]) => {
    const actual = new URL(urlDe(entrada)).pathname;
    return (
      (init?.method ?? 'GET') === metodo &&
      (typeof path === 'string' ? actual === path : path.test(actual))
    );
  });
const cuerpoDe = (llamada: Parameters<typeof fetch> | undefined) =>
  JSON.parse(llamada?.[1]?.body as string) as unknown;

describe('RendicionDetallePage: documentos del checklist', () => {
  it('muestra el archivo vigente de un ítem completado y la acción de asociar en los pendientes', async () => {
    servir();
    renderDetalle();
    await cargado();

    const print1 = within(fila('Print 1 de 2'));
    expect(print1.getByText('print-octubre.pdf')).toBeInTheDocument();
    expect(print1.getByRole('button', { name: 'Descargar print-octubre.pdf' })).toBeVisible();
    expect(
      print1.getByRole('button', { name: 'Reemplazar documento de Print 1 de 2' }),
    ).toBeVisible();
    expect(print1.getByRole('button', { name: 'Ver historial de Print 1 de 2' })).toBeVisible();
    expect(
      print1.queryByRole('button', { name: /^Asociar documento existente/ }),
    ).not.toBeInTheDocument();

    const print2 = within(fila('Print 2 de 2'));
    expect(print2.getByText('Sin documento')).toBeInTheDocument();
    expect(
      print2.getByRole('button', { name: 'Asociar documento existente a Print 2 de 2' }),
    ).toBeVisible();
    expect(print2.queryByRole('button', { name: /^Reemplazar documento/ })).not.toBeInTheDocument();
  });

  it('asocia un documento compatible a un ítem pendiente y refresca el checklist', async () => {
    servir();
    const { user } = renderDetalle();
    await cargado();
    // Pendiente: todavía no se puede elegir para enviar (HU2.5 con HU2.8).
    expect(screen.getByRole('checkbox', { name: 'Print 2 de 2' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.click(
      screen.getByRole('button', { name: 'Asociar documento existente a Print 2 de 2' }),
    );
    const sheet = within(await panel('Asociar documento existente'));
    expect(sheet.getByText(/Print 2 de 2 · Factura/)).toBeInTheDocument();
    const opcion = await sheet.findByRole('radio', { name: /print-octubre-v2\.pdf/ });
    expect(sheet.getByRole('radio', { name: /print-octubre\.pdf/ })).toBeInTheDocument();
    // Solo documentos del tipo del ítem (su snapshot) y del período de la rendición.
    const [listado] = llamadas('GET', '/documentos');
    expect(new URL(urlDe(listado?.[0] as string)).searchParams.toString()).toBe(
      `anio=2026&mes=10&tipoDocumentoId=${PRINT_TIPO}`,
    );
    const asociar = sheet.getByRole('button', { name: 'Asociar documento' });
    expect(asociar).toBeDisabled();

    await user.click(opcion);
    await user.click(asociar);

    expect(await screen.findByText('Se asoció print-octubre-v2.pdf a Print 2 de 2.')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [post] = llamadas('POST', `/documentos/${DOC_B}/aplicaciones`);
    expect(cuerpoDe(post)).toEqual({ itemIds: [PRINT_2] });
    const print2 = within(fila('Print 2 de 2'));
    expect(print2.getByText('Reunido')).toBeInTheDocument();
    expect(print2.getByText('print-octubre-v2.pdf')).toBeInTheDocument();
    expect(screen.getByText('Avance').nextElementSibling).toHaveTextContent('2 de 3 reunidos');
    // Con su documento vigente ya se puede elegir para enviar, sin recargar la página.
    expect(screen.getByRole('checkbox', { name: 'Print 2 de 2' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });

  it('sin documentos compatibles lo dice y lleva al repositorio con el período y el tipo', async () => {
    servir();
    const { user, router } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Asociar documento existente a Factura' }));
    const sheet = within(await panel('Asociar documento existente'));

    expect(await sheet.findByText(/Todavía no hay documentos de/)).toHaveTextContent(
      'Todavía no hay documentos de Factura cargados para Octubre 2026.',
    );
    expect(sheet.getByRole('button', { name: 'Asociar documento' })).toBeDisabled();
    await user.click(sheet.getByRole('link', { name: 'Cargar uno en Archivos' }));
    expect(router.state.location.pathname).toBe('/documentos/archivos');
    expect(router.state.location.search).toBe(`?anio=2026&mes=10&tipo=${FACTURA_TIPO}`);
  });

  it('si otra persona lo asoció mientras tanto, lo avisa y muestra el documento de ahora', async () => {
    const servidor = servir({
      fallos: {
        aplicar: () => {
          servidor.aplicar(PRINT_2, DOC_A);
          return errorJson(409, 'CONFLICT', { motivo: 'ITEM_NO_PENDIENTE', itemId: PRINT_2 });
        },
      },
    });
    const { user } = renderDetalle();
    await cargado();

    await user.click(
      screen.getByRole('button', { name: 'Asociar documento existente a Print 2 de 2' }),
    );
    const sheet = within(await panel('Asociar documento existente'));
    await user.click(await sheet.findByRole('radio', { name: /print-octubre-v2\.pdf/ }));
    await user.click(sheet.getByRole('button', { name: 'Asociar documento' }));

    expect(
      await sheet.findByText(
        'Este ítem ya tiene un documento: lo asociaron mientras tanto. Actualizamos el checklist.',
      ),
    ).toBeVisible();
    expect(sheet.getByRole('button', { name: 'Asociar documento' })).toBeDisabled();
    await waitFor(() =>
      expect(within(fila('Print 2 de 2')).getByText('print-octubre.pdf')).toBeInTheDocument(),
    );
  });

  it('si el listado de documentos falla, deja reintentar', async () => {
    let fallar = true;
    servir({
      fallos: {
        get listado() {
          return fallar ? () => errorJson(500, 'INTERNAL_ERROR') : undefined;
        },
      },
    });
    const { user } = renderDetalle();
    await cargado();

    await user.click(
      screen.getByRole('button', { name: 'Asociar documento existente a Print 2 de 2' }),
    );
    const sheet = within(await panel('Asociar documento existente'));
    expect(await sheet.findByText('No pudimos cargar los documentos del período.')).toBeVisible();

    fallar = false;
    await user.click(sheet.getByRole('button', { name: 'Reintentar' }));
    expect(await sheet.findByRole('radio', { name: /print-octubre-v2\.pdf/ })).toBeVisible();
  });

  it('mientras busca los documentos lo anuncia, y si el backend no los tiene habilitados lo dice', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    servir();
    // El listado queda en espera hasta que el test lo responda.
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((entrada, init) =>
      new URL(urlDe(entrada)).pathname === '/documentos'
        ? new Promise<Response>((resolver) => {
            responder = resolver;
          })
        : (original as typeof fetch)(entrada, init),
    );
    const { user } = renderDetalle();
    await cargado();

    await user.click(
      screen.getByRole('button', { name: 'Asociar documento existente a Print 2 de 2' }),
    );
    const sheet = within(await panel('Asociar documento existente'));
    expect(sheet.getByRole('status')).toHaveTextContent('Buscando documentos compatibles…');

    responder(errorJson(404, 'NOT_FOUND'));
    expect(
      await sheet.findByText('Los documentos no están habilitados en este entorno.'),
    ).toBeVisible();
    expect(sheet.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('descarga el archivo vigente a través del backend con su nombre original', async () => {
    servir();
    const crear = vi.fn(() => 'blob:prueba');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() }));
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('print-octubre.pdf');
    });
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Descargar print-octubre.pdf' }));

    await waitFor(() => expect(clic).toHaveBeenCalledTimes(1));
    expect(llamadas('GET', `/documentos/${DOC_A}/archivo`)).toHaveLength(1);
  });

  it('si la descarga falla, lo avisa en el checklist', async () => {
    servir({ fallos: { archivo: () => errorJson(503, 'SERVICE_UNAVAILABLE') } });
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Descargar print-octubre.pdf' }));

    expect(
      await screen.findByText('No se pudo descargar print-octubre.pdf. Probá de nuevo.'),
    ).toBeVisible();
  });

  it('reemplaza el documento vigente después de confirmarlo, solo en ese ítem', async () => {
    servir();
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Reemplazar documento de Print 1 de 2' }));
    const sheet = within(await panel('Reemplazar documento'));
    expect(sheet.getByText('Actual')).toBeInTheDocument();
    // El vigente no se ofrece como nuevo.
    const nuevo = await sheet.findByRole('radio', { name: /print-octubre-v2\.pdf/ });
    expect(sheet.getAllByRole('radio')).toHaveLength(1);
    await user.click(nuevo);
    await user.click(sheet.getByRole('button', { name: 'Reemplazar documento' }));

    expect(sheet.getByText(/Vas a reemplazar/)).toHaveTextContent(
      'Vas a reemplazar print-octubre.pdf por print-octubre-v2.pdf en Print 1 de 2.',
    );
    expect(sheet.getByText(/sigue igual en los otros ítems/)).toBeInTheDocument();
    expect(llamadas('POST', /\/reemplazo$/)).toHaveLength(0);
    await user.click(sheet.getByRole('button', { name: 'Sí, reemplazar' }));

    expect(
      await screen.findByText(
        'Se reemplazó print-octubre.pdf por print-octubre-v2.pdf en Print 1 de 2.',
      ),
    ).toBeVisible();
    const [post] = llamadas('POST', `/rendiciones/${RENDICION_ID}/items/${PRINT_1}/reemplazo`);
    expect(cuerpoDe(post)).toEqual({ documentoId: DOC_B, aplicacionVigenteId: APP_A });
    await waitFor(() =>
      expect(within(fila('Print 1 de 2')).getByText('print-octubre-v2.pdf')).toBeInTheDocument(),
    );
  });

  it('desde la confirmación se puede volver a elegir sin reemplazar', async () => {
    servir();
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Reemplazar documento de Print 1 de 2' }));
    const sheet = within(await panel('Reemplazar documento'));
    await user.click(await sheet.findByRole('radio', { name: /print-octubre-v2\.pdf/ }));
    await user.click(sheet.getByRole('button', { name: 'Reemplazar documento' }));
    await user.click(sheet.getByRole('button', { name: 'Volver' }));

    expect(sheet.getByRole('radio', { name: /print-octubre-v2\.pdf/ })).toBeChecked();
    expect(llamadas('POST', /\/reemplazo$/)).toHaveLength(0);
  });

  it('ante un 409 APLICACION_DESACTUALIZADA refresca y pide volver a elegir', async () => {
    const servidor = servir();
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Reemplazar documento de Print 1 de 2' }));
    const sheet = within(await panel('Reemplazar documento'));
    await user.click(await sheet.findByRole('radio', { name: /print-octubre-v2\.pdf/ }));
    await user.click(sheet.getByRole('button', { name: 'Reemplazar documento' }));
    // Otra persona lo reemplazó mientras tanto: la aplicación vista ya no es la vigente.
    servidor.aplicar(PRINT_1, DOC_B);
    await user.click(sheet.getByRole('button', { name: 'Sí, reemplazar' }));

    expect(await sheet.findByText(/El documento de este ítem cambió mientras tanto/)).toBeVisible();
    // El actual es el de ahora y el que se había elegido ya no se ofrece.
    await waitFor(() =>
      expect(sheet.getByRole('radio', { name: /print-octubre\.pdf/ })).not.toBeChecked(),
    );
    expect(sheet.queryByRole('radio', { name: /print-octubre-v2\.pdf/ })).not.toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Reemplazar documento' })).toBeDisabled();
    expect(within(fila('Print 1 de 2')).getByText('print-octubre-v2.pdf')).toBeInTheDocument();
  });

  it('muestra el historial del ítem con el vigente, las fechas y la descarga de los anteriores', async () => {
    servir();
    const crear = vi.fn(() => 'blob:prueba');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Ver historial de Print 1 de 2' }));
    const sheet = within(await panel('Historial de Print 1 de 2'));
    const filas = within(
      await sheet.findByRole('list', { name: 'Documentos del ítem' }),
    ).getAllByRole('listitem');

    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('print-octubre.pdf');
    expect(filas[0]).toHaveTextContent('Vigente');
    expect(filas[0]).not.toHaveTextContent('reemplazado el');
    expect(filas[1]).toHaveTextContent('print-viejo.pdf');
    expect(filas[1]).toHaveTextContent('Reemplazado');
    expect(filas[1]).toHaveTextContent(/Asociado el .+ · reemplazado el .+/);

    await user.click(sheet.getByRole('button', { name: 'Descargar print-viejo.pdf' }));
    await waitFor(() =>
      expect(llamadas('GET', `/documentos/${DOC_VIEJO}/archivo`)).toHaveLength(1),
    );
  });

  it('si el historial falla, deja reintentar; un ítem sin documentos lo dice', async () => {
    let fallar = true;
    servir({
      fallos: {
        get historial() {
          return fallar ? () => errorJson(500, 'INTERNAL_ERROR') : undefined;
        },
      },
    });
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Ver historial de Print 1 de 2' }));
    const sheet = within(await panel('Historial de Print 1 de 2'));
    expect(await sheet.findByText('No pudimos cargar el historial.')).toBeVisible();

    fallar = false;
    await user.click(sheet.getByRole('button', { name: 'Reintentar' }));
    expect(await sheet.findByText('print-viejo.pdf')).toBeVisible();
  });

  it('en una rendición anulada se ve y descarga el documento, pero no se asocia ni reemplaza', async () => {
    servir({ estado: 'ANULADA' });
    const { user } = renderDetalle();
    await cargado();

    const print1 = within(fila('Print 1 de 2'));
    expect(print1.getByText('print-octubre.pdf')).toBeInTheDocument();
    expect(print1.getByRole('button', { name: 'Descargar print-octubre.pdf' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Reemplazar documento/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Asociar documento existente/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Sin documento')).not.toBeInTheDocument();

    await user.click(print1.getByRole('button', { name: 'Ver historial de Print 1 de 2' }));
    expect(await screen.findByRole('dialog', { name: 'Historial de Print 1 de 2' })).toBeVisible();
  });

  it('si la API no informa el documento de los ítems, el checklist queda como antes', async () => {
    servir({ sinDocumentos: true });
    renderDetalle();
    await cargado();

    expect(screen.queryByText('Sin documento')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Asociar documento/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ver historial/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar el canal de Factura' })).toBeVisible();
  });
});
