import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';

function renderPage(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ClientesPage />
    </MemoryRouter>,
  );
}

const emptyHeading = () => screen.queryByRole('heading', { name: 'Todavía no cargaste clientes' });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ClientesPage', () => {
  it('muestra por defecto el estado vacío, bajo el h1 "Clientes"', () => {
    renderPage('/clientes');

    expect(screen.getByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(emptyHeading()).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('preview de estados (solo en desarrollo)', () => {
    it('?estado=empty muestra el estado vacío', () => {
      renderPage('/clientes?estado=empty');

      expect(emptyHeading()).toBeInTheDocument();
    });

    it('?estado=loading muestra la carga en lugar del estado vacío', () => {
      renderPage('/clientes?estado=loading');

      expect(screen.getByRole('status')).toHaveTextContent('Cargando clientes');
      expect(emptyHeading()).not.toBeInTheDocument();
    });

    it('?estado=error muestra el error, con un diagnóstico estático, en lugar del estado vacío', () => {
      renderPage('/clientes?estado=error');

      expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar los clientes');
      expect(screen.getByText('NETWORK_ERROR')).toBeInTheDocument();
      expect(emptyHeading()).not.toBeInTheDocument();
    });

    it.each(['otro', 'LOADING', ''])('ignora el valor desconocido "%s"', (estado) => {
      renderPage(`/clientes?estado=${estado}`);

      expect(emptyHeading()).toBeInTheDocument();
    });
  });

  describe('en producción', () => {
    it.each(['loading', 'error'])('?estado=%s no cambia el estado visual', (estado) => {
      vi.stubEnv('DEV', false);

      renderPage(`/clientes?estado=${estado}`);

      expect(emptyHeading()).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it.each(['empty', 'loading', 'error'])(
    'el estado %s tiene un único h1 y no ofrece acciones todavía',
    (estado) => {
      renderPage(`/clientes?estado=${estado}`);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );
});
