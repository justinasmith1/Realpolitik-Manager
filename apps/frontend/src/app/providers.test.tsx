import { useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { AppProviders } from '@/app/providers';

// useQueryClient() lanza un error si no hay un QueryClientProvider por encima.
function QueryClientConsumer() {
  useQueryClient();
  return <p>Con acceso al QueryClient</p>;
}

describe('AppProviders', () => {
  it('da acceso al QueryClient a los componentes que envuelve', () => {
    render(
      <AppProviders>
        <QueryClientConsumer />
      </AppProviders>,
    );

    expect(screen.getByText('Con acceso al QueryClient')).toBeInTheDocument();
  });
});
