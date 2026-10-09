import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

  it('ofrece "Reintentar" solo si se le pasa la acción, y la ejecuta', async () => {
    const onReintentar = vi.fn();
    const { rerender } = render(<ClientesErrorState />);
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();

    rerender(<ClientesErrorState onReintentar={onReintentar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onReintentar).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['conexion', 'Error de conexión', /No pudimos conectarnos con el servidor/],
    ['servidor', 'Error del servidor', /El servidor respondió con un error/],
    ['configuracion', 'Error de configuración', /dirección del servidor/],
    ['inesperado', 'Error inesperado', /Algo salió mal/],
  ] as const)('con la causa "%s" lo dice con precisión', (causa, etiqueta, detalle) => {
    render(<ClientesErrorState causa={causa} />);

    const alerta = screen.getByRole('alert');
    expect(within(alerta).getByText(etiqueta)).toBeInTheDocument();
    expect(within(alerta).getByText(detalle)).toBeInTheDocument();
  });

  it('un error 500 no dice que "el servidor no respondió"', () => {
    render(<ClientesErrorState causa="servidor" diagnostico="HTTP_500" />);

    expect(screen.queryByText(/no respondió/)).not.toBeInTheDocument();
    expect(screen.getByText('HTTP_500')).toBeInTheDocument();
  });
});
