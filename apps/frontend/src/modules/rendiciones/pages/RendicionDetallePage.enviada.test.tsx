import { diaLegible, hoyEnBuenosAires, MENSAJE_FECHA_ENVIO_FUTURA } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  CLIENTE_ID,
  errorJson,
  itemJson,
  itemReunidoJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Marcar como Enviada desde el detalle (HU3.7): el botón y el diálogo con la fecha, "Ya la envié"
// del diálogo de envío y una Enviada que ya no se modifica. También "Faltan N" junto a "Marcar como
// completa" (deuda de la HU3.6), con la regla del envío.

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

const REUNIDO = itemReunidoJson({ id: 'f1a2b3c4-d5e6-4789-8abc-def012345670' });
const PENDIENTE = itemJson({ id: 'f1a2b3c4-d5e6-4789-8abc-def012345671', ordinal: 2 });
/** Figura reunido pero sin documento vigente: no se puede enviar, así que falta. */
const SIN_DOCUMENTO = itemJson({
  id: 'f1a2b3c4-d5e6-4789-8abc-def012345672',
  ordinal: 3,
  completado: true,
  documento: null,
});

const esPedidoDeEstado = (entrada: Parameters<typeof fetch>[0], init?: RequestInit) =>
  urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/estado`) && init?.method === 'PATCH';

function servir({
  inicial = {},
  items = [REUNIDO],
  respuestaDelPatch,
}: {
  inicial?: Record<string, unknown>;
  items?: unknown[];
  respuestaDelPatch?: () => Response;
} = {}) {
  let actual: Record<string, unknown> = { ...rendicionJson(inicial), items };

  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (url.endsWith('/contactos')) return Promise.resolve(json([]));
    if (url.endsWith('/preparar-envio')) {
      return Promise.resolve(
        json({ rendicionId: RENDICION_ID, canal: 'CORREO', items: [REUNIDO] }),
      );
    }
    if (esPedidoDeEstado(entrada, init)) {
      if (respuestaDelPatch !== undefined) return Promise.resolve(respuestaDelPatch());
      const { estado, fechaEnvio } = JSON.parse(init?.body as string) as {
        estado: string;
        fechaEnvio?: string;
      };
      const historial = [
        ...(actual.historial as unknown[]),
        {
          estadoAnterior: actual.estado,
          estadoNuevo: estado,
          fecha: new Date().toISOString(),
          fechaEfectiva: fechaEnvio ?? null,
        },
      ];
      actual = { ...actual, estado, historial };
      return Promise.resolve(json(actual));
    }
    if (url.includes('/rendiciones/')) return Promise.resolve(json(actual));
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

const cuerpoDelPedido = () => {
  const [, init] = pedidosDeEstado()[0] ?? [];
  return JSON.parse(init?.body as string) as unknown;
};

async function abrirDialogoDeEnvio(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Marcar como enviada' }));
  return screen.findByRole('alertdialog', { name: 'Registrar el envío' });
}

describe('RendicionDetallePage: "Faltan N" junto a "Marcar como completa" (HU3.6, deuda)', () => {
  it('con faltantes, el botón queda deshabilitado y dice cuántos, contando los reunidos sin documento', async () => {
    servir({ items: [REUNIDO, PENDIENTE, SIN_DOCUMENTO] });
    renderDetalle();
    await esperarDetalle();

    const boton = screen.getByRole('button', { name: 'Marcar como completa' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAccessibleDescription('Faltan 2 documentos');
    expect(screen.getByText('Faltan 2 documentos')).toBeVisible();
  });

  it('con uno solo: "Falta 1 documento"', async () => {
    servir({ items: [REUNIDO, PENDIENTE] });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByText('Falta 1 documento')).toBeVisible();
    // En el bloque de acciones, junto al botón (no en la línea de datos).
    const acciones = screen.getByRole('group', { name: 'Cambiar el estado' });
    expect(within(acciones).getByText('Falta 1 documento')).toBeVisible();
    expect(within(acciones).getByRole('button', { name: 'Marcar como completa' })).toBeDisabled();
  });

  it('con todo reunido, el botón está habilitado y no dice nada', async () => {
    servir({ items: [REUNIDO] });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByRole('button', { name: 'Marcar como completa' })).toBeEnabled();
    expect(screen.queryByText(/Falta/)).not.toBeInTheDocument();
  });
});

describe('RendicionDetallePage: marcar como enviada (HU3.7)', () => {
  it('en una Completa ofrece "Marcar como enviada"; en una En curso, no', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByRole('button', { name: 'Marcar como enviada' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Volver a en curso' })).toBeEnabled();
  });

  it('el diálogo propone hoy y, al confirmar, pide ENVIADA con la fecha y lo avisa', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    const dialogo = await abrirDialogoDeEnvio(user);
    const hoy = hoyEnBuenosAires();
    expect(within(dialogo).getByLabelText('Fecha de envío')).toHaveValue(hoy);
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(
      await screen.findByText(`La rendición quedó enviada (${diaLegible(hoy)}).`),
    ).toBeVisible();
    expect(cuerpoDelPedido()).toEqual({ estado: 'ENVIADA', fechaEnvio: hoy });
    expect(estadoMostrado()).toHaveTextContent('Enviada');
    expect(screen.queryByRole('button', { name: 'Marcar como enviada' })).not.toBeInTheDocument();
  });

  it('con una fecha pasada del período, la manda', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    const dialogo = await abrirDialogoDeEnvio(user);
    fireEvent.change(within(dialogo).getByLabelText('Fecha de envío'), {
      target: { value: '2026-10-05' },
    });
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('La rendición quedó enviada (05/10/2026).')).toBeVisible();
    expect(cuerpoDelPedido()).toEqual({ estado: 'ENVIADA', fechaEnvio: '2026-10-05' });
  });

  it.each([
    ['2999-01-01', MENSAJE_FECHA_ENVIO_FUTURA],
    [
      '2026-09-30',
      'La fecha de envío no puede ser anterior al 01/10/2026, el primer día del período.',
    ],
  ])('con %s no pide nada y explica el error en el campo', async (fecha, mensaje) => {
    servir({ inicial: { estado: 'COMPLETA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    const dialogo = await abrirDialogoDeEnvio(user);
    const campo = within(dialogo).getByLabelText('Fecha de envío');
    fireEvent.change(campo, { target: { value: fecha } });
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(within(dialogo).getByText(mensaje)).toBeVisible();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription(mensaje);
    expect(pedidosDeEstado()).toHaveLength(0);
  });

  it('si el servidor rechaza la fecha (400 en fechaEnvio), muestra su mensaje en el campo', async () => {
    servir({
      inicial: { estado: 'COMPLETA' },
      respuestaDelPatch: () =>
        errorJson(400, 'VALIDATION_ERROR', [
          { campo: 'fechaEnvio', mensaje: 'La fecha de envío no puede ser posterior a hoy.' },
        ]),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    const dialogo = await abrirDialogoDeEnvio(user);
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(
      await within(dialogo).findByText('La fecha de envío no puede ser posterior a hoy.'),
    ).toBeVisible();
  });

  it('si faltan documentos (409 ITEMS_PENDIENTES), lo avisa en el diálogo', async () => {
    servir({
      inicial: { estado: 'COMPLETA' },
      respuestaDelPatch: () =>
        errorJson(409, 'CONFLICT', { motivo: 'ITEMS_PENDIENTES', faltantes: 1 }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    const dialogo = await abrirDialogoDeEnvio(user);
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(
      await within(dialogo).findByText('No se puede marcar como enviada: falta 1 documento.'),
    ).toBeVisible();
  });

  it('"Ya la envié" del diálogo de envío abre el registro del envío (solo en una Completa)', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('checkbox', { name: /Factura/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar (1)' }));
    const envio = await screen.findByRole('alertdialog', { name: /Enviar por/ });
    await user.click(within(envio).getByRole('button', { name: 'Ya la envié' }));

    const registro = await screen.findByRole('alertdialog', { name: 'Registrar el envío' });
    await user.click(within(registro).getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(/La rendición quedó enviada/)).toBeVisible();
    expect(cuerpoDelPedido()).toMatchObject({ estado: 'ENVIADA' });
  });

  it('en una En curso, el diálogo de envío no ofrece "Ya la envié"', async () => {
    servir({ items: [REUNIDO, PENDIENTE] });
    const { user } = renderDetalle();
    await esperarDetalle();

    const [casilla] = screen.getAllByRole('checkbox', { name: /Factura/ });
    await user.click(casilla as HTMLElement);
    await user.click(screen.getByRole('button', { name: 'Enviar (1)' }));
    const envio = await screen.findByRole('alertdialog', { name: /Enviar por/ });

    expect(within(envio).queryByRole('button', { name: 'Ya la envié' })).not.toBeInTheDocument();
  });
});

describe('RendicionDetallePage: una Enviada (HU3.7)', () => {
  const ENVIADA = {
    estado: 'ENVIADA',
    historial: [
      { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-08T12:00:00.000Z' },
      { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-10-09T12:00:00.000Z' },
      {
        estadoAnterior: 'COMPLETA',
        estadoNuevo: 'ENVIADA',
        fecha: '2026-11-12T12:00:00.000Z',
        fechaEfectiva: '2026-10-05',
      },
    ],
  };

  it('muestra el estado con la fecha de envío elegida y no ofrece cambiar el estado', async () => {
    servir({ inicial: ENVIADA });
    renderDetalle();
    await esperarDetalle();

    expect(estadoMostrado()).toHaveTextContent('Enviada');
    expect(estadoMostrado()).toHaveTextContent('el 05/10/2026');
    for (const nombre of ['Volver a en curso', 'Marcar como enviada', 'Marcar como completa']) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument();
    }
    // El historial también muestra la fecha de envío, no la del registro.
    const historial = within(screen.getByRole('region', { name: 'Historial' }));
    await userEvent.setup().click(historial.getByRole('button', { name: 'Historial (3)' }));
    expect(historial.getAllByRole('listitem').at(-1)).toHaveTextContent('05/10/2026Pasó aEnviada');
  });

  it('deshabilita cambiar el canal y el documento, y explica por qué', async () => {
    servir({ inicial: ENVIADA });
    renderDetalle();
    await esperarDetalle();

    const motivo =
      'La rendición ya fue enviada: no se pueden cambiar sus documentos ni sus canales.';
    expect(screen.getByText(motivo)).toBeVisible();
    const canal = screen.getByRole('button', { name: /Cambiar el canal de/ });
    const reemplazar = screen.getByRole('button', { name: /Reemplazar documento de/ });
    for (const boton of [canal, reemplazar]) {
      expect(boton).toBeDisabled();
      expect(boton).toHaveAccessibleDescription(motivo);
    }
    // La OC sigue editable: es un dato administrativo.
    expect(screen.getByRole('button', { name: 'Editar OC' })).toBeEnabled();
  });
});
