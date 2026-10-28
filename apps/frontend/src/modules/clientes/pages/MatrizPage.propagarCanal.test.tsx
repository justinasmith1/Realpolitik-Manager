import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';
import { elegirOpcion } from '@/test/select';

// Pasar el canal nuevo de un requisito a sus ítems en rendiciones abiertas (ADR-0003, contrato 4.5).

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

const ID = '11111111-1111-4111-a111-111111111111';
const TIPO_PRINT = '33333333-3333-4333-a333-333333333333';
const REQ_PRINT = '55555555-5555-4555-a555-555555555555';
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

const print = (canalEntrega: string | null) => ({
  id: REQ_PRINT,
  clienteId: ID,
  tipoDocumento: { id: TIPO_PRINT, nombre: 'Print', activo: true },
  cantidad: 3,
  diasAproximados: [],
  canalEntrega,
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
  resumen: { totalItems: 3, completados: 0 },
  ...fechas,
});

const OCTUBRE = 'Octubre 2026 (factura A 00001-00000001)';
const SEPTIEMBRE = 'Septiembre 2026 (factura A 00001-00000002)';

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

/**
 * Servidor de mentira. `conRequisito` es lo que responde el listado filtrado por el requisito;
 * `propagar` reemplaza la respuesta del POST.
 */
function servir({
  canalDelPrint = 'WHATSAPP',
  conRequisito = [
    rendicion(REND_OCT, 10, 'A 00001-00000001'),
    rendicion(REND_SEP, 9, 'A 00001-00000002'),
  ],
  propagar,
}: {
  canalDelPrint?: string | null;
  conRequisito?: unknown[];
  propagar?: () => Response;
} = {}) {
  let requisito = print(canalDelPrint);
  fetchMock.mockImplementation((entrada, init) => {
    const url = new URL(urlDe(entrada));
    const path = url.pathname;
    const metodo = init?.method ?? 'GET';
    if (path === `/clientes/${ID}/requisitos/${REQ_PRINT}/propagar-canal` && metodo === 'POST') {
      if (propagar !== undefined) return Promise.resolve(propagar());
      const { rendicionIds } = JSON.parse(init?.body as string) as { rendicionIds: string[] };
      return Promise.resolve(
        json({
          canalEntrega: requisito.canalEntrega ?? cliente.canalEntrega,
          rendiciones: rendicionIds.map((rendicionId) => ({ rendicionId, itemsActualizados: 3 })),
        }),
      );
    }
    if (path === `/clientes/${ID}/requisitos/${REQ_PRINT}` && metodo === 'PATCH') {
      requisito = { ...requisito, ...(JSON.parse(init?.body as string) as object) };
      return Promise.resolve(json(requisito));
    }
    if (path === `/clientes/${ID}/requisitos`) return Promise.resolve(json([requisito]));
    if (path === `/clientes/${ID}/rendiciones`) {
      return Promise.resolve(
        json(
          url.searchParams.has('requisitoId')
            ? conRequisito
            : [
                rendicion(REND_OCT, 10, 'A 00001-00000001'),
                rendicion(REND_SEP, 9, 'A 00001-00000002'),
              ],
        ),
      );
    }
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    return Promise.resolve(json(cliente));
  });
}

const pedidos = (filtro: (url: URL, metodo: string) => boolean) =>
  fetchMock.mock.calls.filter(([entrada, init]) =>
    filtro(new URL(urlDe(entrada)), init?.method ?? 'GET'),
  );
const listadosPorRequisito = () =>
  pedidos((url) => url.pathname.endsWith('/rendiciones') && url.searchParams.has('requisitoId'));
const listados = () =>
  pedidos((url, metodo) => url.pathname === `/clientes/${ID}/rendiciones` && metodo === 'GET');
const propagaciones = () => pedidos((url) => url.pathname.endsWith('/propagar-canal'));

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

