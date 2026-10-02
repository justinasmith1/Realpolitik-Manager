import { render, screen } from '@testing-library/react';

import { ClientesLoadingState } from '@/modules/clientes/components/ClientesLoadingState';

describe('ClientesLoadingState', () => {
  it('anuncia la carga a los lectores de pantalla con una región de estado', () => {
    render(<ClientesLoadingState />);

    expect(screen.getByRole('status')).toHaveTextContent('Cargando clientes');
  });

  it('marca como ocupado el contenido que se está cargando', () => {
    const { container } = render(<ClientesLoadingState />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('mantiene el mensaje fuera del contenedor ocupado, para que se anuncie', () => {
    render(<ClientesLoadingState />);

    expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
  });
});
