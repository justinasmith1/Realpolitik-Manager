import { render, screen, within } from '@testing-library/react';

import { ClientesErrorState } from '@/modules/clientes/components/ClientesErrorState';

describe('ClientesErrorState', () => {
  it('se anuncia como alerta con el mensaje principal', () => {
    render(<ClientesErrorState />);

    const alerta = screen.getByRole('alert');
    expect(
      within(alerta).getByRole('heading', { level: 2, name: 'No pudimos cargar los clientes' }),
    ).toBeInTheDocument();
    expect(within(alerta).getByText('Error de conexión')).toBeInTheDocument();
  });

  it('muestra el diagnóstico, y remite a él, cuando se lo pasan', () => {
    render(<ClientesErrorState diagnostico="NETWORK_ERROR" />);

    expect(within(screen.getByRole('alert')).getByText('NETWORK_ERROR')).toBeInTheDocument();
    expect(screen.getByText(/con el código de abajo/)).toBeInTheDocument();
  });

  it.each([
    ['no se pasa', undefined],
    ['está vacío', ''],
    ['es solo espacios', '   '],
  ])('no remite a un código que no existe cuando el diagnóstico %s', (_caso, diagnostico) => {
    render(<ClientesErrorState diagnostico={diagnostico} />);

    expect(screen.queryByText(/código de abajo/)).not.toBeInTheDocument();
  });
});
