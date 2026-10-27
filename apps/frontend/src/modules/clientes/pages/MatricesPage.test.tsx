import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { MatricesPage } from './MatricesPage';

let mockClientes: typeof clientesBase = [];

const clientesBase = [
  {
    id: '11111111-1111-4111-a111-111111111111',
    razonSocial: 'Consejo de la Magistratura',
    denominacion: 'Consejo Magistratura',
    cuit: '30-11111111-1',
    sector: 'PUBLICO',
    subtipo: 'PROVINCIAL_ORGANISMO',
    estado: 'ACTIVO',
    matrizConfigurada: true,
  },
  {
    id: '22222222-2222-4222-a222-222222222222',
    razonSocial: 'Dirección de Vialidad PBA',
    denominacion: 'Vialidad PBA',
    cuit: '30-22222222-2',
    sector: 'PUBLICO',
    subtipo: 'PROVINCIAL_ORGANISMO',
    estado: 'ACTIVO',
    matrizConfigurada: false,
  },
  {
    id: '33333333-3333-4333-a333-333333333333',
    razonSocial: 'Cooperativa Abasto Norte',
    denominacion: 'Abasto Norte',
    cuit: '30-33333333-3',
    sector: 'PRIVADO',
    subtipo: null,
    estado: 'ACTIVO',
    matrizConfigurada: true,
  },
];

mockClientes = clientesBase;

const mockRequisitosPorCliente = new Map([
  [
    '11111111-1111-4111-a111-111111111111',
    [
      { id: 'r1', tipoDocumento: { id: 't1', nombre: 'Factura', activo: true }, cantidad: 1 },
      { id: 'r2', tipoDocumento: { id: 't2', nombre: 'Print', activo: true }, cantidad: 1 },
      { id: 'r3', tipoDocumento: { id: 't3', nombre: 'CAE', activo: true }, cantidad: 1 },
    ],
  ],
  [
    '33333333-3333-4333-a333-333333333333',
    [{ id: 'r4', tipoDocumento: { id: 't1', nombre: 'Factura', activo: true }, cantidad: 1 }],
  ],
]);

vi.mock('@/modules/clientes/hooks/useClientes', () => ({
  useClientes: () => ({
    data: mockClientes,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/modules/clientes/hooks/useRequisitosMultiplesClientes', () => ({
  useRequisitosMultiplesClientes: () => ({
    requisitosPorCliente: mockRequisitosPorCliente,
    isLoading: false,
  }),
}));

vi.mock('@/modules/tipos-documento/hooks/useTiposDocumento', () => ({
  useTiposDocumento: () => ({
    data: [{ id: 't1', nombre: 'Factura', activo: true }],
    isLoading: false,
    isError: false,
  }),
}));

function renderMatrices(entrada = '/clientes/matrices') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/clientes/matrices', element: <MatricesPage /> },
      { path: '/clientes/:id/matriz', element: <div>Detalle Matriz</div> },
    ],
    { initialEntries: [entrada] },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    user: userEvent.setup(),
    router,
  };
}

const busqueda = (router: ReturnType<typeof renderMatrices>['router']) =>
  router.state.location.search;

