import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Alert } from '@/components/ui/alert';

describe('Alert', () => {
  it('el error se anuncia como alert y el éxito como status', () => {
    render(
      <>
        <Alert>No se pudo guardar.</Alert>
        <Alert variant="success">Guardado.</Alert>
      </>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar.');
    expect(screen.getByRole('status')).toHaveTextContent('Guardado.');
  });

  it('sin onCerrar no tiene botón para cerrarlo', () => {
    render(<Alert variant="success">Guardado.</Alert>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('con onCerrar muestra "Cerrar aviso", que lo avisa al hacer click', async () => {
    const user = userEvent.setup();
    const onCerrar = vi.fn();
    render(
      <Alert variant="success" onCerrar={onCerrar}>
        Guardado.
      </Alert>,
    );

    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
    // El texto del aviso no incluye el del botón.
    expect(screen.getByRole('status')).toHaveTextContent(/^Guardado\.$/);
  });

  it('saliendo, cambia la animación de entrada por la de salida', () => {
    const { rerender } = render(<Alert variant="success">Guardado.</Alert>);
    const aviso = screen.getByRole('status');
    expect(aviso).not.toHaveAttribute('data-saliendo');
    expect(aviso).toHaveClass('animate-in');

    rerender(
      <Alert variant="success" saliendo>
        Guardado.
      </Alert>,
    );

    expect(aviso).toHaveAttribute('data-saliendo');
    expect(aviso).toHaveClass('animate-out', 'fade-out-0', 'slide-out-to-top-1');
    expect(aviso).not.toHaveClass('animate-in');
    // Sigue siendo el mismo aviso, con su rol, mientras sale.
    expect(aviso).toHaveTextContent('Guardado.');
  });
});
