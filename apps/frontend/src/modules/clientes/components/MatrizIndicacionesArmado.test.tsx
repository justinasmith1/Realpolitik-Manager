import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '@/modules/clientes/api/indicaciones-armado.api';
import { MatrizIndicacionesArmado } from '@/modules/clientes/components/MatrizIndicacionesArmado';

const CLIENTE_ID = '11111111-1111-4111-a111-111111111111';

const cliente: Pick<Cliente, 'id' | 'estado' | 'razonSocial' | 'denominacion'> = {
  id: CLIENTE_ID,
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  estado: 'ACTIVO',
};

function renderComponente({
  onEditarCliente = vi.fn(),
}: {
  onEditarCliente?: () => void;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <MatrizIndicacionesArmado cliente={cliente} onEditarCliente={onEditarCliente} />
    </QueryClientProvider>,
  );

  return {
    ...renderResult,
    user: userEvent.setup(),
  };
}

describe('MatrizIndicacionesArmado (HU2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra el título de la sección y el botón de edición', () => {
    vi.spyOn(api, 'obtenerIndicacionesArmado').mockResolvedValue({
      indicacionesArmado: null,
    });

    renderComponente();

    expect(
      screen.getByRole('heading', { level: 2, name: 'Indicaciones de armado' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Editar en la ficha del cliente' }),
    ).toBeInTheDocument();
  });

  it('muestra el texto de las indicaciones respetando saltos de línea cuando existen', async () => {
    const textoConSaltos = 'Todo en un único PDF.\nFactura primero.\nFirma en cada captura.';
    vi.spyOn(api, 'obtenerIndicacionesArmado').mockResolvedValue({
      indicacionesArmado: textoConSaltos,
    });

    renderComponente();

    const contenedor = await screen.findByTestId('texto-indicaciones-armado');
    expect(contenedor).toHaveTextContent(/Todo en un único PDF/);
    expect(contenedor).toHaveTextContent(/Factura primero/);
    expect(contenedor).toHaveTextContent(/Firma en cada captura/);
    expect(contenedor).toHaveClass('whitespace-pre-wrap');
  });

  it('muestra mensaje por defecto cuando el cliente no tiene indicaciones registradas', async () => {
    vi.spyOn(api, 'obtenerIndicacionesArmado').mockResolvedValue({
      indicacionesArmado: null,
    });

    renderComponente();

    expect(await screen.findByText('Sin indicaciones de armado registradas.')).toBeInTheDocument();
  });

  it('llama a onEditarCliente al hacer clic en el botón de edición', async () => {
    vi.spyOn(api, 'obtenerIndicacionesArmado').mockResolvedValue({
      indicacionesArmado: 'Indicaciones existentes',
    });

    const onEditarCliente = vi.fn();
    const { user } = renderComponente({ onEditarCliente });

    const boton = screen.getByRole('button', { name: 'Editar en la ficha del cliente' });
    await user.click(boton);

    expect(onEditarCliente).toHaveBeenCalledTimes(1);
  });

  it('si no se pudieron cargar, lo dice en vez de afirmar que no hay indicaciones', async () => {
    vi.spyOn(api, 'obtenerIndicacionesArmado').mockRejectedValue(new Error('fallo de red'));

    renderComponente();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos cargar las indicaciones de armado.',
    );
    expect(screen.queryByText('Sin indicaciones de armado registradas.')).not.toBeInTheDocument();
  });

  it('Reintentar vuelve a pedirlas y muestra el texto', async () => {
    const obtener = vi
      .spyOn(api, 'obtenerIndicacionesArmado')
      .mockRejectedValueOnce(new Error('fallo de red'))
      .mockResolvedValueOnce({ indicacionesArmado: 'Todo en un único PDF.' });

    const { user } = renderComponente();
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByTestId('texto-indicaciones-armado')).toHaveTextContent(
      'Todo en un único PDF.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(obtener).toHaveBeenCalledTimes(2);
  });
});