/** Edita el canal de Print desde el panel y guarda. */
async function cambiarCanalDelPrint(user: UserEvent, opcion: string) {
  await user.click(await screen.findByRole('button', { name: 'Acciones de Print' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
  const titulo = await screen.findByRole('heading', { name: 'Editar requisito' });
  const panel = titulo.closest('[role="dialog"]') as HTMLElement;
  await elegirOpcion(user, within(panel).getByLabelText('Canal de entrega'), opcion);
  await user.click(within(panel).getByRole('button', { name: 'Guardar cambios' }));
  await screen.findByText('Se guardaron los cambios de Print.');
}

const dialogo = () =>
  screen.findByRole('alertdialog', {
    name: '¿Actualizar el canal en las rendiciones abiertas?',
  });

describe('MatrizPage: actualizar el canal en las rendiciones abiertas', () => {
  it('al cambiar el canal lo ofrece para las activas con ese requisito, sin ninguna tildada', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });

    await cambiarCanalDelPrint(user, 'PORTAL_WEB');

    const ventana = within(await dialogo());
    expect(ventana.getByText(/«Print» ahora se envía por Portal web\./)).toBeInTheDocument();
    expect(ventana.getByRole('checkbox', { name: OCTUBRE })).not.toBeChecked();
    expect(ventana.getByRole('checkbox', { name: SEPTIEMBRE })).not.toBeChecked();
    expect(ventana.getByRole('button', { name: 'Actualizar las elegidas' })).toBeDisabled();
    const [[entrada]] = listadosPorRequisito() as [[Parameters<typeof fetch>[0]]];
    const { searchParams } = new URL(urlDe(entrada));
    expect(Object.fromEntries(searchParams)).toEqual({ estado: 'ACTIVA', requisitoId: REQ_PRINT });
  });

  it('volver a heredar también lo ofrece, con el canal del cliente', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });

    await cambiarCanalDelPrint(user, 'Usar canal principal del cliente (Correo)');

    expect(
      within(await dialogo()).getByText(/«Print» ahora se envía por Correo\./),
    ).toBeInTheDocument();
  });

  it('si el canal efectivo no cambia, no lo ofrece', async () => {
    // Heredaba Correo y pasa a Correo propio: los ítems ya van por Correo.
    servir({ canalDelPrint: null });
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });

    await cambiarCanalDelPrint(user, 'CORREO');

    expect(
      pedidos((url, metodo) => metodo === 'PATCH' && url.pathname.includes(REQ_PRINT)),
    ).toHaveLength(1);
    expect(listadosPorRequisito()).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sin rendiciones activas con ese requisito, no lo ofrece', async () => {
    servir({ conRequisito: [] });
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });

    await cambiarCanalDelPrint(user, 'PORTAL_WEB');

    await waitFor(() => expect(listadosPorRequisito()).toHaveLength(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('"Ahora no" cierra sin actualizar ninguna', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await cambiarCanalDelPrint(user, 'PORTAL_WEB');

    await user.click(within(await dialogo()).getByRole('button', { name: 'Ahora no' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(propagaciones()).toEqual([]);
  });

  it('actualiza solo las elegidas, lo avisa y vuelve a pedir las rendiciones', async () => {
    servir();
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await cambiarCanalDelPrint(user, 'PORTAL_WEB');
    const ventana = within(await dialogo());
    const antes = listados().length;

    await user.click(ventana.getByRole('checkbox', { name: OCTUBRE }));
    await user.click(ventana.getByRole('button', { name: 'Actualizar las elegidas' }));

    expect(await screen.findByText('Se actualizó el canal en 1 rendición.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    const [[, init]] = propagaciones() as [[unknown, RequestInit]];
    expect(JSON.parse(init.body as string)).toEqual({ rendicionIds: [REND_OCT] });
    await waitFor(() => expect(listados().length).toBeGreaterThan(antes));
  });

  it('si falla, el requisito queda guardado y el error se ve en el diálogo sin perder la selección', async () => {
    servir({
      propagar: () =>
        json(
          {
            error: {
              code: 'CONFLICT',
              message: 'x',
              details: { motivo: 'RENDICION_ANULADA', rendicionId: REND_SEP },
            },
          },
          409,
        ),
    });
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await cambiarCanalDelPrint(user, 'PORTAL_WEB');
    const ventana = within(await dialogo());

    await user.click(ventana.getByRole('checkbox', { name: OCTUBRE }));
    await user.click(ventana.getByRole('checkbox', { name: SEPTIEMBRE }));
    await user.click(ventana.getByRole('button', { name: 'Actualizar las elegidas' }));

    expect(
      await ventana.findByText(
        `El requisito quedó guardado, pero no se actualizó ninguna rendición: ${SEPTIEMBRE} está anulada. Destildala y probá de nuevo.`,
      ),
    ).toBeVisible();
    expect(ventana.getByRole('checkbox', { name: OCTUBRE })).toBeChecked();
    expect(ventana.getByRole('checkbox', { name: SEPTIEMBRE })).toBeChecked();
    expect(ventana.getByRole('button', { name: 'Actualizar las elegidas' })).toBeEnabled();
    expect(screen.getByText('Se guardaron los cambios de Print.')).toBeInTheDocument();
  });

  it('un error inesperado también se muestra en el diálogo', async () => {
    servir({ propagar: () => json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500) });
    const { user } = renderMatriz();
    await screen.findByRole('article', { name: 'Octubre 2026' });
    await cambiarCanalDelPrint(user, 'PORTAL_WEB');
    const ventana = within(await dialogo());

    await user.click(ventana.getByRole('checkbox', { name: OCTUBRE }));
    await user.click(ventana.getByRole('button', { name: 'Actualizar las elegidas' }));

    expect(
      await ventana.findByText(
        'El requisito quedó guardado, pero no se actualizó ninguna rendición: probá de nuevo en unos segundos.',
      ),
    ).toBeVisible();
  });
});
