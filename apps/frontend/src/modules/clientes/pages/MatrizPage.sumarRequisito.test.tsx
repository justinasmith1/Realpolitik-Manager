import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';
import { elegirOpcion } from '@/test/select';

// Sumar un requisito recién agregado a rendiciones abiertas (HU2.5, contrato 4.5).

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

const ID = '11111111-1111-4111-a111-111111111111';
const TIPO_FACTURA = '22222222-2222-4222-a222-222222222222';
const TIPO_PRINT = '33333333-3333-4333-a333-333333333333';
const REQ_PRINT = '55555555-5555-4555-a555-555555555555';
const REQ_NUEVO = '77777777-7777-4777-a777-777777777777';
const REND_OCT = 'aaaaaaaa-0000-4000-8000-000000000001';
const REND_SEP = 'aaaaaaaa-0000-4000-8000-000000000002';

const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };

const cliente = {
  id: ID,
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: true,
  ...fechas,
};

const requisito = (id: string, tipoId: string, nombre: string) => ({
  id,
  clienteId: ID,
  tipoDocumento: { id: tipoId, nombre, activo: true },
  cantidad: 2,
  diasAproximados: [],
  canalEntrega: null,
  nota: null,
  ...fechas,
});

const rendicion = (id: string, mes: number, numeroFactura: string) => ({
  id,
  clienteId: ID,
  anio: 2026,
  mes,
  numeroFactura,
  estado: 'ACTIVA',
  anuladaEn: null,
  resumen: { totalItems: 2, completados: 0 },
  ...fechas,
});

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

/** `sumar` responde el POST de cada rendición; por defecto, 200. */
function servir({
  rendiciones = [
    rendicion(REND_OCT, 10, 'A 00001-00000001'),
    rendicion(REND_SEP, 9, 'A 00001-00000002'),
  ],
  sumar = () => json({ ...rendicion(REND_OCT, 10, 'A 00001-00000001'), items: [] }),
}: {
  rendiciones?: unknown[];
  sumar?: (rendicionId: string) => Response;
} = {}) {
  fetchMock.mockImplementation((entrada, init) => {
    const path = new URL(urlDe(entrada)).pathname;
    const metodo = init?.method ?? 'GET';
    if (path === '/tipos-documento') {
      return Promise.resolve(
        json([
          { id: TIPO_FACTURA, nombre: 'Factura', descripcion: null, activo: true, ...fechas },
          { id: TIPO_PRINT, nombre: 'Print', descripcion: null, activo: true, ...fechas },
        ]),
      );
    }
    if (path === `/clientes/${ID}/requisitos` && metodo === 'POST') {
      return Promise.resolve(json(requisito(REQ_NUEVO, TIPO_FACTURA, 'Factura'), 201));
    }
    if (path === `/clientes/${ID}/requisitos`) {
      return Promise.resolve(json([requisito(REQ_PRINT, TIPO_PRINT, 'Print')]));
    }
    if (path === `/clientes/${ID}/rendiciones`) return Promise.resolve(json(rendiciones));
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    const sumarA = /^\/rendiciones\/([^/]+)\/requisitos\//.exec(path);
    if (sumarA !== null && metodo === 'POST') return Promise.resolve(sumar(sumarA[1] ?? ''));
    return Promise.resolve(json(cliente));
  });
}

const posteosDeSumar = () =>
  fetchMock.mock.calls
    .filter(
      ([entrada, init]) => init?.method === 'POST' && urlDe(entrada).includes('/rendiciones/'),
    )
    .map(([entrada]) => new URL(urlDe(entrada)).pathname);

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderMatriz() {
  const router = createMemoryRouter([{ path: '/clientes/:id/matriz', element: <MatrizPage /> }], {
    initialEntries: [`/clientes/${ID}/matriz`],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

/** Agrega "Factura" a la matriz desde el panel de alta. */
async function agregarFactura(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
  const titulo = await screen.findByRole('heading', { name: 'Agregar requisito' });
  const panel = titulo.closest('[role="dialog"]') as HTMLElement;
  await elegirOpcion(user, within(panel).getByLabelText('Tipo de documento'), 'Factura');
  await user.click(within(panel).getByRole('button', { name: 'Agregar requisito' }));
}

const dialogo = () =>
  screen.findByRole('alertdialog', { name: '¿Sumarlo a las rendiciones abiertas?' });

describe('MatrizPage: sumar un requisito nuevo a rendiciones abiertas', () => {
  it('con rendiciones abiertas lo ofrece, sin ninguna tildada: sumar es explícito', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });

    await agregarFactura(user);

    const ventana = within(await dialogo());
    expect(
      ventana.getByRole('checkbox', { name: 'Octubre 2026 (factura A 00001-00000001)' }),
    ).not.toBeChecked();
    expect(
      ventana.getByRole('checkbox', { name: 'Septiembre 2026 (factura A 00001-00000002)' }),
    ).not.toBeChecked();
    expect(ventana.getByRole('button', { name: 'Sumar a las elegidas' })).toBeDisabled();
  });

  it('"Ahora no" cierra sin sumar a ninguna', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await agregarFactura(user);

    await user.click(within(await dialogo()).getByRole('button', { name: 'Ahora no' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(posteosDeSumar()).toEqual([]);
  });

  it('sin rendiciones abiertas no lo ofrece', async () => {
    servir({ rendiciones: [] });
    const { user } = renderMatriz();
    await screen.findByText('No hay rendiciones activas para este cliente.');

    await agregarFactura(user);

    expect(
      await screen.findByText('Se agregó Factura a los requisitos del cliente.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('suma solo a las elegidas y lo avisa', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await agregarFactura(user);

    const ventana = within(await dialogo());
    await user.click(
      ventana.getByRole('checkbox', { name: 'Octubre 2026 (factura A 00001-00000001)' }),
    );
    await user.click(ventana.getByRole('button', { name: 'Sumar a las elegidas' }));

    expect(
      await screen.findByText('Se sumó Factura a Octubre 2026 (factura A 00001-00000001).'),
    ).toBeInTheDocument();
    expect(posteosDeSumar()).toEqual([`/rendiciones/${REND_OCT}/requisitos/${REQ_NUEVO}`]);
  });

  it('si alguna falla, informa cuáles se sumaron y cuáles no', async () => {
    servir({
      sumar: (rendicionId) =>
        rendicionId === REND_SEP
          ? json(
              {
                error: {
                  code: 'CONFLICT',
                  message: 'x',
                  details: { motivo: 'REQUISITO_YA_EN_RENDICION' },
                },
              },
              409,
            )
          : json({ ...rendicion(REND_OCT, 10, 'A 00001-00000001'), items: [] }),
    });
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await agregarFactura(user);

    const ventana = within(await dialogo());
    await user.click(
      ventana.getByRole('checkbox', { name: 'Octubre 2026 (factura A 00001-00000001)' }),
    );
    await user.click(
      ventana.getByRole('checkbox', { name: 'Septiembre 2026 (factura A 00001-00000002)' }),
    );
    await user.click(ventana.getByRole('button', { name: 'Sumar a las elegidas' }));

    expect(
      await screen.findByText(
        'Se sumó Factura a Octubre 2026 (factura A 00001-00000001). No se pudo sumar a Septiembre 2026 (factura A 00001-00000002): ya tenía ese documento.',
      ),
    ).toBeInTheDocument();
    expect(posteosDeSumar()).toHaveLength(2);
  });
});
