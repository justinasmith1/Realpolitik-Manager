import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { elegirOpcion } from '@/test/select';

import { CargaMasivaWizard } from './CargaMasivaWizard';

const mockTipos = [
  { id: '11111111-1111-4111-a111-111111111111', nombre: 'Factura', activo: true },
  { id: '22222222-2222-4222-a222-222222222222', nombre: 'Remito', activo: true },
  { id: '33333333-3333-4333-a333-333333333333', nombre: 'Acta Vieja', activo: false },
];

const mockClientes = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    razonSocial: 'Empresa Alfa SA',
    denominacion: 'Alfa',
    cuit: '30-11111111-1',
    sector: 'PRIVADO',
    subtipo: null,
    estado: 'ACTIVO',
    matrizConfigurada: true,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    razonSocial: 'Municipalidad Beta',
    denominacion: 'Muni Beta',
    cuit: '30-22222222-2',
    sector: 'PUBLICO',
    subtipo: 'MUNICIPAL',
    estado: 'ACTIVO',
    matrizConfigurada: false,
  },
];

vi.mock('@/modules/tipos-documento/hooks/useTiposDocumento', () => ({
  useTiposDocumento: () => ({
    data: mockTipos,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/modules/clientes/hooks/useClientes', () => ({
  useClientes: () => ({
    data: mockClientes,
    isLoading: false,
    isError: false,
  }),
}));

const mockMutateAsync = vi.fn();
vi.mock('@/modules/clientes/hooks/useCargarRequisitosMasivo', () => ({
  useCargarRequisitosMasivo: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

function renderWizard(props: Partial<Parameters<typeof CargaMasivaWizard>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <CargaMasivaWizard open={true} onOpenChange={onOpenChange} onSuccess={onSuccess} {...props} />
    </QueryClientProvider>,
  );

  return {
    user: userEvent.setup(),
    onOpenChange,
    onSuccess,
  };
}

describe('CargaMasivaWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza el Paso 1 con catálogo activo y no permite avanzar sin seleccionar', async () => {
    const { user } = renderWizard();

    expect(
      screen.getByRole('heading', { name: 'Agregar requisito a varios clientes' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tipo')).toBeInTheDocument();

    // Intentar avanzar sin elegir tipo
    await user.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(screen.getByText('Elegí un tipo de documento.')).toBeInTheDocument();
  });

  it('selecciona un tipo de documento y avanza al Paso 2', async () => {
    const { user } = renderWizard();

    // Seleccionar Factura
    const selectTrigger = screen.getByRole('combobox');
    await elegirOpcion(user, selectTrigger, 'Factura');

    await user.click(screen.getByRole('button', { name: /Siguiente/i }));

    expect(
      await screen.findByRole('heading', { name: 'Clientes y configuración' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Alfa')).toBeInTheDocument();
    expect(screen.getByText('Muni Beta')).toBeInTheDocument();
  });

  it('en Paso 2 valida que al tildar se habilite cantidad y que si cantidad > 1 se requiera coherencia de días', async () => {
    const { user } = renderWizard();

    // Paso 1 -> elegir Factura y avanzar
    await elegirOpcion(user, screen.getByRole('combobox'), 'Factura');
    await user.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Paso 2: Sin clientes seleccionados, no permite avanzar
    await user.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(
      screen.getByText('Debes seleccionar al menos un cliente para continuar.'),
    ).toBeInTheDocument();

    // Tildar Alfa
    const chkAlfa = screen.getByRole('checkbox', { name: /Alfa/i });
    await user.click(chkAlfa);

    // Cantidad por default es 1
    const cantInput = screen.getByLabelText('Cantidad para Alfa');
    expect(cantInput).toHaveValue(1);

    // No debe haber input de días aproximados mientras cantidad sea 1
    expect(screen.queryByLabelText('Días aproximados para Alfa')).not.toBeInTheDocument();

    // Cambiar cantidad a 3
    await user.clear(cantInput);
    await user.type(cantInput, '3');

    // Ahora aparece el input de días aproximados
    const diasInput = await screen.findByLabelText('Días aproximados para Alfa');
    expect(diasInput).toBeInTheDocument();

    // Escribir solo 2 días ("5, 10") teniendo cantidad 3
    await user.type(diasInput, '5, 10');

    // Intentar avanzar
    await user.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Ver error inline
    expect(
      screen.getByText('Cargá 3 días aproximados (uno por documento) o dejá la lista vacía.'),
    ).toBeInTheDocument();
  });

  it('completa el flujo hasta el Paso 3 y dispara el submit final con payload correcto', async () => {
    mockMutateAsync.mockResolvedValueOnce({
      creados: ['aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'],
      omitidos: [],
    });

    const { user, onSuccess } = renderWizard();

    // Paso 1
    await elegirOpcion(user, screen.getByRole('combobox'), 'Factura');
    await user.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Paso 2: Seleccionar Alfa con cantidad 2 y días "5, 20"
    await user.click(screen.getByRole('checkbox', { name: /Alfa/i }));
    const cantInput = screen.getByLabelText('Cantidad para Alfa');
    await user.clear(cantInput);
    await user.type(cantInput, '2');

    const diasInput = await screen.findByLabelText('Días aproximados para Alfa');
    await user.type(diasInput, '5, 20');

    await user.click(screen.getByRole('button', { name: /Siguiente/i }));

    // Paso 3: Confirmación
    expect(await screen.findByText('Revisar')).toBeInTheDocument();
    expect(screen.getByText('Se agrega Factura a 1 cliente')).toBeInTheDocument();

    // Confirmar y aplicar
    await user.click(screen.getByRole('button', { name: /Confirmar y aplicar/i }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        tipoDocumentoId: '11111111-1111-4111-a111-111111111111',
        canalEntrega: null,
        nota: null,
        clientes: [
          {
            clienteId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
            cantidad: 2,
            diasAproximados: [5, 20],
          },
        ],
      });
      expect(onSuccess).toHaveBeenCalledWith({
        creadosCount: 1,
        omitidos: [],
      });
    });
  });
});
