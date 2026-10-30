import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function servir({
  inicial = {},
  ultimaOc = null,
  patchRespuesta,
}: {
  inicial?: Record<string, unknown>;
  ultimaOc?: { numeroOc: string; montoMensual: number | null; montoTotal: number | null } | null;
  patchRespuesta?: (cuerpo: Record<string, unknown>) => Response;
} = {}) {
  let actual = {
    ...rendicionJson(inicial),
    items: ITEMS,
  };

  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    const metodo = init?.method ?? 'GET';
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (url.endsWith(`/clientes/${CLIENTE_ID}/ultima-oc`)) {
      return Promise.resolve(json(ultimaOc));
    }
    if (url.endsWith(`/rendiciones/${RENDICION_ID}`) && metodo === 'PATCH') {
      const cuerpo = JSON.parse(init?.body as string) as Record<string, unknown>;
      if (patchRespuesta !== undefined) {
        return Promise.resolve(patchRespuesta(cuerpo));
      }
      actual = { ...actual, ...cuerpo };
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

const datoDeCabecera = (etiqueta: string) => {
  const termino = screen.getByText(etiqueta, { selector: 'dt' });
  return within(termino.parentElement as HTMLElement).getByRole('definition');
};

describe('RendicionDetallePage: Orden de Compra (HU2.11)', () => {
  it('muestra "No asignada" y "-" cuando la rendición no tiene OC cargada', async () => {
    servir();
    renderDetalle();

    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    expect(datoDeCabecera('Período')).toHaveTextContent('Octubre 2026');
    expect(datoDeCabecera('Número de factura')).toHaveTextContent('A 00001-00000001');
    expect(datoDeCabecera('Número de OC')).toHaveTextContent('No asignada');
    expect(datoDeCabecera('Monto mensual')).toHaveTextContent('-');
    expect(datoDeCabecera('Monto total')).toHaveTextContent('-');
    expect(screen.getByRole('button', { name: 'Editar OC' })).toBeInTheDocument();
  });

  it('formatea montoMensual y montoTotal como moneda cuando existen', async () => {
    servir({
      inicial: {
        numeroOc: 'OC-2026-88',
        montoMensual: 1250000,
        montoTotal: 15000000,
      },
    });
    renderDetalle();

    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    expect(datoDeCabecera('Número de OC')).toHaveTextContent('OC-2026-88');
    expect(datoDeCabecera('Monto mensual').textContent?.replace(/\s/g, ' ')).toBe('$ 1.250.000');
    expect(datoDeCabecera('Monto total').textContent?.replace(/\s/g, ' ')).toBe('$ 15.000.000');
  });

  it('en una rendición anulada no ofrece el botón Editar OC', async () => {
    servir({
      inicial: { estado: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' },
    });
    renderDetalle();

    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    expect(screen.queryByRole('button', { name: 'Editar OC' })).not.toBeInTheDocument();
  });

  it('al abrir el modal con los campos vacíos sugiere repetir la última OC, autocompleta los 3 inputs y guarda refrescando la cabecera y mostrando un Toast', async () => {
    servir({
      ultimaOc: {
        numeroOc: 'OC-2026-77',
        montoMensual: 1250000,
        montoTotal: 15000000,
      },
    });
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    await user.click(screen.getByRole('button', { name: 'Editar OC' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Orden de compra' }));

    const botonSugerencia = await dialog.findByRole('button', {
      name: '¿Repetir última OC (OC-2026-77)?',
    });
    await user.click(botonSugerencia);

    expect(dialog.getByLabelText(/Número de OC/)).toHaveValue('OC-2026-77');
    expect(dialog.getByLabelText(/Monto mensual/)).toHaveValue('1250000');
    expect(dialog.getByLabelText(/Monto total/)).toHaveValue('15000000');

    await user.click(dialog.getByRole('button', { name: 'Guardar OC' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Orden de compra' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Orden de compra guardada.')).toBeVisible();
    expect(datoDeCabecera('Número de OC')).toHaveTextContent('OC-2026-77');
    expect(datoDeCabecera('Monto mensual').textContent?.replace(/\s/g, ' ')).toBe('$ 1.250.000');
    expect(datoDeCabecera('Monto total').textContent?.replace(/\s/g, ' ')).toBe('$ 15.000.000');
  });

  it('si el número de OC pertenece a otro cliente (409 OC_DE_OTRO_CLIENTE), marca el campo sin cerrar el modal', async () => {
    servir({
      patchRespuesta: () =>
        errorJson(409, 'CONFLICT', { motivo: 'OC_DE_OTRO_CLIENTE', numeroOc: 'OC-AJENA' }),
    });
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    await user.click(screen.getByRole('button', { name: 'Editar OC' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Orden de compra' }));

    await user.type(dialog.getByLabelText(/Número de OC/), 'OC-AJENA');
    await user.click(dialog.getByRole('button', { name: 'Guardar OC' }));

    expect(
      await dialog.findByText('Ese número de OC ya está asignado a otro cliente.'),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Orden de compra' })).toBeInTheDocument();
  });
});
