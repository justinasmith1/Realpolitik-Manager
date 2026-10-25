import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '@/modules/clientes/api/indicaciones-armado.api';
import { IndicacionesArmadoSection } from '@/modules/clientes/components/IndicacionesArmadoSection';

const CLIENTE_ID = '11111111-1111-4111-a111-111111111111';

const clienteActivo: Cliente = {
  id: CLIENTE_ID,
  razonSocial: 'Empresa Activa S.A.',
  denominacion: 'Empresa Activa',
  cuit: '30-11111111-1',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'activa@ejemplo.com',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: new Date('2026-10-08T12:00:00.000Z'),
  actualizadoEn: new Date('2026-10-08T12:00:00.000Z'),
};

const clienteInactivo: Cliente = {
  ...clienteActivo,
  estado: 'INACTIVO',
};

const clienteSuspendido: Cliente = {
  ...clienteActivo,
  estado: 'SUSPENDIDO',
};

function renderComponente({
  cliente = clienteActivo,
  valorInicial,
  onCambio,
}: {
  cliente?: Pick<Cliente, 'id' | 'estado' | 'razonSocial'> | null;
  valorInicial?: string | null;
  onCambio?: (valor: string, modificado: boolean) => void;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <IndicacionesArmadoSection
        cliente={cliente}
        valorInicial={valorInicial}
        onCambio={onCambio}
      />
    </QueryClientProvider>,
  );

  return {
    ...renderResult,
    user: userEvent.setup(),
  };
}

describe('IndicacionesArmadoSection (HU2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'obtenerIndicacionesArmado').mockResolvedValue({
      indicacionesArmado: null,
    });
    vi.spyOn(api, 'guardarIndicacionesArmado').mockResolvedValue({
      indicacionesArmado: 'Factura primero.',
    });
  });

  it('muestra la advertencia de seguridad destacada sobre contraseñas', () => {
    renderComponente();

    expect(
      screen.getByText(
        'Atención: No utilices este campo para guardar contraseñas de portales gubernamentales.',
      ),
    ).toBeInTheDocument();
  });

  it('muestra el textarea y el contador dinámico de caracteres arrancando en 0', () => {
    renderComponente();

    const textarea = screen.getByPlaceholderText(
      /Escribí aquí cómo exige el cliente armar el legajo/i,
    );
    expect(textarea).toBeInTheDocument();
    expect(screen.getAllByText('0 / 1000').length).toBeGreaterThan(0);
  });

  it('actualiza el contador dinámicamente a medida que se escribe', async () => {
    const { user } = renderComponente();

    const textarea = screen.getByPlaceholderText(
      /Escribí aquí cómo exige el cliente armar el legajo/i,
    );
    await user.type(textarea, 'Todo en un PDF');

    expect(screen.getAllByText('14 / 1000').length).toBeGreaterThan(0);
  });

  it('no muestra un botón propio de guardar (el submit se unifica con el formulario del cliente)', () => {
    renderComponente();

    expect(screen.queryByRole('button', { name: /guardar/i })).not.toBeInTheDocument();
  });

  it('deshabilita el textarea si el cliente está INACTIVO y muestra aviso', () => {
    renderComponente({ cliente: clienteInactivo });

    const textarea = screen.getByPlaceholderText(
      /Escribí aquí cómo exige el cliente armar el legajo/i,
    );
    expect(textarea).toBeDisabled();

    expect(
      screen.getByText(
        /El cliente está inactivo\. Debe reactivarse para editar sus indicaciones de armado\./i,
      ),
    ).toBeInTheDocument();
  });

  it('deshabilita el textarea si el cliente está SUSPENDIDO y muestra aviso', () => {
    renderComponente({ cliente: clienteSuspendido });

    const textarea = screen.getByPlaceholderText(
      /Escribí aquí cómo exige el cliente armar el legajo/i,
    );
    expect(textarea).toBeDisabled();

    expect(
      screen.getByText(
        /El cliente está suspendido\. Debe reactivarse para editar sus indicaciones de armado\./i,
      ),
    ).toBeInTheDocument();
  });

  it('notifica al callback onCambio con el texto y estado modificado al escribir', async () => {
    const onCambio = vi.fn();
    const { user } = renderComponente({ onCambio });

    const textarea = screen.getByPlaceholderText(
      /Escribí aquí cómo exige el cliente armar el legajo/i,
    );
    await user.type(textarea, 'Factura primero.');

    await waitFor(() => {
      expect(onCambio).toHaveBeenCalledWith('Factura primero.', true);
    });
  });
});
