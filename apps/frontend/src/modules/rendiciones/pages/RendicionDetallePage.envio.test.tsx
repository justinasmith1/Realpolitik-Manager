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

// Envío por selección (HU2.5 con HU2.8): elegir ítems y ver los datos para mandarlos por su canal.
// El sistema todavía no envía nada: el único pedido que no es de lectura es la preparación
// (`POST /rendiciones/:id/preparar-envio`), que solo valida y no guarda nada.
//
// Cambio intencional (HU2.8, bloque 5): antes se podía elegir cualquier ítem, también uno
// pendiente, y "Enviar" contaba "reunidos o pendientes". Ahora solo se eligen los completados con
// un documento vigente: lo que se envía es el documento, y tiene que existir. Por eso los ítems
// del escenario tienen documento, y los pendientes o completados sin documento se prueban aparte.

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const FECHA = '2026-10-08T12:00:00.000Z';

const clienteJson = (extra: Record<string, unknown> = {}) => ({
  id: CLIENTE_ID,
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: ['tesoreria@municipio.example'],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: true,
  creadoEn: FECHA,
  actualizadoEn: FECHA,
  ...extra,
});

const contactoJson = (n: number, nombre: string, recibeRendiciones: boolean) => ({
  id: `c0c0c0c0-0000-4000-8000-00000000000${n}`,
  clienteId: CLIENTE_ID,
  nombre,
  area: 'Compras',
  email: `${nombre.toLowerCase()}@municipio.example`,
  recibeRendiciones,
});

/** La API de contactos ya no devuelve los dados de baja: Ana recibe rendiciones, Beto no. */
const CONTACTOS = [contactoJson(1, 'Ana', true), contactoJson(2, 'Beto', false)];

const id = (n: number) => `f1a2b3c4-d5e6-4789-8abc-def01234567${n}`;

const documentoJson = (n: number) => ({
  aplicacionId: `a0a0a0a0-0000-4000-8000-00000000000${n}`,
  documentoId: `d0d0d0d0-0000-4000-8000-00000000000${n}`,
  nombreOriginal: `documento-${n}.pdf`,
  tipoContenido: 'application/pdf',
  tamanioBytes: 2048,
  aplicadaEn: '2026-10-16T12:00:00.000Z',
});

/** Un ítem completado con su documento vigente: se puede enviar. */
const conDocumento = (n: number, extra: Record<string, unknown> = {}) =>
  itemJson({
    id: id(n),
    completado: true,
    completadoEn: '2026-10-16T12:00:00.000Z',
    documento: documentoJson(n),
    ...extra,
  });

/**
 * Con documento: Factura (correo), Print 1 de 2 (portal, día 15), Print 2 de 2 (correo) y Remito
 * (WhatsApp). Sin poder enviarse: Nota de crédito (pendiente) y Constancia (figura reunida pero
 * sin aplicación vigente, como un dato anterior a HU2.8).
 */
const itemsIniciales = () => [
  conDocumento(0),
  conDocumento(1, {
    nombreTipoDocumento: 'Print',
    ordinal: 1,
    totalOrdinal: 2,
    diaAproximado: 15,
    canalEntrega: 'PORTAL_WEB',
  }),
  conDocumento(2, { nombreTipoDocumento: 'Print', ordinal: 2, totalOrdinal: 2 }),
  conDocumento(3, { nombreTipoDocumento: 'Remito', canalEntrega: 'WHATSAPP' }),
  itemJson({ id: id(4), nombreTipoDocumento: 'Nota de crédito', documento: null }),
  itemJson({
    id: id(5),
    nombreTipoDocumento: 'Constancia',
    completado: true,
    completadoEn: '2026-10-16T12:00:00.000Z',
    documento: null,
  }),
];

/**
 * Servidor de mentira. La preparación devuelve los ítems pedidos, como el backend cuando todos se
 * pueden enviar; `preparacion` reemplaza esa respuesta. Devuelve el estado: un test lo puede
 * cambiar para simular lo que pasó mientras tanto.
 */
