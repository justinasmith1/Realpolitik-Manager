import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';

const fetchMock = vi.fn<typeof fetch>();

function renderPage(url: string) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <ClientesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient, user: userEvent.setup() };
}

const emptyHeading = () => screen.queryByRole('heading', { name: 'Todavía no cargaste clientes' });
const panelDeAlta = () => screen.queryByRole('dialog', { name: 'Nuevo cliente' });

const camposDelAlta = [
  'Razón social',
  'Denominación',
  'CUIT',
  'Sector',
  'Condición frente al IVA',
  'Email de contacto',
];

/** Respuesta 201 (datos ficticios). Una Response nueva por llamada: su cuerpo se lee una vez. */
function respuesta201() {
  return new Response(
    JSON.stringify({
      id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
      razonSocial: 'Empresa de Ejemplo S.A.',
      denominacion: 'Empresa Ejemplo',
      cuit: '20-12345678-6',
      sector: 'PRIVADO',
      ivaCondicion: 'RESPONSABLE_INSCRIPTO',
      emailContacto: 'admin@empresa.example',
      emailsAdicionales: [],
      estado: 'ACTIVO',
      creadoEn: '2026-10-08T12:00:00.000Z',
      actualizadoEn: '2026-10-08T12:00:00.000Z',
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Completa el panel abierto con un alta privada válida. */
async function completarAltaValida(user: UserEvent) {
  await user.type(screen.getByLabelText('Razón social'), 'Empresa de Ejemplo S.A.');
  await user.type(screen.getByLabelText('Denominación'), 'Empresa Ejemplo');
  await user.type(screen.getByLabelText('CUIT'), '20-12345678-6');
  await user.selectOptions(screen.getByLabelText('Sector'), 'PRIVADO');
  await user.selectOptions(
    screen.getByLabelText('Condición frente al IVA'),
    'RESPONSABLE_INSCRIPTO',
  );
  await user.type(screen.getByLabelText('Email de contacto'), 'admin@empresa.example');
}

/** El panel recién abierto: todos los campos vacíos y ninguno marcado con error. */
function expectFormularioLimpio() {
  for (const etiqueta of camposDelAlta) {
    const control = screen.getByLabelText(etiqueta);
    expect(control).toHaveValue('');
    expect(control).not.toHaveAttribute('aria-invalid');
  }
  expect(screen.queryByLabelText('Subtipo público')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
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
    'el estado %s tiene un único h1 y la acción "Nuevo cliente"',
    (estado) => {
      renderPage(`/clientes?estado=${estado}`);

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Nuevo cliente' })).toBeInTheDocument();
    },
  );

  describe('alta de cliente', () => {
    it.each([
      ['el encabezado', 'Nuevo cliente'],
      ['el estado vacío', 'Registrar el primer cliente'],
    ])('se abre desde %s', async (_origen, boton) => {
      const { user } = renderPage('/clientes');
      expect(panelDeAlta()).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: boton }));

      expect(panelDeAlta()).toBeInTheDocument();
    });

    it('Cancelar cierra el panel sin enviar nada', async () => {
      const { user } = renderPage('/clientes');

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));

      await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('al registrar cierra el panel, confirma el alta e invalida las queries de clientes', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(respuesta201()));
      const { user, queryClient } = renderPage('/clientes');
      const invalidar = vi.spyOn(queryClient, 'invalidateQueries');

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
      await completarAltaValida(user);
      await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Se registró el cliente Empresa de Ejemplo S.A. (CUIT 20-12345678-6).',
      );
      await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
      expect(invalidar).toHaveBeenCalledWith({ queryKey: ['clientes'] });
    });

    it('al reabrir después de un alta, el formulario está vacío y sin la confirmación anterior', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(respuesta201()));
      const { user } = renderPage('/clientes');

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
      // Un primer envío vacío deja errores marcados antes del alta exitosa.
      await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
      expect(screen.getByText('Ingresá la razón social.')).toBeInTheDocument();
      await completarAltaValida(user);
      await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Se registró el cliente');
      await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));

      expect(panelDeAlta()).toBeInTheDocument();
      expectFormularioLimpio();
      // Por texto y no por rol: con el panel modal abierto, el resto de la página queda oculto
      // para la API de accesibilidad y `queryByRole` no encontraría el mensaje aunque estuviera.
      expect(screen.queryByText(/Se registró el cliente/)).not.toBeInTheDocument();
    });

    it('al reabrir después de cancelar, no quedan datos ni errores', async () => {
      const { user } = renderPage('/clientes');

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
      await user.type(screen.getByLabelText('CUIT'), '20-12345678-5');
      await user.selectOptions(screen.getByLabelText('Sector'), 'PUBLICO');
      await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
      expect(screen.getByLabelText('CUIT')).toHaveAttribute('aria-invalid', 'true');
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));

      expectFormularioLimpio();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Escape cierra el panel', async () => {
      const { user } = renderPage('/clientes');

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
      await user.keyboard('{Escape}');

      await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    });

    it('mientras guarda, Escape no cierra el panel ni repite el envío', async () => {
      let responder: (respuesta: Response) => void = () => undefined;
      fetchMock.mockReturnValue(
        new Promise<Response>((resolve) => {
          responder = resolve;
        }),
      );
      const { user } = renderPage('/clientes');

      await user.click(screen.getByRole('button', { name: 'Nuevo cliente' }));
      await completarAltaValida(user);
      await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));
      expect(await screen.findByRole('button', { name: 'Guardando…' })).toBeDisabled();

      await user.keyboard('{Escape}');

      expect(panelDeAlta()).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardando…' })).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      responder(respuesta201());
      await vi.waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
