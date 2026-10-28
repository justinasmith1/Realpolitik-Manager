import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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

const id = (n: number) => `f1a2b3c4-d5e6-4789-8abc-def01234567${n}`;

/** Factura x1 (reunida, sin día), Print x2 (el primero con día 15) en ese orden. */
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
];

const todosReunidos = ITEMS.map((item) => ({
  ...item,
  completado: true,
  completadoEn: '2026-10-16T12:00:00.000Z',
}));

function servir(rendicion: () => Response = () => json({ ...rendicionJson(), items: ITEMS })) {
  fetchMock.mockImplementation((entrada) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(
        json({ indicacionesArmado: 'Todo en un único PDF.\nFactura primero.' }),
      );
    }
    if (url.includes('/rendiciones/')) return Promise.resolve(rendicion());
    return Promise.resolve(json(clienteJson));
  });
}

function renderDetalle(ruta = `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`) {
  const router = createMemoryRouter(
    [
      { path: '/clientes/:id/rendiciones/:rendicionId', element: <RendicionDetallePage /> },
      { path: '/clientes/:id/matriz', element: <h1>Matriz</h1> },
    ],
    { initialEntries: [ruta] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router };
}

const filas = () =>
  within(screen.getByRole('region', { name: 'Checklist' })).getAllByRole('listitem');

describe('RendicionDetallePage', () => {
  it('muestra cliente, período, factura, estado y avance', async () => {
    servir();
    renderDetalle();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' }),
    ).toHaveFocus();
    expect(await screen.findByText('Muni Ejemplo')).toBeInTheDocument();
    expect(screen.getByText('A 00001-00000001')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByText('1 de 3 reunidos')).toBeInTheDocument();
  });

  it('lista los ítems en el orden recibido, con el ordinal solo si hay más de uno', async () => {
    servir();
    renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    const [factura, print1, print2] = filas();
    expect(factura).toHaveTextContent(/^Factura(?! 1 de 1)/);
    expect(factura).not.toHaveTextContent('1 de 1');
    expect(print1).toHaveTextContent('Print 1 de 2');
    expect(print2).toHaveTextContent('Print 2 de 2');
  });

  it('muestra el día aproximado solo cuando lo tiene, y el canal efectivo', async () => {
    servir();
    renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    const [factura, print1, print2] = filas();
    expect(print1).toHaveTextContent('Día aprox. 15');
    expect(print1).toHaveTextContent('Portal web');
    expect(print2).not.toHaveTextContent('Día aprox.');
    expect(factura).not.toHaveTextContent('Día aprox.');
    expect(factura).toHaveTextContent('Correo');
  });

  it('destaca los faltantes y muestra el estado de cada ítem como texto', async () => {
    servir();
    renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    const [factura, print1] = filas();
    expect(factura).toHaveAttribute('data-estado', 'reunido');
    expect(factura).toHaveTextContent('Reunido');
    expect(print1).toHaveAttribute('data-estado', 'pendiente');
    expect(print1).toHaveTextContent('Pendiente');
    expect(print1).toHaveClass('border-warning');
  });

  it('"Ver solo faltantes" deja solo los pendientes', async () => {
    servir();
    const { user } = renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    await user.click(screen.getByRole('checkbox', { name: 'Ver solo faltantes (2)' }));

    expect(filas()).toHaveLength(2);
    expect(filas().every((fila) => fila.getAttribute('data-estado') === 'pendiente')).toBe(true);
  });

  it('con todos reunidos avisa que el checklist está completo', async () => {
    servir(() => json({ ...rendicionJson(), items: todosReunidos }));
    const { user } = renderDetalle();

    expect(
      await screen.findByText('Checklist completo: están todos los documentos.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Ver solo faltantes (0)' }));
    expect(screen.getByText('No hay documentos faltantes.')).toBeInTheDocument();
  });

  it('con documentos pendientes no dice que está completo', async () => {
    servir();
    renderDetalle();
    await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

    expect(screen.queryByText(/Checklist completo/)).not.toBeInTheDocument();
  });

  it('una rendición anulada se ve, con su aviso y su estado', async () => {
    servir(() =>
      json({
        ...rendicionJson({ estado: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' }),
        items: ITEMS,
      }),
    );
    renderDetalle();

    expect(await screen.findByText(/Anulada el 20 de octubre de 2026/)).toHaveTextContent(
      'Se conserva como historial: no se puede modificar.',
    );
    expect(screen.getByText('Anulada')).toBeInTheDocument();
    expect(filas()).toHaveLength(3);
  });

  it('muestra las indicaciones de armado del cliente en solo lectura', async () => {
    servir();
    renderDetalle();

    expect(await screen.findByTestId('texto-indicaciones-armado')).toHaveTextContent(
      'Todo en un único PDF.',
    );
    expect(
      screen.queryByRole('button', { name: 'Editar en la ficha del cliente' }),
    ).not.toBeInTheDocument();
  });

  it('el enlace vuelve a la matriz del cliente', async () => {
    servir();
    const { user, router } = renderDetalle();

    await user.click(
      await screen.findByRole('link', { name: 'Volver a los requisitos del cliente' }),
    );

    expect(router.state.location.pathname).toBe(`/clientes/${CLIENTE_ID}/matriz`);
  });

  it('un 404 dice que la rendición no existe', async () => {
    servir(() => errorJson(404, 'NOT_FOUND'));
    renderDetalle();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'La rendición no existe' }),
    ).toBeInTheDocument();
  });

  it('una rendición de otro cliente no existe para este', async () => {
    servir(() =>
      json({
        ...rendicionJson({ clienteId: 'b2c3d4e5-f6a7-4890-bcde-f01234567890' }),
        items: ITEMS,
      }),
    );
    renderDetalle();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'La rendición no existe' }),
    ).toBeInTheDocument();
  });

  it('si no se pudo cargar, lo dice y permite reintentar', async () => {
    let intentos = 0;
    servir(() => {
      intentos += 1;
      return intentos === 1
        ? errorJson(500, 'INTERNAL_ERROR')
        : json({ ...rendicionJson(), items: ITEMS });
    });
    const { user } = renderDetalle();

    expect(await screen.findByText('No pudimos cargar la rendición.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' }),
    ).toBeInTheDocument();
  });

  it('mientras carga muestra un esqueleto', () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderDetalle();

    expect(screen.getByTestId('rendicion-cargando')).toBeInTheDocument();
  });
});
