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
import { elegirOpcion } from '@/test/select';

// Corregir el canal de un ítem desde el detalle (ADR-0003, contrato 4.5).

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

const id = (n: number) => `f1a2b3c4-d5e6-4789-8abc-def01234567${n}`;
const PRINT = id(1);

/** Completado con su documento vigente: se puede elegir para enviar (HU2.8). */
const reunido = (n: number) => ({
  completado: true,
  completadoEn: FECHA,
  documento: {
    aplicacionId: `a0a0a0a0-0000-4000-8000-00000000000${n}`,
    documentoId: `d0d0d0d0-0000-4000-8000-00000000000${n}`,
    nombreOriginal: `documento-${n}.pdf`,
    tipoContenido: 'application/pdf',
    tamanioBytes: 2048,
    aplicadaEn: FECHA,
  },
});

/**
 * Factura por correo y Print 1 de 2 por portal (el canal equivocado que se va a corregir). Los dos
 * tienen documento: desde HU2.8 solo esos se eligen para enviar, y un test combina las dos cosas.
 */
const itemsIniciales = () => [
  itemJson({ id: id(0), ...reunido(0) }),
  itemJson({
    id: PRINT,
    nombreTipoDocumento: 'Print',
    ordinal: 1,
    totalOrdinal: 2,
    canalEntrega: 'PORTAL_WEB',
    ...reunido(1),
  }),
];

/**
 * Servidor de mentira con estado: el PATCH cambia el canal del ítem y devuelve el detalle.
 * `fallo` reemplaza la respuesta del PATCH.
 */
function servir({
  estado = 'ACTIVA',
  fallo,
}: { estado?: 'ACTIVA' | 'ANULADA'; fallo?: () => Response } = {}) {
  const items = itemsIniciales();
  const detalle = () =>
    json({
      ...rendicionJson(
        estado === 'ANULADA' ? { estado, anuladaEn: '2026-10-20T15:00:00.000Z' } : {},
      ),
      items,
    });
  fetchMock.mockImplementation((entrada, init) => {
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    const canal = /^\/rendiciones\/[^/]+\/items\/([^/]+)\/canal$/.exec(path);
    if (canal !== null && init?.method === 'PATCH') {
      if (fallo !== undefined) return Promise.resolve(fallo());
      const { canalEntrega } = JSON.parse(init.body as string) as { canalEntrega: string };
      const item = items.find((i) => i.id === canal[1]);
      if (item !== undefined) item.canalEntrega = canalEntrega;
      return Promise.resolve(detalle());
    }
    if (path.startsWith('/rendiciones/')) return Promise.resolve(detalle());
    return Promise.resolve(json(clienteJson));
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

const cargado = () => screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
const fila = (nombre: string) =>
  screen.getByText(nombre, { selector: 'label, p' }).closest('li') as HTMLElement;
const dialogo = () => screen.findByRole('alertdialog', { name: /^Cambiar el canal de/ });
const patches = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');

describe('RendicionDetallePage: corregir el canal de un ítem', () => {
  it('cambia el canal de ese ítem, lo muestra y lo avisa', async () => {
    servir();
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Cambiar el canal de Print 1 de 2' }));
    const ventana = within(await dialogo());
    expect(ventana.getByLabelText('Canal')).toHaveTextContent('Portal web');
    await elegirOpcion(user, ventana.getByLabelText('Canal'), 'WHATSAPP');
    await user.click(ventana.getByRole('button', { name: 'Guardar canal' }));

    expect(await screen.findByText('Print 1 de 2 ahora se envía por WhatsApp.')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(within(fila('Print 1 de 2')).getByText('WhatsApp')).toBeInTheDocument();
    expect(within(fila('Factura')).getByText('Correo')).toBeInTheDocument();
    const [[entrada, init]] = patches() as [[Parameters<typeof fetch>[0], RequestInit]];
    expect(new URL(urlDe(entrada)).pathname).toBe(
      `/rendiciones/${RENDICION_ID}/items/${PRINT}/canal`,
    );
    expect(JSON.parse(init.body as string)).toEqual({ canalEntrega: 'WHATSAPP' });
  });

  it('con el mismo canal no hay nada que guardar', async () => {
    servir();
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Cambiar el canal de Factura' }));

    expect(within(await dialogo()).getByRole('button', { name: 'Guardar canal' })).toBeDisabled();
  });

  it('si la rendición se anuló mientras tanto, lo dice en el diálogo y no cambia el canal', async () => {
    servir({ fallo: () => errorJson(409, 'CONFLICT', { motivo: 'RENDICION_ANULADA' }) });
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Cambiar el canal de Print 1 de 2' }));
    const ventana = within(await dialogo());
    await elegirOpcion(user, ventana.getByLabelText('Canal'), 'CORREO');
    await user.click(ventana.getByRole('button', { name: 'Guardar canal' }));

    expect(
      await ventana.findByText('La rendición está anulada: ya no se puede modificar.'),
    ).toBeVisible();
    expect(within(fila('Print 1 de 2')).getByText('Portal web')).toBeInTheDocument();
  });

  it('un error inesperado deja el diálogo abierto para reintentar', async () => {
    servir({ fallo: () => errorJson(500, 'INTERNAL_ERROR') });
    const { user } = renderDetalle();
    await cargado();

    await user.click(screen.getByRole('button', { name: 'Cambiar el canal de Print 1 de 2' }));
    const ventana = within(await dialogo());
    await elegirOpcion(user, ventana.getByLabelText('Canal'), 'CORREO');
    await user.click(ventana.getByRole('button', { name: 'Guardar canal' }));

    expect(
      await ventana.findByText('No pudimos cambiar el canal. Probá de nuevo en unos segundos.'),
    ).toBeVisible();
    expect(ventana.getByRole('button', { name: 'Guardar canal' })).toBeEnabled();
  });

  it('en una rendición anulada no se ofrece cambiar el canal', async () => {
    servir({ estado: 'ANULADA' });
    renderDetalle();
    await cargado();

    expect(screen.queryByRole('button', { name: /^Cambiar el canal de/ })).not.toBeInTheDocument();
  });

  it('conserva la selección y retira el aviso de canales mezclados al unificarlos', async () => {
    servir();
    const { user } = renderDetalle();
    await cargado();
    await user.click(screen.getByRole('checkbox', { name: 'Factura' }));
    await user.click(screen.getByRole('checkbox', { name: 'Print 1 de 2' }));
    await user.click(screen.getByRole('button', { name: 'Enviar (2)' }));
    expect(
      screen.getByText(/Los ítems seleccionados se envían por canales distintos/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cambiar el canal de Print 1 de 2' }));
    const ventana = within(await dialogo());
    await elegirOpcion(user, ventana.getByLabelText('Canal'), 'CORREO');
    await user.click(ventana.getByRole('button', { name: 'Guardar canal' }));
    await screen.findByText('Print 1 de 2 ahora se envía por Correo.');

    expect(
      screen.queryByText(/Los ítems seleccionados se envían por canales distintos/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Factura' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Print 1 de 2' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Enviar (2)' })).toBeEnabled();
  });
});
