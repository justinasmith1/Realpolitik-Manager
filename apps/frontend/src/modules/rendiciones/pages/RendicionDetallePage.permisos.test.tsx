// El detalle de una rendición según el rol (HU4.3). CONSULTA lee todo (datos, OC y montos,
// estado e historial, motivo de rechazo, cobro, checklist con "Ver solo faltantes", descargas e
// historial de cada documento) y no tiene ninguna acción que escriba: ni cambios de estado, ni
// "Editar OC", ni cobro, ni casillas de envío, ni canal, ni asociar o reemplazar documentos; tampoco
// deshabilitadas. ADMINISTRATIVO y ADMINISTRADOR conservan sus operaciones en cada estado.

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  ARIA_RESPUESTA_APROBADA,
  ARIA_RESPUESTA_RECHAZADA,
  TEXTO_CORREGIR_RENDICION,
  TEXTO_EDITAR_COBRO,
  TEXTO_MARCAR_COMPLETA,
  TEXTO_MARCAR_ENVIADA,
  TEXTO_QUITAR_COBRO,
  TEXTO_REGISTRAR_COBRO,
  TEXTO_RENDICION_RECHAZADA,
  TEXTO_RENDICION_YA_ENVIADA,
  TEXTO_SIN_COBRO,
  TEXTO_VOLVER_A_EN_CURSO,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import {
  CLIENTE_ID,
  documentoJson,
  itemJson,
  itemReunidoJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

const fetchMock = vi.fn<typeof fetch>();

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
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const FACTURA = 'f1a2b3c4-d5e6-4789-8abc-def012345670';
const PRINT = 'f1a2b3c4-d5e6-4789-8abc-def012345671';
const DOC = 'b1c2d3e4-f5a6-4789-8abc-000000000201';

/** Un ítem reunido con su documento vigente y uno pendiente, sin documento. */
const ITEMS = [
  itemReunidoJson({
    id: FACTURA,
    nombreTipoDocumento: 'Factura',
    documento: documentoJson({ documentoId: DOC, nombreOriginal: 'factura-octubre.pdf' }),
  }),
  itemJson({
    id: PRINT,
    nombreTipoDocumento: 'Print',
    canalEntrega: 'PORTAL_WEB',
    documento: null,
  }),
];

const OC = { numeroOc: 'OC-2026-88', montoMensual: 1250000, montoTotal: 15000000 };

const HISTORIAL = {
  EN_CURSO: [{ estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-15T15:00:00.000Z' }],
  COMPLETA: [
    { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-15T15:00:00.000Z' },
    { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-10-19T12:00:00.000Z' },
  ],
  ENVIADA: [
    { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-15T15:00:00.000Z' },
    { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-10-19T12:00:00.000Z' },
    {
      estadoAnterior: 'COMPLETA',
      estadoNuevo: 'ENVIADA',
      fecha: '2026-10-20T12:00:00.000Z',
      fechaEfectiva: '2026-10-20',
    },
  ],
};
const HISTORIAL_APROBADA = [
  ...HISTORIAL.ENVIADA,
  { estadoAnterior: 'ENVIADA', estadoNuevo: 'APROBADA', fecha: '2026-11-02T12:00:00.000Z' },
];
const MOTIVO = 'Falta la firma del intendente';
const HISTORIAL_RECHAZADA = [
  ...HISTORIAL.ENVIADA,
  {
    estadoAnterior: 'ENVIADA',
    estadoNuevo: 'RECHAZADA',
    fecha: '2026-11-05T15:00:00.000Z',
    motivo: MOTIVO,
  },
];

/** Las seis situaciones de la épica 3 que tiene que leer CONSULTA. */
const CASOS = {
  'En curso': { estado: 'EN_CURSO', historial: HISTORIAL.EN_CURSO },
  Completa: { estado: 'COMPLETA', historial: HISTORIAL.COMPLETA },
  Enviada: { estado: 'ENVIADA', historial: HISTORIAL.ENVIADA },
  Aprobada: { estado: 'APROBADA', historial: HISTORIAL_APROBADA },
  Rechazada: { estado: 'RECHAZADA', historial: HISTORIAL_RECHAZADA },
  Anulada: {
    estado: 'EN_CURSO',
    historial: HISTORIAL.EN_CURSO,
    vigencia: 'ANULADA',
    anuladaEn: '2026-10-20T15:00:00.000Z',
  },
} as const;

const COBRO = { fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' };

function servir(extra: Record<string, unknown> = {}) {
  const detalle = { ...rendicionJson({ ...OC, ...extra }), items: ITEMS };
  fetchMock.mockImplementation((entrada, init) => {
    // Este backend solo atiende lecturas: una escritura se registra y falla.
    if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json({}, 500));
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: 'Un PDF por factura.' }));
    }
    if (path === `/documentos/${DOC}/archivo`) {
      return Promise.resolve(
        new Response('%PDF-1.4', { headers: { 'Content-Type': 'application/pdf' } }),
      );
    }
    if (path === `/rendiciones/${RENDICION_ID}/items/${FACTURA}/aplicaciones`) {
      return Promise.resolve(
        json({
          itemChecklistId: FACTURA,
          aplicaciones: [
            {
              id: 'b1c2d3e4-f5a6-4789-8abc-000000000101',
              documentoId: DOC,
              itemChecklistId: FACTURA,
              estado: 'VIGENTE',
              aplicadaEn: '2026-10-15T15:00:00.000Z',
              reemplazadaEn: null,
              reemplazaAId: null,
              documento: {
                id: DOC,
                tipoDocumento: { id: 'c1d2e3f4-a5b6-4789-8abc-def012345678', nombre: 'Factura' },
                anio: 2026,
                mes: 10,
                nombreOriginal: 'factura-octubre.pdf',
                tipoContenido: 'application/pdf',
                tamanioBytes: 1024,
                creadoEn: '2026-10-15T15:00:00.000Z',
                actualizadoEn: '2026-10-15T15:00:00.000Z',
              },
            },
          ],
        }),
      );
    }
    if (path.startsWith('/rendiciones/')) return Promise.resolve(json(detalle));
    return Promise.resolve(json(clienteJson));
  });
}

function renderDetalle(rol: RolUsuarioType) {
  const router = createMemoryRouter(
    [
      { path: '/clientes/:id/rendiciones/:rendicionId', element: <RendicionDetallePage /> },
      { path: '/clientes/:id/matriz', element: <h1>Matriz del cliente</h1> },
    ],
    { initialEntries: [`/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`] },
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

const cargado = () => screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

const datoDeCabecera = (etiqueta: string) => {
  const termino = screen.getByText(etiqueta, { selector: 'dt' });
  return within(termino.parentElement as HTMLElement).getByRole('definition');
};

const fila = (nombre: string) => {
  const nombreEnLaFila = screen
    .getAllByText(nombre)
    .find((elemento) => elemento.closest('li') !== null);
  return nombreEnLaFila?.closest('li') as HTMLElement;
};

/** Toda acción que escribe, por su nombre accesible. Ninguna puede estar, ni deshabilitada. */
const ESCRITURAS: RegExp[] = [
  new RegExp(`^${TEXTO_MARCAR_COMPLETA}$`),
  new RegExp(`^${TEXTO_VOLVER_A_EN_CURSO}$`),
  new RegExp(`^${TEXTO_CORREGIR_RENDICION}$`),
  new RegExp(`^${TEXTO_MARCAR_ENVIADA}$`),
  new RegExp(`^${ARIA_RESPUESTA_APROBADA}$`),
  new RegExp(`^${ARIA_RESPUESTA_RECHAZADA}$`),
  /^Editar OC$/,
  new RegExp(`^${TEXTO_REGISTRAR_COBRO}$`),
  new RegExp(`^${TEXTO_EDITAR_COBRO}$`),
  new RegExp(`^${TEXTO_QUITAR_COBRO}$`),
  /^Enviar/,
  /^Cambiar el canal/,
  /^Reemplazar documento/,
  /^Asociar documento/,
];

function sinAccionesDeEscritura() {
  for (const nombre of ESCRITURAS) {
    expect(screen.queryAllByRole('button', { name: nombre }), String(nombre)).toEqual([]);
  }
  expect(screen.queryByRole('group', { name: 'Cambiar el estado' })).not.toBeInTheDocument();
  // La única casilla es el filtro "Ver solo faltantes": no hay casillas de envío.
  expect(screen.getAllByRole('checkbox')).toEqual([
    screen.getByRole('checkbox', { name: /Ver solo faltantes/ }),
  ]);
}

const soloLecturas = () =>
  expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ now: new Date('2026-11-13T15:00:00.000Z'), toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe.each(Object.entries(CASOS))('Detalle con CONSULTA: rendición %s', (_nombre, caso) => {
  it('muestra datos, OC, montos, estado e historial, sin ninguna acción de escritura', async () => {
    servir(caso);
    const { user } = renderDetalle('CONSULTA');
    await cargado();

    expect(datoDeCabecera('Número de factura')).toHaveTextContent('A 00001-00000001');
    expect(datoDeCabecera('Número de OC')).toHaveTextContent('OC-2026-88');
    expect(datoDeCabecera('Monto mensual').textContent?.replace(/\s/g, ' ')).toBe('$ 1.250.000');
    expect(datoDeCabecera('Monto total').textContent?.replace(/\s/g, ' ')).toBe('$ 15.000.000');
    expect(datoDeCabecera('Emisor')).toHaveTextContent('Realpolitik');
    expect(screen.getByText('Vigencia').nextElementSibling).toHaveTextContent(
      'vigencia' in caso ? 'Anulada' : 'Activa',
    );
    expect(screen.getByText('Avance').nextElementSibling).toHaveTextContent('1 de 2 reunidos');
    expect(await screen.findByText('Un PDF por factura.')).toBeInTheDocument();

    // El historial de estados se despliega y lista cada paso.
    await user.click(screen.getByRole('button', { name: /^Historial/ }));
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(caso.historial.length);

    sinAccionesDeEscritura();
    soloLecturas();
  });
});

describe('Detalle con CONSULTA: estados, cobro y avisos', () => {
  it('una Rechazada muestra el motivo, sin invitar a corregirla', async () => {
    servir(CASOS.Rechazada);
    renderDetalle('CONSULTA');
    await cargado();

    // En el aviso del rechazo (y en el historial, que está plegado).
    expect(screen.getAllByText(new RegExp(MOTIVO)).length).toBeGreaterThan(0);
    expect(screen.queryByText(TEXTO_RENDICION_RECHAZADA)).not.toBeInTheDocument();
  });

  it('una Enviada muestra su fecha de envío, sin el aviso de que no se pueden cambiar documentos', async () => {
    servir(CASOS.Enviada);
    renderDetalle('CONSULTA');
    await cargado();

    expect(screen.getByText('Estado').nextElementSibling).toHaveTextContent('20/10/2026');
    expect(screen.queryByText(TEXTO_RENDICION_YA_ENVIADA)).not.toBeInTheDocument();
  });

  it('una Anulada muestra cuándo se anuló', async () => {
    servir(CASOS.Anulada);
    renderDetalle('CONSULTA');
    await cargado();

    expect(screen.getByText(/Anulada el 20 de octubre de 2026/)).toBeInTheDocument();
  });

  it('con cobro: la fecha y la nota, sin botones', async () => {
    servir({ ...CASOS.Enviada, cobro: COBRO });
    renderDetalle('CONSULTA');
    await cargado();

    const franja = within(screen.getByRole('region', { name: 'Cobro' }));
    expect(franja.getByText('Cobrada el 10/11/2026')).toBeInTheDocument();
    expect(franja.getByText(COBRO.nota)).toBeInTheDocument();
    expect(franja.queryAllByRole('button')).toEqual([]);
  });

  it('cobrable sin cobro: "Sin cobro registrado", sin ofrecer registrarlo', async () => {
    servir(CASOS.Aprobada);
    renderDetalle('CONSULTA');
    await cargado();

    const franja = within(screen.getByRole('region', { name: 'Cobro' }));
    expect(franja.getByText(TEXTO_SIN_COBRO)).toBeInTheDocument();
    expect(franja.queryAllByRole('button')).toEqual([]);
  });
});

describe('Detalle con CONSULTA: checklist y documentos', () => {
  it('cada ítem muestra estado y canal; el reunido, su documento; el pendiente, "Sin documento" y ninguna acción', async () => {
    servir(CASOS['En curso']);
    renderDetalle('CONSULTA');
    await cargado();

    const factura = within(fila('Factura'));
    expect(factura.getByText('Reunido')).toBeInTheDocument();
    expect(factura.getByText('Correo')).toBeInTheDocument();
    expect(factura.getByText('factura-octubre.pdf')).toBeInTheDocument();
    expect(factura.getByRole('button', { name: 'Descargar factura-octubre.pdf' })).toBeEnabled();
    expect(factura.getByRole('button', { name: 'Ver historial de Factura' })).toBeEnabled();

    const print = within(fila('Print'));
    expect(print.getByText('Pendiente')).toBeInTheDocument();
    expect(print.getByText('Portal web')).toBeInTheDocument();
    expect(print.getByText('Sin documento')).toBeInTheDocument();
    expect(print.queryAllByRole('button')).toEqual([]);
  });

  it('"Ver solo faltantes" deja solo los pendientes', async () => {
    servir(CASOS['En curso']);
    const { user } = renderDetalle('CONSULTA');
    await cargado();

    await user.click(screen.getByRole('checkbox', { name: /Ver solo faltantes/ }));

    expect(screen.queryByText('factura-octubre.pdf')).not.toBeInTheDocument();
    expect(fila('Print')).toBeInTheDocument();
  });

  it('descarga el documento y consulta su historial, solo con lecturas', async () => {
    servir(CASOS.Enviada);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:prueba'), revokeObjectURL: vi.fn() }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { user } = renderDetalle('CONSULTA');
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Descargar factura-octubre.pdf' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([e]) => new URL(urlDe(e)).pathname)).toContain(
        `/documentos/${DOC}/archivo`,
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Ver historial de Factura' }));
    const historial = within(await screen.findByRole('dialog', { name: 'Historial de Factura' }));
    expect(await historial.findByText('factura-octubre.pdf')).toBeInTheDocument();
    expect(historial.queryByRole('button', { name: /Reemplazar|Asociar|Aplicar/ })).toBeNull();

    soloLecturas();
    const pedidos = fetchMock.mock.calls.map(([e]) => new URL(urlDe(e)).pathname);
    expect(pedidos.some((p) => p.endsWith('/candidatos') || p.endsWith('/preparar-envio'))).toBe(
      false,
    );
  });

  it('"Volver a los requisitos del cliente" lleva a la matriz', async () => {
    servir(CASOS['En curso']);
    const { router, user } = renderDetalle('CONSULTA');
    await cargado();

    await user.click(screen.getByRole('link', { name: 'Volver a los requisitos del cliente' }));

    expect(router.state.location.pathname).toBe(`/clientes/${CLIENTE_ID}/matriz`);
  });
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('Detalle con %s', (rol) => {
  it('En curso: cambio de estado, Editar OC, envío, canal y asociar documento', async () => {
    servir(CASOS['En curso']);
    renderDetalle(rol);
    await cargado();

    expect(screen.getByRole('group', { name: 'Cambiar el estado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TEXTO_MARCAR_COMPLETA })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar OC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Enviar/ })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Cambiar el canal de Print' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Asociar documento existente a Print' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reemplazar documento de Factura' })).toBeEnabled();
  });

  it('Enviada: responde, registra el cobro y muestra deshabilitado lo bloqueado, con su motivo', async () => {
    servir(CASOS.Enviada);
    renderDetalle(rol);
    await cargado();

    expect(screen.getByRole('button', { name: ARIA_RESPUESTA_APROBADA })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ARIA_RESPUESTA_RECHAZADA })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TEXTO_REGISTRAR_COBRO })).toBeInTheDocument();
    expect(screen.getByText(TEXTO_RENDICION_YA_ENVIADA)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar el canal de Print' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reemplazar documento de Factura' })).toBeDisabled();
  });

  it('con cobro en una Enviada: lo edita y lo quita', async () => {
    servir({ ...CASOS.Enviada, cobro: COBRO });
    renderDetalle(rol);
    await cargado();

    const franja = within(screen.getByRole('region', { name: 'Cobro' }));
    expect(franja.getByRole('button', { name: TEXTO_EDITAR_COBRO })).toBeInTheDocument();
    expect(franja.getByRole('button', { name: TEXTO_QUITAR_COBRO })).toBeInTheDocument();
  });

  it('Rechazada: ofrece corregirla y explica cómo', async () => {
    servir(CASOS.Rechazada);
    renderDetalle(rol);
    await cargado();

    expect(screen.getByRole('button', { name: TEXTO_CORREGIR_RENDICION })).toBeInTheDocument();
    expect(screen.getByText(TEXTO_RENDICION_RECHAZADA)).toBeInTheDocument();
  });
});
