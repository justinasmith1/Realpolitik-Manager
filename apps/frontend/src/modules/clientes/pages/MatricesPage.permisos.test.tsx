// MatricesPage según el rol (HU4.3): CONSULTA lee el listado de requisitos, filtra, ordena y
// abre la matriz de cada cliente, pero no tiene la carga masiva (ni se monta su asistente).

import type { RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { MatricesPage } from '@/modules/clientes/pages/MatricesPage';

const comunes = {
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  estado: 'ACTIVO',
  canalEntrega: 'CORREO',
};
const clientes = [
  {
    ...comunes,
    id: '11111111-1111-4111-a111-111111111111',
    denominacion: 'Abasto Norte',
    razonSocial: 'Mercado de Abasto Norte',
    cuit: '30-33333333-3',
    matrizConfigurada: true,
  },
  {
    ...comunes,
    id: '22222222-2222-4222-a222-222222222222',
    denominacion: 'Vialidad PBA',
    razonSocial: 'Dirección de Vialidad PBA',
    cuit: '30-22222222-2',
    matrizConfigurada: false,
  },
];
const requisitos = new Map([
  [
    '11111111-1111-4111-a111-111111111111',
    [{ id: 'r1', tipoDocumento: { id: 't1', nombre: 'Factura', activo: true }, cantidad: 1 }],
  ],
]);

vi.mock('@/modules/clientes/hooks/useClientes', () => ({
  useClientes: () => ({ data: clientes, isLoading: false, isError: false }),
}));
vi.mock('@/modules/clientes/hooks/useRequisitosMultiplesClientes', () => ({
  useRequisitosMultiplesClientes: () => ({ requisitosPorCliente: requisitos, isLoading: false }),
}));
// El asistente real es de los roles operativos (sus tests están en `carga-masiva/`): acá solo
// importa si la página lo monta.
vi.mock('@/modules/clientes/components/carga-masiva/CargaMasivaWizard', () => ({
  CargaMasivaWizard: () => <div data-testid="asistente-carga-masiva" />,
}));

function renderMatrices(rol: RolUsuarioType) {
  const queryClient = sembrarSesion(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    { rol },
  );
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
  return { user: userEvent.setup(), router };
}

const botonMasivo = () =>
  screen.queryByRole('button', { name: /Añadir requisitos a varios clientes/i });

describe('MatricesPage con CONSULTA', () => {
  it('ve el listado y su resumen, sin carga masiva ni su asistente montado', () => {
    renderMatrices('CONSULTA');

    expect(screen.getByRole('table', { name: 'Listado de requisitos por cliente' })).toBeVisible();
    expect(screen.getByText('Factura')).toBeInTheDocument();
    expect(screen.getByText('Configurado')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(botonMasivo()).not.toBeInTheDocument();
    expect(screen.queryByTestId('asistente-carga-masiva')).not.toBeInTheDocument();
  });

  it('filtra por estado y por texto, y abre la matriz de un cliente', async () => {
    const { user, router } = renderMatrices('CONSULTA');

    await user.click(screen.getByRole('button', { name: 'Pendientes' }));
    expect(screen.queryByText('Abasto Norte')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Todos' }));
    await user.type(screen.getByPlaceholderText('Filtrar clientes…'), 'Vialidad');
    expect(screen.queryByText('Abasto Norte')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Vialidad PBA' }));

    expect(router.state.location.pathname).toBe(
      '/clientes/22222222-2222-4222-a222-222222222222/matriz',
    );
  });
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('MatricesPage con %s', (rol) => {
  it('conserva la carga masiva', () => {
    renderMatrices(rol);

    expect(botonMasivo()).toBeInTheDocument();
    expect(screen.getByTestId('asistente-carga-masiva')).toBeInTheDocument();
  });
});