describe('MatricesPage', () => {
  it('muestra el botón destacado de añadir requisitos, la tabla con columnas CLIENTE, REQUISITOS, ESTADO y los datos', () => {
    renderMatrices();

    expect(
      screen.getByRole('button', { name: /Añadir requisitos a varios clientes/i }),
    ).toBeInTheDocument();

    expect(screen.getByRole('columnheader', { name: 'CLIENTE' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'REQUISITOS' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ESTADO' })).toBeInTheDocument();

    expect(screen.getByText('Consejo Magistratura')).toBeInTheDocument();
    expect(screen.getByText('Vialidad PBA')).toBeInTheDocument();
    expect(screen.getByText('Abasto Norte')).toBeInTheDocument();

    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getAllByText('Configurado')).toHaveLength(2);
  });

  it('permite filtrar por estado (Todos, Configurados, Pendientes)', async () => {
    const { user } = renderMatrices();

    // Clic en "Pendientes"
    const btnPendientes = screen.getByRole('button', { name: 'Pendientes' });
    await user.click(btnPendientes);

    expect(screen.getByText('Vialidad PBA')).toBeInTheDocument();
    expect(screen.queryByText('Consejo Magistratura')).not.toBeInTheDocument();
    expect(screen.queryByText('Abasto Norte')).not.toBeInTheDocument();

    // Clic en "Configurados"
    const btnConfiguradas = screen.getByRole('button', { name: 'Configurados' });
    await user.click(btnConfiguradas);

    expect(screen.getByText('Consejo Magistratura')).toBeInTheDocument();
    expect(screen.getByText('Abasto Norte')).toBeInTheDocument();
    expect(screen.queryByText('Vialidad PBA')).not.toBeInTheDocument();
  });

  it('permite filtrar por texto de cliente', async () => {
    const { user } = renderMatrices();

    const searchInput = screen.getByPlaceholderText('Filtrar clientes…');
    await user.type(searchInput, 'Abasto');

    expect(screen.getByText('Abasto Norte')).toBeInTheDocument();
    expect(screen.queryByText('Consejo Magistratura')).not.toBeInTheDocument();
    expect(screen.queryByText('Vialidad PBA')).not.toBeInTheDocument();
  });

  it('abre el Wizard al clickear el botón de añadir requisitos a varios clientes', async () => {
    const { user } = renderMatrices();

    const btnMasivo = screen.getByRole('button', { name: /Añadir requisitos a varios clientes/i });
    await user.click(btnMasivo);

    expect(await screen.findByText('Agregar requisito a varios clientes')).toBeInTheDocument();
  });

  it('carga con ?matrizConfigurada=false y ya muestra solo los pendientes', () => {
    renderMatrices('/clientes/matrices?matrizConfigurada=false');

    expect(screen.getByText('Vialidad PBA')).toBeInTheDocument();
    expect(screen.queryByText('Consejo Magistratura')).not.toBeInTheDocument();
    expect(screen.queryByText('Abasto Norte')).not.toBeInTheDocument();
  });

  it('elegir Pendientes actualiza la URL y Todos la limpia', async () => {
    const { user, router } = renderMatrices();

    await user.click(screen.getByRole('button', { name: 'Pendientes' }));
    expect(busqueda(router)).toBe('?matrizConfigurada=false');

    await user.click(screen.getByRole('button', { name: 'Todos' }));
    expect(busqueda(router)).toBe('');
    expect(screen.getByText('Abasto Norte')).toBeInTheDocument();
  });

  it('al volver (Atrás) desde el detalle de un cliente conserva el filtro', async () => {
    const { user, router } = renderMatrices('/clientes/matrices?matrizConfigurada=false');

    await user.click(screen.getByText('Vialidad PBA'));
    expect(await screen.findByText('Detalle Matriz')).toBeInTheDocument();

    await act(() => router.navigate(-1));

    expect(busqueda(router)).toBe('?matrizConfigurada=false');
    expect(screen.getByText('Vialidad PBA')).toBeInTheDocument();
    expect(screen.queryByText('Abasto Norte')).not.toBeInTheDocument();
  });

  it('con Pendientes y ningún cliente pendiente muestra el mensaje genérico de sin coincidencias', () => {
    mockClientes = clientesBase.filter((c) => c.matrizConfigurada);
    try {
      renderMatrices('/clientes/matrices?matrizConfigurada=false');

      expect(
        screen.getByText('No hay clientes que coincidan con los filtros aplicados.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      mockClientes = clientesBase;
    }
  });

  it('al abrir un cliente pasa el origen y el filtro en el state de la navegación', async () => {
    const { user, router } = renderMatrices('/clientes/matrices?matrizConfigurada=false');

    await user.click(screen.getByText('Vialidad PBA'));

    expect(await screen.findByText('Detalle Matriz')).toBeInTheDocument();
    expect(router.state.location.state).toEqual({
      origen: 'requisitos',
      busqueda: '?matrizConfigurada=false',
    });
  });
});
