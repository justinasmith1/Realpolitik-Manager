import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import { TEXTO_RENDICION_YA_APROBADA } from '@/modules/rendiciones/rendiciones.etiquetas';
import {
  CLIENTE_ID,
  errorJson,
  itemJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// El cobro informado por el cliente en el detalle de la rendición (HU3.10): se ofrece solo en una
// Enviada o Aprobada activa; se registra, se corrige y se quita (con confirmación); en una anulada
// se ve y no se toca.

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  // 13/11/2026, 12:00 en Buenos Aires. Solo el reloj de Date: los timers reales siguen andando.
  vi.useFakeTimers({ now: new Date('2026-11-13T15:00:00.000Z'), toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
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

const COBRO = { fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' };

interface Opciones {
  inicial?: Record<string, unknown>;
  respuestaDelPut?: Response;
  respuestaDelPatch?: Response;
}

function servir({ inicial = {}, respuestaDelPut, respuestaDelPatch }: Opciones = {}) {
  let actual: Record<string, unknown> = { ...rendicionJson(inicial), items: ITEMS };
  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    const metodo = init?.method ?? 'GET';
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (url.endsWith(`/rendiciones/${RENDICION_ID}/cobro`) && metodo === 'PUT') {
      if (respuestaDelPut !== undefined) return Promise.resolve(respuestaDelPut);
      const cuerpo = JSON.parse(init?.body as string) as { fecha: string; nota?: string | null };
      actual = { ...actual, cobro: { fecha: cuerpo.fecha, nota: cuerpo.nota ?? null } };
      return Promise.resolve(json(actual));
    }
    if (url.endsWith(`/rendiciones/${RENDICION_ID}/cobro`) && metodo === 'DELETE') {
      actual = { ...actual, cobro: null };
      return Promise.resolve(json(actual));
    }
    if (url.endsWith(`/rendiciones/${RENDICION_ID}/estado`) && metodo === 'PATCH') {
      return Promise.resolve(respuestaDelPatch ?? json(actual));
    }
    if (url.includes('/rendiciones/')) {
      return Promise.resolve(json(actual));
    }
    return Promise.resolve(json(clienteJson));
  });
}

const llamadasA = (metodo: string) =>
  fetchMock.mock.calls.filter(
    ([entrada, init]) =>
      urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/cobro`) && init?.method === metodo,
  );

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

const titulo = () => screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
// La franja del cobro: una región propia, a ancho completo, bajo la línea Estado · Vigencia · Avance.
const franjaDeCobro = () => screen.getByRole('region', { name: 'Cobro' });
const itemDeCobro = () => within(franjaDeCobro());
const botonRegistrar = () => screen.queryByRole('button', { name: 'Registrar cobro' });

describe('RendicionDetallePage: cuándo se ofrece registrar el cobro (HU3.10)', () => {
  it.each(['EN_CURSO', 'COMPLETA', 'RECHAZADA'])(
    'una %s no ofrece registrar el cobro ni muestra la franja de cobro',
    async (estado) => {
      servir({ inicial: { estado } });
      renderDetalle();
      await titulo();

      expect(botonRegistrar()).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Cobro' })).not.toBeInTheDocument();
    },
  );

  it.each(['ENVIADA', 'APROBADA'])('una %s activa ofrece registrar el cobro', async (estado) => {
    servir({ inicial: { estado } });
    renderDetalle();
    await titulo();

    expect(botonRegistrar()).toBeInTheDocument();
    expect(itemDeCobro().getByText('Sin cobro registrado')).toBeInTheDocument();
  });

  it('una anulada Enviada sin cobro no ofrece nada', async () => {
    servir({
      inicial: { estado: 'ENVIADA', vigencia: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' },
    });
    renderDetalle();
    await titulo();

    expect(botonRegistrar()).not.toBeInTheDocument();
  });

  it('una anulada con cobro lo muestra en solo lectura: sin registrar, editar ni quitar', async () => {
    servir({
      inicial: {
        estado: 'ENVIADA',
        vigencia: 'ANULADA',
        anuladaEn: '2026-10-20T15:00:00.000Z',
        cobro: COBRO,
      },
    });
    renderDetalle();
    await titulo();

    expect(itemDeCobro().getByText('Cobrada el 10/11/2026')).toBeInTheDocument();
    expect(botonRegistrar()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar cobro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar cobro' })).not.toBeInTheDocument();
  });

  it('no depende de si la rendición es modificable: una Aprobada (cerrada para documentos) se cobra', async () => {
    servir({ inicial: { estado: 'APROBADA' } });
    renderDetalle();
    await titulo();

    expect(screen.getByText(TEXTO_RENDICION_YA_APROBADA)).toBeInTheDocument();
    expect(botonRegistrar()).toBeEnabled();
  });
});

describe('RendicionDetallePage: registrar, corregir y quitar el cobro (HU3.10)', () => {
  it('registra el cobro: la hoja pide la fecha (hoy) y la nota, y el detalle queda cobrado', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await titulo();

    await user.click(await screen.findByRole('button', { name: 'Registrar cobro' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Cobro de la rendición' }));
    expect(hoja.getByLabelText(/Fecha en que el cliente avisó el pago/)).toHaveValue('2026-11-13');
    await user.clear(hoja.getByLabelText(/Fecha en que el cliente avisó el pago/));
    await user.type(hoja.getByLabelText(/Fecha en que el cliente avisó el pago/), COBRO.fecha);
    await user.type(hoja.getByLabelText(/Nota/), COBRO.nota);
    await user.click(hoja.getByRole('button', { name: 'Guardar cobro' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Cobro de la rendición' }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Cobro guardado.')).toBeVisible();
    expect(itemDeCobro().getByText('Cobrada el 10/11/2026')).toBeInTheDocument();
    expect(itemDeCobro().getByText(COBRO.nota)).toHaveAttribute('title', COBRO.nota);
    expect(botonRegistrar()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar cobro' })).toBeInTheDocument();
    expect(llamadasA('PUT')).toHaveLength(1);
  });

  it('la franja con cobro lleva ícono y texto con los tokens de éxito', async () => {
    servir({ inicial: { estado: 'ENVIADA', cobro: COBRO } });
    renderDetalle();
    await titulo();

    expect(franjaDeCobro()).toHaveClass('bg-success-soft', 'border-success-border');
    const texto = itemDeCobro().getByText('Cobrada el 10/11/2026');
    expect(texto).toHaveClass('font-semibold', 'text-success');
    expect(franjaDeCobro().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('la franja está justo debajo de la línea Estado · Vigencia · Avance y antes del historial', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    renderDetalle();
    await titulo();

    const avance = screen.getByText('Avance', { selector: 'dt' });
    const historial = screen.getByRole('heading', { level: 2, name: /Historial|Estado/ });
    expect(
      avance.compareDocumentPosition(franjaDeCobro()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      franjaDeCobro().compareDocumentPosition(historial) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Ya no es un ítem de la línea de datos: no hay un "Cobro" como término de la lista.
    expect(screen.queryByText('Cobro', { selector: 'dt' })).not.toBeInTheDocument();
    expect(franjaDeCobro().closest('dl')).toBeNull();
  });

  it('corrige el cobro: la hoja trae lo guardado y el cambio queda a la vista', async () => {
    servir({ inicial: { estado: 'APROBADA', cobro: COBRO } });
    const { user } = renderDetalle();
    await titulo();

    await user.click(screen.getByRole('button', { name: 'Editar cobro' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Cobro de la rendición' }));
    expect(hoja.getByLabelText(/Fecha en que el cliente avisó el pago/)).toHaveValue('2026-11-10');
    expect(hoja.getByLabelText(/Nota/)).toHaveValue(COBRO.nota);
    await user.clear(hoja.getByLabelText(/Fecha en que el cliente avisó el pago/));
    await user.type(hoja.getByLabelText(/Fecha en que el cliente avisó el pago/), '2026-11-12');
    await user.clear(hoja.getByLabelText(/Nota/));
    await user.click(hoja.getByRole('button', { name: 'Guardar cobro' }));

    expect(await screen.findByText('Cobro guardado.')).toBeVisible();
    expect(itemDeCobro().getByText('Cobrada el 12/11/2026')).toBeInTheDocument();
    expect(itemDeCobro().queryByText(COBRO.nota)).not.toBeInTheDocument();
    expect(JSON.parse(llamadasA('PUT')[0]?.[1]?.body as string)).toEqual({
      fecha: '2026-11-12',
      nota: null,
    });
  });

  it('el día del cobro no se corre: el 01/01 se lee 01/01', async () => {
    servir({ inicial: { estado: 'ENVIADA', cobro: { fecha: '2026-01-01', nota: null } } });
    renderDetalle();
    await titulo();

    expect(itemDeCobro().getByText('Cobrada el 01/01/2026')).toBeInTheDocument();
  });

  it('quitar pide confirmación: cancelar no borra nada', async () => {
    servir({ inicial: { estado: 'ENVIADA', cobro: COBRO } });
    const { user } = renderDetalle();
    await titulo();

    await user.click(screen.getByRole('button', { name: 'Quitar cobro' }));
    const confirmacion = within(
      await screen.findByRole('alertdialog', { name: '¿Quitar la marca de cobrada?' }),
    );
    await user.click(confirmacion.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(llamadasA('DELETE')).toHaveLength(0);
    expect(itemDeCobro().getByText('Cobrada el 10/11/2026')).toBeInTheDocument();
  });

  it('quitar con confirmación: la marca desaparece y se puede volver a registrar', async () => {
    servir({ inicial: { estado: 'ENVIADA', cobro: COBRO } });
    const { user } = renderDetalle();
    await titulo();

    await user.click(screen.getByRole('button', { name: 'Quitar cobro' }));
    const confirmacion = within(
      await screen.findByRole('alertdialog', { name: '¿Quitar la marca de cobrada?' }),
    );
    await user.click(confirmacion.getByRole('button', { name: 'Quitar marca' }));

    expect(await screen.findByText('Se quitó la marca de cobrada.')).toBeVisible();
    expect(llamadasA('DELETE')).toHaveLength(1);
    expect(itemDeCobro().queryByText(/Cobrada el/)).not.toBeInTheDocument();
    expect(botonRegistrar()).toBeInTheDocument();
  });

  it('desde la hoja, "Quitar marca" lleva a la misma confirmación', async () => {
    servir({ inicial: { estado: 'ENVIADA', cobro: COBRO } });
    const { user } = renderDetalle();
    await titulo();

    await user.click(screen.getByRole('button', { name: 'Editar cobro' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Cobro de la rendición' }));
    await user.click(hoja.getByRole('button', { name: 'Quitar marca' }));

    expect(
      await screen.findByRole('alertdialog', { name: '¿Quitar la marca de cobrada?' }),
    ).toBeVisible();
    expect(llamadasA('DELETE')).toHaveLength(0);
  });

  it('si la rendición dejó de ser cobrable mientras tanto (409), la hoja lo explica y sigue abierta', async () => {
    servir({
      inicial: { estado: 'ENVIADA' },
      respuestaDelPut: errorJson(409, 'CONFLICT', {
        motivo: 'COBRO_ESTADO_INVALIDO',
        estadoActual: 'RECHAZADA',
      }),
    });
    const { user } = renderDetalle();
    await titulo();

    await user.click(await screen.findByRole('button', { name: 'Registrar cobro' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Cobro de la rendición' }));
    await user.click(hoja.getByRole('button', { name: 'Guardar cobro' }));

    expect(
      await hoja.findByText(
        'Solo se puede registrar el cobro de una rendición enviada o aprobada.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Cobro de la rendición' })).toBeInTheDocument();
  });
});

describe('RendicionDetallePage: rechazar una rendición con cobro (HU3.10)', () => {
  it('el 409 COBRO_REGISTRADO se muestra en el diálogo de rechazo, que sigue abierto', async () => {
    servir({
      inicial: { estado: 'ENVIADA', cobro: COBRO },
      respuestaDelPatch: errorJson(409, 'CONFLICT', { motivo: 'COBRO_REGISTRADO' }),
    });
    const { user } = renderDetalle();
    await titulo();

    await user.click(
      screen.getByRole('button', { name: 'Rechazada: registrar que el cliente la rechazó' }),
    );
    const dialogo = within(
      await screen.findByRole('alertdialog', { name: 'Rechazada por el cliente' }),
    );
    await user.type(dialogo.getByLabelText('¿Qué observó el cliente?'), 'Falta la firma');
    await user.click(dialogo.getByRole('button', { name: 'Confirmar' }));

    expect(
      await dialogo.findByText('Tiene un cobro registrado: quitalo antes de rechazarla.'),
    ).toBeVisible();
    expect(
      screen.getByRole('alertdialog', { name: 'Rechazada por el cliente' }),
    ).toBeInTheDocument();
  });
});
