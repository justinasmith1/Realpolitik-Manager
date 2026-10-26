import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  CLIENTE_ID,
  itemJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Envío por selección (HU2.5): elegir ítems y ver los datos para mandarlos por su canal. El
// sistema todavía no envía nada: ningún paso de estos hace un pedido que no sea de lectura.

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

/** Factura (correo, reunida), Print 1 de 2 (portal, día 15, pendiente), Print 2 de 2 (correo). */
const ITEMS = [
  itemJson({ id: id(0), completado: true, completadoEn: '2026-10-16T12:00:00.000Z' }),
  itemJson({
    id: id(1),
    nombreTipoDocumento: 'Print',
    ordinal: 1,
    totalOrdinal: 2,
    diaAproximado: 15,
    canalEntrega: 'PORTAL_WEB',
  }),
  itemJson({ id: id(2), nombreTipoDocumento: 'Print', ordinal: 2, totalOrdinal: 2 }),
  itemJson({ id: id(3), nombreTipoDocumento: 'Remito', canalEntrega: 'WHATSAPP' }),
];

function servir({
  cliente = clienteJson(),
  rendicion = rendicionJson(),
}: { cliente?: unknown; rendicion?: unknown } = {}) {
  fetchMock.mockImplementation((entrada) => {
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (path.endsWith('/contactos')) return Promise.resolve(json(CONTACTOS));
    if (path.startsWith('/rendiciones/')) {
      return Promise.resolve(json({ ...(rendicion as object), items: ITEMS }));
    }
    return Promise.resolve(json(cliente));
  });
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

/** Pedidos que no son de lectura: el envío no debe hacer ninguno. */
const escrituras = () =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET');

describe('RendicionDetallePage: envío por selección', () => {
  it('"Enviar" cuenta los elegidos, reunidos o pendientes, y sin ninguno está deshabilitado', async () => {
    servir();
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    expect(screen.getByRole('button', { name: 'Enviar (0)' })).toBeDisabled();

    await user.click(casilla('Factura'));
    await user.click(casilla('Print 2 de 2'));

    expect(screen.getByRole('button', { name: 'Enviar (2)' })).toBeEnabled();
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
