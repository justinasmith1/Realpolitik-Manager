import { render, screen } from '@testing-library/react';

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
});
