import { render, screen } from '@testing-library/react';

import { App } from './App';

describe('App', () => {
  it('muestra el nombre de la aplicación como encabezado principal', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Realpolitik Manager' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Frontend base operativa')).toBeInTheDocument();
  });

  it('muestra los sectores que expone @realpolitik/shared en runtime', () => {
    render(<App />);

    expect(screen.getByText(/PUBLICO/)).toBeInTheDocument();
    expect(screen.getByText(/PRIVADO/)).toBeInTheDocument();
  });
});
