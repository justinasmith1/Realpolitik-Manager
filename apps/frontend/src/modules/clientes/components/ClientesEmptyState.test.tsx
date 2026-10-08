import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';

describe('ClientesEmptyState', () => {
  it('explica que todavía no hay clientes, con un encabezado de nivel 2', () => {
    render(<ClientesEmptyState onNuevoCliente={() => undefined} />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Todavía no cargaste clientes' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Los clientes que cargues aparecerán acá para que puedas consultar y organizar su información.',
      ),
    ).toBeInTheDocument();
  });

  it('invita a registrar el primer cliente', async () => {
    const onNuevoCliente = vi.fn();
    render(<ClientesEmptyState onNuevoCliente={onNuevoCliente} />);

    await userEvent.click(screen.getByRole('button', { name: 'Registrar el primer cliente' }));

    expect(onNuevoCliente).toHaveBeenCalledTimes(1);
  });
});
