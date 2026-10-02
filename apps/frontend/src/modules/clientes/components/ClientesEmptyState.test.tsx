import { render, screen } from '@testing-library/react';

import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';

describe('ClientesEmptyState', () => {
  it('explica que todavía no hay clientes, con un encabezado de nivel 2', () => {
    render(<ClientesEmptyState />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Todavía no cargaste clientes' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Los clientes que cargues aparecerán acá para que puedas consultar y organizar su información.',
      ),
    ).toBeInTheDocument();
  });
});
