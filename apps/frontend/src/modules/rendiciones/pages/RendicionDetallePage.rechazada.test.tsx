import { hoyEnBuenosAires } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  CLIENTE_ID,
  itemReunidoJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Corregir una rendición rechazada y volver a enviarla (HU3.9): "Corregir" la reabre a En curso,
// el motivo del último rechazo se ve destacado mientras se corrige y desaparece al reenviarla, una
// Rechazada no se edita hasta reabrirla y la fecha del reenvío no puede ser anterior al rechazo.

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

/** Enviada el 20/10 y rechazada el 05/11 con un motivo. */
const HASTA_EL_RECHAZO = [
  { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-02T12:00:00.000Z' },
  { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-10-19T12:00:00.000Z' },
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'ENVIADA',
    fecha: '2026-10-20T12:00:00.000Z',
    fechaEfectiva: '2026-10-20',
  },
  {
    estadoAnterior: 'ENVIADA',
    estadoNuevo: 'RECHAZADA',
    fecha: '2026-11-05T15:00:00.000Z',
    motivo: 'Falta la firma del intendente',
  },
];
const REABIERTA = {
  estadoAnterior: 'RECHAZADA',
  estadoNuevo: 'EN_CURSO',
  fecha: '2026-11-06T12:00:00.000Z',
};
const COMPLETADA = {
  estadoAnterior: 'EN_CURSO',
  estadoNuevo: 'COMPLETA',
  fecha: '2026-11-07T12:00:00.000Z',
};

const RECHAZADA = { estado: 'RECHAZADA', historial: HASTA_EL_RECHAZO };
const CORRIGIENDO = { estado: 'EN_CURSO', historial: [...HASTA_EL_RECHAZO, REABIERTA] };
const COMPLETA_CORREGIDA = {
  estado: 'COMPLETA',
  historial: [...HASTA_EL_RECHAZO, REABIERTA, COMPLETADA],
};

const MOTIVO = 'Rechazada el 05/11/2026: Falta la firma del intendente';

const esPedidoDeEstado = (entrada: Parameters<typeof fetch>[0], init?: RequestInit) =>
  urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/estado`) && init?.method === 'PATCH';

function servir(inicial: Record<string, unknown>) {
  let actual: Record<string, unknown> = { ...rendicionJson(inicial), items: [REUNIDO] };

  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (esPedidoDeEstado(entrada, init)) {
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

describe('RendicionDetallePage: "Corregir" una Rechazada (HU3.9)', () => {
  it('en una Rechazada activa ofrece "Corregir" como acción principal, y ninguna otra', async () => {
    servir(RECHAZADA);
    renderDetalle();
    await esperarDetalle();

    const acciones = screen.getByRole('group', { name: 'Cambiar el estado' });
    const corregir = within(acciones).getByRole('button', { name: 'Corregir' });
    expect(corregir).toHaveClass('bg-primary');
    expect(within(acciones).getAllByRole('button')).toEqual([corregir]);
  });

  it.each([
    ['En curso', { estado: 'EN_CURSO' }],
    ['Completa', { estado: 'COMPLETA' }],
    ['Enviada', { estado: 'ENVIADA' }],
    ['Aprobada', { estado: 'APROBADA' }],
    ['Rechazada anulada', { ...RECHAZADA, vigencia: 'ANULADA', anuladaEn: '2026-11-08T12:00:00Z' }],
  ])('en una %s no ofrece "Corregir"', async (_nombre, inicial) => {
    servir(inicial);
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByRole('button', { name: 'Corregir' })).not.toBeInTheDocument();
  });

  it('al tocar "Corregir" pide EN_CURSO, queda En curso y editable, y el historial dice "Se reabrió para corregir"', async () => {
    servir(RECHAZADA);
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Corregir' }));

    expect(
      await screen.findByText(
        'La rendición volvió a En curso: corregí lo que pidió el cliente y volvé a enviarla.',
      ),
    ).toBeVisible();
    const [, init] = pedidosDeEstado()[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({ estado: 'EN_CURSO' });
    expect(estadoMostrado()).toHaveTextContent('En curso');
    expect(screen.getByRole('button', { name: /Cambiar el canal de/ })).toBeEnabled();
    // El motivo sigue destacado mientras se corrige.
    expect(screen.getByText(MOTIVO)).toBeVisible();

    const historial = within(screen.getByRole('region', { name: 'Historial' }));
    await user.click(historial.getByRole('button', { name: /^Historial/ }));
    expect(historial.getAllByRole('listitem').at(-1)).toHaveTextContent(
      'Se reabrió para corregirEn curso',
    );
  });
});

describe('RendicionDetallePage: una Rechazada no se edita hasta reabrirla (HU3.9)', () => {
  it('canal y documento deshabilitados, con el texto de Rechazada; la OC sí se edita', async () => {
    servir(RECHAZADA);
    renderDetalle();
    await esperarDetalle();

    const texto = 'La rendición fue rechazada: tocá Corregir para editarla.';
    expect(screen.getByText(texto)).toBeVisible();
    for (const nombre of [/Cambiar el canal de/, /Reemplazar documento de/]) {
      const boton = screen.getByRole('button', { name: nombre });
      expect(boton).toBeDisabled();
      expect(boton).toHaveAccessibleDescription(texto);
    }
    expect(screen.getByRole('button', { name: 'Editar OC' })).toBeEnabled();
    expect(screen.queryByText(/Checklist completo/)).not.toBeInTheDocument();
  });
});

describe('RendicionDetallePage: el motivo del último rechazo, destacado (HU3.9)', () => {
  it.each([
    ['Rechazada', RECHAZADA],
    ['En curso, corrigiendo', CORRIGIENDO],
    ['Completa, corrigiendo', COMPLETA_CORREGIDA],
  ])('se ve en una %s', async (_nombre, inicial) => {
    servir(inicial);
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByText(MOTIVO)).toBeVisible();
  });

  it('con dos rechazos, muestra el último', async () => {
    servir({
      estado: 'RECHAZADA',
      historial: [
        ...HASTA_EL_RECHAZO,
        REABIERTA,
        COMPLETADA,
        {
          estadoAnterior: 'COMPLETA',
          estadoNuevo: 'ENVIADA',
          fecha: '2026-11-08T12:00:00.000Z',
          fechaEfectiva: '2026-11-08',
        },
        {
          estadoAnterior: 'ENVIADA',
          estadoNuevo: 'RECHAZADA',
          fecha: '2026-11-10T15:00:00.000Z',
          motivo: 'La factura tiene otro CUIT',
        },
      ],
    });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByText('Rechazada el 10/11/2026: La factura tiene otro CUIT')).toBeVisible();
    expect(screen.queryByText(MOTIVO)).not.toBeInTheDocument();
  });

  it('sin rechazos no hay aviso', async () => {
    servir({ estado: 'COMPLETA' });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByText(/^Rechazada el/)).not.toBeInTheDocument();
  });

  it('al reenviarla desaparece (el motivo queda en el historial)', async () => {
    servir(COMPLETA_CORREGIDA);
    const { user } = renderDetalle();
    await esperarDetalle();
    expect(screen.getByText(MOTIVO)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Marcar como enviada' }));
    const dialogo = await screen.findByRole('alertdialog', { name: 'Registrar el envío' });
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText(/La rendición quedó enviada/)).toBeVisible();
    expect(screen.queryByText(MOTIVO)).not.toBeInTheDocument();
    const historial = within(screen.getByRole('region', { name: 'Historial' }));
    await user.click(historial.getByRole('button', { name: /^Historial/ }));
    expect(historial.getByText('Falta la firma del intendente')).toBeInTheDocument();
  });
});

describe('RendicionDetallePage: la fecha del reenvío (HU3.9)', () => {
  it('el selector arranca en el día del último rechazo y no deja elegir uno anterior', async () => {
    servir(COMPLETA_CORREGIDA);
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como enviada' }));
    const dialogo = await screen.findByRole('alertdialog', { name: 'Registrar el envío' });
    const campo = within(dialogo).getByLabelText('Fecha de envío');
    expect(campo).toHaveAttribute('min', '2026-11-05');
    expect(campo).toHaveAttribute('max', hoyEnBuenosAires());

    fireEvent.change(campo, { target: { value: '2026-11-04' } });
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar' }));

    expect(
      within(dialogo).getByText(
        'La fecha de envío no puede ser anterior al 05/11/2026, el día del último rechazo.',
      ),
    ).toBeVisible();
    expect(pedidosDeEstado()).toHaveLength(0);
  });

  it('sin rechazos, el mínimo sigue siendo el primer día del período', async () => {
    servir({ estado: 'COMPLETA' });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como enviada' }));
    const dialogo = await screen.findByRole('alertdialog', { name: 'Registrar el envío' });
    expect(within(dialogo).getByLabelText('Fecha de envío')).toHaveAttribute('min', '2026-10-01');
  });
});
