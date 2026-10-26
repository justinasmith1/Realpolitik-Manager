import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { MemoryRouter } from 'react-router';

import type { CargaMasivaFormValues } from './cargaMasiva.types';
import { StepOne } from './StepOne';

vi.mock('@/modules/tipos-documento/hooks/useTiposDocumento', () => ({
  useTiposDocumento: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

function ConFormulario({ children }: { children: ReactNode }) {
  const metodos = useForm<CargaMasivaFormValues>();
  return <FormProvider {...metodos}>{children}</FormProvider>;
}

describe('StepOne', () => {
  it('sin tipos activos, el enlace al catálogo lleva a la sección Documentos', () => {
    render(
      <MemoryRouter>
        <ConFormulario>
          <StepOne />
        </ConFormulario>
      </MemoryRouter>,
    );

    expect(screen.getByText('No hay tipos de documento activos para seleccionar.')).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Ir al catálogo de tipos de documento' }),
    ).toHaveAttribute('href', '/documentos');
  });
});
