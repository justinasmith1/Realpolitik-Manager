import { RendicionDetalleSchema } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditarOcSheet, TEXTO_OC_GUARDADA } from '@/modules/rendiciones/components/EditarOcSheet';
import {
  CLIENTE_ID,
  errorJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// El panel de la OC no se cierra mientras guarda (HU2.11): el resultado del guardado tiene que
// verse, y si falla, el error queda en el panel.

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const rendicion = RendicionDetalleSchema.parse({ ...rendicionJson(), items: [] });

/** El PATCH queda en curso hasta que el test llama a `responder`. */
function servirConGuardadoPendiente() {
  let responder: () => void = () => undefined;
  fetchMock.mockImplementation((entrada, init) => {
    if (urlDe(entrada).endsWith(`/clientes/${CLIENTE_ID}/ultima-oc`)) {
      return Promise.resolve(json(null));
    }
    if (urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}`) && init?.method === 'PATCH') {
      const cuerpo = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Promise<Response>((resolver) => {
        responder = () => resolver(json({ ...rendicionJson(cuerpo), items: [] }));
      });
    }
    return Promise.resolve(json(null));
  });
  return { responder: () => responder() };
}

function renderPanel() {
  const props = { onAbiertoChange: vi.fn(), onGuardada: vi.fn() };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EditarOcSheet rendicion={rendicion} abierto {...props} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), ...props };
}

describe('EditarOcSheet: cierre mientras guarda', () => {
  it('con el guardado en curso, Escape no cierra', async () => {
    const { responder } = servirConGuardadoPendiente();
    const { user, onAbiertoChange, onGuardada } = renderPanel();

    await user.type(screen.getByLabelText(/Número de OC/), 'OC-342');
    await user.click(screen.getByRole('button', { name: 'Guardar OC' }));
    expect(await screen.findByRole('button', { name: /Guardando/ })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onAbiertoChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog', { name: 'Orden de compra' })).toBeInTheDocument();

    responder();
    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith(TEXTO_OC_GUARDADA));
  });

  it('sin un guardado en curso, Escape sí pide cerrar', async () => {
    servirConGuardadoPendiente();
    const { user, onAbiertoChange } = renderPanel();
    await screen.findByRole('dialog', { name: 'Orden de compra' });

    await user.keyboard('{Escape}');
    expect(onAbiertoChange).toHaveBeenCalledWith(false);
  });
});

// El foco tras un error del servidor va al primer campo con error en el orden del formulario
// (`ordenDeCamposOc`), no al último que informó el servidor.
describe('EditarOcSheet: errores del servidor', () => {
  it('un 400 en varios campos deja el foco en el primero del formulario', async () => {
    fetchMock.mockImplementation((entrada, init) => {
      if (urlDe(entrada).endsWith(`/clientes/${CLIENTE_ID}/ultima-oc`)) {
        return Promise.resolve(json(null));
      }
      if (urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}`) && init?.method === 'PATCH') {
        return Promise.resolve(
          errorJson(400, 'VALIDATION_ERROR', [
            { campo: 'numeroOc', mensaje: 'El número de OC es obligatorio.' },
            { campo: 'montoTotal', mensaje: 'El monto no es válido.' },
          ]),
        );
      }
      return Promise.resolve(json(null));
    });
    const { user } = renderPanel();

    await user.type(screen.getByLabelText(/Número de OC/), 'OC-342');
    await user.click(screen.getByRole('button', { name: 'Guardar OC' }));

    expect(
      await screen.findByText('Algunos datos no son válidos. Revisá los campos marcados.'),
    ).toBeVisible();
    expect(screen.getByLabelText(/Número de OC/)).toHaveFocus();
    expect(screen.getByLabelText(/Número de OC/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Monto total/)).toHaveAttribute('aria-invalid', 'true');
  });
});