function servir({
  cliente = clienteJson(),
  rendicion = rendicionJson(),
  preparacion,
}: { cliente?: unknown; rendicion?: unknown; preparacion?: () => Response } = {}) {
  const estado = { rendicion, items: itemsIniciales() };
  fetchMock.mockImplementation((entrada, init) => {
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (path.endsWith('/contactos')) return Promise.resolve(json(CONTACTOS));
    if (path.endsWith('/preparar-envio') && init?.method === 'POST') {
      if (preparacion !== undefined) return Promise.resolve(preparacion());
      const { itemIds } = JSON.parse(init.body as string) as { itemIds: string[] };
      const items = estado.items.filter((item) => itemIds.includes(item.id));
      return Promise.resolve(
        json({ rendicionId: RENDICION_ID, canal: items[0]?.canalEntrega, items }),
      );
    }
    if (path.startsWith('/rendiciones/')) {
      return Promise.resolve(json({ ...(estado.rendicion as object), items: estado.items }));
    }
    return Promise.resolve(json(cliente));
  });
  return estado;
}

function renderDetalle() {
  const router = createMemoryRouter(
    [{ path: '/clientes/:id/rendiciones/:rendicionId', element: <RendicionDetallePage /> }],
    { initialEntries: [`/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const casilla = (nombre: string) => screen.getByRole('checkbox', { name: nombre });

/** Espera el detalle, elige los ítems dados y aprieta "Enviar". */
async function enviar(user: ReturnType<typeof userEvent.setup>, ...items: string[]) {
  await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
  await screen.findByText('Muni Ejemplo');
  for (const item of items) await user.click(casilla(item));
  await user.click(screen.getByRole('button', { name: `Enviar (${items.length})` }));
}

const dialogo = (canal: string) =>
  screen.findByRole('alertdialog', { name: `Enviar por ${canal}` });

/** Pedidos que no son de lectura, salvo la preparación (que solo valida): no debe haber ninguno. */
const escrituras = () =>
  fetchMock.mock.calls.filter(
    ([entrada, init]) =>
      (init?.method ?? 'GET') !== 'GET' &&
      !new URL(urlDe(entrada)).pathname.endsWith('/preparar-envio'),
  );

const preparaciones = () =>
  fetchMock.mock.calls.filter(([entrada]) =>
    new URL(urlDe(entrada)).pathname.endsWith('/preparar-envio'),
  );

describe('RendicionDetallePage: envío por selección', () => {
  it('"Enviar" cuenta los elegidos con documento vigente, y sin ninguno está deshabilitado', async () => {
    servir();
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    expect(screen.getByRole('button', { name: 'Enviar (0)' })).toBeDisabled();

    await user.click(casilla('Factura'));
    await user.click(casilla('Print 2 de 2'));

    expect(screen.getByRole('button', { name: 'Enviar (2)' })).toBeEnabled();
  });

  it('un ítem pendiente no se puede elegir y dice por qué', async () => {
    servir();
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    expect(casilla('Nota de crédito')).toHaveAttribute('aria-disabled', 'true');
    expect(casilla('Nota de crédito')).toHaveAccessibleDescription(
      'Para enviarlo, asociale un documento.',
    );
    await user.click(casilla('Nota de crédito'));
    expect(casilla('Nota de crédito')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Enviar (0)' })).toBeDisabled();
  });

  it('no alcanza con estar completado: sin documento vigente no se puede elegir', async () => {
    servir();
    renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    expect(casilla('Constancia')).toHaveAttribute('aria-disabled', 'true');
    expect(casilla('Constancia')).toHaveAccessibleDescription(
      'Figura reunido, pero no tiene un documento vigente: no se envía.',
    );
    // Los que tienen documento sí se eligen, y no llevan explicación.
    expect(casilla('Factura')).not.toHaveAttribute('aria-disabled');
    expect(casilla('Factura')).not.toHaveAccessibleDescription();
  });

  it('el servidor confirma la selección y el diálogo muestra lo que devolvió', async () => {
    servir();
    const { user } = renderDetalle();

    await enviar(user, 'Factura', 'Print 2 de 2');

    const ventana = within(await dialogo('Correo'));
    expect(ventana.getByText('Factura')).toBeInTheDocument();
    const [[, init]] = preparaciones() as [[Parameters<typeof fetch>[0], RequestInit]];
    expect(JSON.parse(init.body as string)).toEqual({ itemIds: [id(0), id(2)] });
  });

  it('si un ítem dejó de poder enviarse entre la selección y el envío, refresca y no abre nada', async () => {
    const estado = servir({
      preparacion: () =>
        errorJson(409, 'CONFLICT', { motivo: 'ITEM_SIN_DOCUMENTO_VIGENTE', itemId: id(2) }),
    });
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    await user.click(casilla('Factura'));
    await user.click(casilla('Print 2 de 2'));
    // Mientras tanto, Print 2 de 2 quedó sin documento vigente (un dato que cambió en la base).
    const print2 = estado.items[2];
    if (print2 !== undefined) Object.assign(print2, { documento: null });

    await user.click(screen.getByRole('button', { name: 'Enviar (2)' }));

    expect(
      await screen.findByText(
        'Print 2 de 2 no tiene un documento vigente: no se puede enviar. Actualizamos el checklist: revisá la selección.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(casilla('Print 2 de 2')).toHaveAttribute('aria-disabled', 'true'));
    expect(casilla('Factura')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Enviar (1)' })).toBeEnabled();
  });

  it('si la rendición se anuló entre la selección y el envío, lo avisa y la muestra anulada', async () => {
    const estado = servir({
      preparacion: () => errorJson(409, 'CONFLICT', { motivo: 'RENDICION_ANULADA' }),
    });
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    await user.click(casilla('Factura'));
    estado.rendicion = rendicionJson({ estado: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' });

    await user.click(screen.getByRole('button', { name: 'Enviar (1)' }));

    expect(await screen.findByText(/Se conserva como historial/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Enviar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('con canales mezclados avisa, no abre nada y conserva la selección', async () => {
    servir();
    const { user } = renderDetalle();

    await enviar(user, 'Factura', 'Print 1 de 2', 'Remito');

    expect(
      screen.getByText(
        'Los ítems seleccionados se envían por canales distintos (Correo, Portal web, WhatsApp). Separalos en envíos distintos.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(casilla('Factura')).toBeChecked();
    expect(casilla('Print 1 de 2')).toBeChecked();
    expect(casilla('Remito')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Enviar (3)' })).toBeEnabled();
    // Los canales mezclados se avisan sin ir al servidor.
    expect(preparaciones()).toEqual([]);
  });

  describe('por correo', () => {
    it('muestra el email del cliente, los adicionales y solo los contactos que reciben rendiciones', async () => {
      servir();
      const { user } = renderDetalle();

      await enviar(user, 'Factura', 'Print 2 de 2');

      const ventana = within(await dialogo('Correo'));
      expect(await ventana.findByText('ana@municipio.example')).toBeInTheDocument();
      expect(ventana.getByText('compras@municipio.example')).toBeInTheDocument();
      expect(ventana.getByText('tesoreria@municipio.example')).toBeInTheDocument();
      expect(ventana.getByText('Ana · Compras')).toBeInTheDocument();
      expect(ventana.queryByText('beto@municipio.example')).not.toBeInTheDocument();
      // Los dados de baja los filtra la API: se piden a la consulta de contactos vigentes.
      expect(
        fetchMock.mock.calls.some(
          ([entrada]) => new URL(urlDe(entrada)).pathname === `/clientes/${CLIENTE_ID}/contactos`,
        ),
      ).toBe(true);
      expect(ventana.getByText('Factura')).toBeInTheDocument();
      expect(ventana.getByText('Print 2 de 2')).toBeInTheDocument();
    });

    it('avisa que el envío automático todavía no está y no hace ningún pedido de envío', async () => {
      servir();
      const { user } = renderDetalle();

      await enviar(user, 'Factura');

      const ventana = within(await dialogo('Correo'));
      expect(
        ventana.getByText(
          'El envío automático por correo todavía no está disponible. Por ahora usá estos datos para mandarlo vos.',
        ),
      ).toBeInTheDocument();
      expect(ventana.queryByRole('link')).not.toBeInTheDocument();
      expect(escrituras()).toEqual([]);
    });

    it('"Copiar destinatarios" copia los emails separados por coma', async () => {
      servir();
      const { user } = renderDetalle();
      await enviar(user, 'Factura');
      const ventana = within(await dialogo('Correo'));
      await ventana.findByText('ana@municipio.example');

      await user.click(ventana.getByRole('button', { name: 'Copiar destinatarios' }));

      expect(await navigator.clipboard.readText()).toBe(
        'compras@municipio.example, tesoreria@municipio.example, ana@municipio.example',
      );
      expect(ventana.getByText('Copiado.')).toBeInTheDocument();
      expect(escrituras()).toEqual([]);
    });
  });

  it('por portal: muestra la URL y la abre en otra pestaña, sin datos de acceso', async () => {
    servir({ cliente: clienteJson({ portalUrl: 'https://portal.municipio.example/proveedores' }) });
    const { user } = renderDetalle();

    await enviar(user, 'Print 1 de 2');

    const ventana = within(await dialogo('Portal web'));
    expect(ventana.getByText('https://portal.municipio.example/proveedores')).toBeInTheDocument();
    const enlace = ventana.getByRole('link', { name: 'Abrir portal' });
    expect(enlace).toHaveAttribute('href', 'https://portal.municipio.example/proveedores');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
    expect(ventana.getByText('Print 1 de 2')).toBeInTheDocument();
    expect(ventana.getByText('· Día aprox. 15')).toBeInTheDocument();
    expect(ventana.queryByText(/contraseña|usuario/i)).not.toBeInTheDocument();
  });

  it('por WhatsApp: muestra el número legible y "Copiar número" lo copia', async () => {
    servir({ cliente: clienteJson({ whatsappNumero: '+5493511234567' }) });
    const { user } = renderDetalle();

    await enviar(user, 'Remito');

    const ventana = within(await dialogo('WhatsApp'));
    expect(ventana.getByText('+54 9 351 123 4567')).toBeInTheDocument();
    await user.click(ventana.getByRole('button', { name: 'Copiar número' }));
    expect(await navigator.clipboard.readText()).toBe('+5493511234567');
    expect(ventana.getByText('Remito')).toBeInTheDocument();
  });

  it.each([
    ['Print 1 de 2', 'Portal web', 'Este cliente no tiene URL de portal cargada.'],
    ['Remito', 'WhatsApp', 'Este cliente no tiene número de WhatsApp cargado.'],
  ])(
    'si falta el dato del canal (%s), lo dice y lleva a editar el cliente',
    async (item, canal, mensaje) => {
      servir();
      const { user } = renderDetalle();

      await enviar(user, item);

      const ventana = within(await dialogo(canal));
      expect(ventana.getByText(mensaje)).toBeInTheDocument();
      expect(ventana.queryByRole('link', { name: 'Abrir portal' })).not.toBeInTheDocument();
      await user.click(ventana.getByRole('button', { name: 'Editar el cliente' }));

      expect(await screen.findByRole('heading', { name: 'Editar cliente' })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog', { name: `Enviar por ${canal}` })).toBeNull(),
      );
    },
  );

  it('una rendición anulada no tiene casillas para elegir ni botón de envío', async () => {
    servir({
      rendicion: rendicionJson({ estado: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' }),
    });
    renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    const checklist = within(screen.getByRole('region', { name: 'Checklist' }));
    // La única casilla es el filtro: los ítems no se eligen.
    expect(checklist.getAllByRole('checkbox')).toHaveLength(1);
    expect(checklist.getByRole('checkbox', { name: /Ver solo faltantes/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Enviar/ })).not.toBeInTheDocument();
  });
});
