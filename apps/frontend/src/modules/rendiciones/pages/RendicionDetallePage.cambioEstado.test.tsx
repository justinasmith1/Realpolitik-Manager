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

// Marcar la rendición como Completa y volverla a En curso, desde el detalle (HU3.6). El pedido es
// `PATCH /rendiciones/:id/estado`; los botones nunca se deshabilitan por el avance: el servidor
// decide y, si faltan documentos, el aviso dice cuántos.

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

const ITEMS = [itemJson({ id: 'f1a2b3c4-d5e6-4789-8abc-def012345670', completado: true })];

const esPedidoDeEstado = (entrada: Parameters<typeof fetch>[0], init?: RequestInit) =>
  urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/estado`) && init?.method === 'PATCH';

function servir({
  inicial = {},
  respuestaDelPatch,
}: {
  inicial?: Record<string, unknown>;
  /** Cómo responde el PATCH; sin esto, aplica el estado pedido. */
  respuestaDelPatch?: () => Response | Promise<Response>;
} = {}) {
  let actual = { ...rendicionJson(inicial), items: ITEMS };

  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (esPedidoDeEstado(entrada, init)) {
      if (respuestaDelPatch !== undefined) return Promise.resolve(respuestaDelPatch());
      const { estado } = JSON.parse(init?.body as string) as { estado: string };
      actual = { ...actual, estado };
      return Promise.resolve(json(actual));
    }
    if (url.includes('/rendiciones/')) {
      return Promise.resolve(json(actual));
    }
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

const esperarDetalle = () =>
  screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

const estadoMostrado = () => {
  const termino = screen.getByText('Estado', { selector: 'dt' });
  return within(termino.parentElement as HTMLElement).getByRole('definition');
};

const pedidosDeEstado = () =>
  fetchMock.mock.calls.filter(([entrada, init]) => esPedidoDeEstado(entrada, init));

/** El primer PATCH de estado: su URL y su cuerpo ya leído. */
function primerPedidoDeEstado(): { url: string; cuerpo: unknown } {
  const pedido = pedidosDeEstado()[0];
  if (pedido === undefined) throw new Error('No hubo ningún pedido de estado');
  const [entrada, init] = pedido;
  return { url: urlDe(entrada), cuerpo: JSON.parse(init?.body as string) };
}

describe('RendicionDetallePage: marcar como completa (HU3.6)', () => {
  it('con la rendición En curso ofrece "Marcar como completa" y no "Volver a en curso"', async () => {
    servir();
    renderDetalle();
    await esperarDetalle();

    const boton = screen.getByRole('button', { name: 'Marcar como completa' });
    expect(boton).toHaveAttribute('type', 'button');
    expect(boton).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Volver a en curso' })).not.toBeInTheDocument();
  });

  it('con la rendición Completa ofrece "Volver a en curso" y no "Marcar como completa"', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByRole('button', { name: 'Volver a en curso' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Marcar como completa' })).not.toBeInTheDocument();
  });

  it('en una rendición anulada no ofrece ningún botón de estado', async () => {
    servir({ inicial: { vigencia: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByRole('button', { name: 'Marcar como completa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a en curso' })).not.toBeInTheDocument();
  });

  it('con otro estado (Enviada) no ofrece botones: son de otras historias', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByRole('button', { name: 'Marcar como completa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a en curso' })).not.toBeInTheDocument();
  });

  it('al marcar como completa pide PATCH /rendiciones/:id/estado con COMPLETA, muestra el nuevo estado y lo avisa', async () => {
    servir();
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

    expect(await screen.findByText('La rendición quedó completa.')).toBeVisible();
    const { url, cuerpo } = primerPedidoDeEstado();
    expect(url).toBe(`https://api.example/rendiciones/${RENDICION_ID}/estado`);
    expect(cuerpo).toEqual({ estado: 'COMPLETA' });
    expect(estadoMostrado()).toHaveTextContent('Completa');
    expect(await screen.findByRole('button', { name: 'Volver a en curso' })).toBeInTheDocument();
  });

  it('al volver a en curso pide EN_CURSO y lo avisa', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Volver a en curso' }));

    expect(await screen.findByText('La rendición volvió a En curso.')).toBeVisible();
    expect(primerPedidoDeEstado().cuerpo).toEqual({ estado: 'EN_CURSO' });
    expect(estadoMostrado()).toHaveTextContent('En curso');
  });

  it.each([
    [2, 'No se puede marcar como completa: faltan 2 documentos.'],
    [1, 'No se puede marcar como completa: falta 1 documento.'],
    [0, 'No se puede marcar como completa: la rendición no tiene documentos.'],
  ])(
    'si el servidor responde ITEMS_PENDIENTES con faltantes %i, avisa cuántos faltan',
    async (faltantes, texto) => {
      servir({
        respuestaDelPatch: () =>
          errorJson(409, 'CONFLICT', { motivo: 'ITEMS_PENDIENTES', faltantes }),
      });
      const { user } = renderDetalle();
      await esperarDetalle();

      await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

      expect(await screen.findByText(texto)).toBeVisible();
      expect(estadoMostrado()).toHaveTextContent('En curso');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Marcar como completa' })).toBeEnabled(),
      );
    },
  );

  it('si la rendición se anuló mientras tanto (409 RENDICION_ANULADA), lo avisa', async () => {
    servir({
      respuestaDelPatch: () => errorJson(409, 'CONFLICT', { motivo: 'RENDICION_ANULADA' }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

    expect(
      await screen.findByText('La rendición está anulada: ya no se puede modificar.'),
    ).toBeVisible();
  });

  it('ante TRANSICION_INVALIDA muestra un mensaje genérico', async () => {
    servir({
      respuestaDelPatch: () =>
        errorJson(409, 'CONFLICT', {
          motivo: 'TRANSICION_INVALIDA',
          estadoActual: 'ENVIADA',
          estadoNuevo: 'COMPLETA',
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

    expect(
      await screen.findByText('Ese cambio de estado no está permitido desde el estado actual.'),
    ).toBeVisible();
  });

  it('mientras espera la respuesta el botón queda ocupado y no manda un segundo pedido', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    servir({
      respuestaDelPatch: () =>
        new Promise<Response>((resolver) => {
          responder = resolver;
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));
    const ocupado = await screen.findByRole('button', { name: 'Guardando…' });
    expect(ocupado).toHaveAttribute('aria-disabled', 'true');
    await user.click(ocupado);
    expect(pedidosDeEstado()).toHaveLength(1);

    responder(json({ ...rendicionJson({ estado: 'COMPLETA' }), items: ITEMS }));
    expect(await screen.findByText('La rendición quedó completa.')).toBeVisible();
  });
});
