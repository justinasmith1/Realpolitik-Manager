import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { MatricesPage } from './MatricesPage';

const mockClientes = [
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

function renderMatrices() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/clientes/matrices', element: <MatricesPage /> },
      { path: '/clientes/:id/matriz', element: <div>Detalle Matriz</div> },
    ],
    { initialEntries: ['/clientes/matrices'] },
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
    expect(screen.getAllByText('Configurada')).toHaveLength(2);
  });

  it('permite filtrar por estado (Todas, Configuradas, Pendientes)', async () => {
    const { user } = renderMatrices();

    // Clic en "Pendientes"
    const btnPendientes = screen.getByRole('button', { name: 'Pendientes' });
    await user.click(btnPendientes);

    expect(screen.getByText('Vialidad PBA')).toBeInTheDocument();
    expect(screen.queryByText('Consejo Magistratura')).not.toBeInTheDocument();
    expect(screen.queryByText('Abasto Norte')).not.toBeInTheDocument();

    // Clic en "Configuradas"
    const btnConfiguradas = screen.getByRole('button', { name: 'Configuradas' });
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
});
