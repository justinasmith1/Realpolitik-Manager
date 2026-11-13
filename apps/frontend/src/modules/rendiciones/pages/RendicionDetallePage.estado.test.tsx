import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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

// La cabecera del detalle muestra el estado actual y el historial de cambios (HU3.1).

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

function servir(rendicion: Record<string, unknown>) {
  fetchMock.mockImplementation((entrada) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (url.includes('/rendiciones/')) {
      return Promise.resolve(json({ ...rendicionJson(rendicion), items: [itemJson()] }));
    }
    return Promise.resolve(
      json({
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
      }),
    );
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
}

const datoDeCabecera = (etiqueta: string) => {
  const termino = screen.getByText(etiqueta, { selector: 'dt' });
  return within(termino.parentElement as HTMLElement).getByRole('definition');
};

describe('RendicionDetallePage: estado e historial (HU3.1)', () => {
  it('la cabecera muestra el estado actual y el historial con sus fechas, en orden', async () => {
    servir({
      estado: 'COMPLETA',
      historial: [
        { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-01T15:00:00.000Z' },
        { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-10-20T15:00:00.000Z' },
      ],
    });
    renderDetalle();

    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    expect(datoDeCabecera('Estado')).toHaveTextContent('Completa');
    expect(datoDeCabecera('Vigencia')).toHaveTextContent('Activa');
    // El historial es un toggle plegado ("Historial (2)"): la fila despliega la lista.
    const historial = within(screen.getByRole('region', { name: 'Historial' }));
    expect(historial.queryAllByRole('listitem')).toHaveLength(0);
    await userEvent.setup().click(historial.getByRole('button', { name: 'Historial (2)' }));
    expect(historial.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '01/10/2026Se abrió enEn curso',
      '20/10/2026Pasó aCompleta',
    ]);
  });

  it('una anulada muestra el estado que conservó y la vigencia Anulada', async () => {
    servir({ estado: 'ENVIADA', vigencia: 'ANULADA', anuladaEn: '2026-10-22T15:00:00.000Z' });
    renderDetalle();

    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });
    expect(datoDeCabecera('Estado')).toHaveTextContent('Enviada');
    expect(datoDeCabecera('Vigencia')).toHaveTextContent('Anulada');
  });
});
