import { RendicionDetalleSchema } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { rendicionesQueryKey } from '@/modules/rendiciones/api/rendiciones.api';
import { EditarOcSheet, TEXTO_OC_GUARDADA } from '@/modules/rendiciones/components/EditarOcSheet';
import {
  CLIENTE_ID,
  errorJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// La sugerencia "¿Repetir última OC?" (HU2.11) solo aparece si el panel abre con la OC vacía y el
// cliente tiene una OC anterior. Es una ayuda: si la consulta falla, el formulario sigue igual.

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

const KEY_ULTIMA_OC = [...rendicionesQueryKey(CLIENTE_ID), 'ultima-oc'];
const RUTA_ULTIMA_OC = `/clientes/${CLIENTE_ID}/ultima-oc`;

/** `ultimaOc` es la respuesta de la sugerencia; el PATCH responde la rendición con lo enviado. */
function servir(ultimaOc: () => Response) {
  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    if (url.endsWith(RUTA_ULTIMA_OC)) return Promise.resolve(ultimaOc());
    if (url.endsWith(`/rendiciones/${RENDICION_ID}`) && init?.method === 'PATCH') {
      const cuerpo = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(json({ ...rendicionJson(cuerpo), items: [] }));
    }
    return Promise.resolve(json(null));
  });
}

function renderPanel(oc: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendicion = RendicionDetalleSchema.parse({ ...rendicionJson(oc), items: [] });
  const onGuardada = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <EditarOcSheet
        rendicion={rendicion}
        abierto
        onAbiertoChange={() => undefined}
        onGuardada={onGuardada}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), queryClient, onGuardada };
}

const botonSugerencia = () => screen.queryByRole('button', { name: /Repetir última OC/ });

/** El cuerpo del único PATCH enviado. */
function cuerpoDelPatch(): unknown {
  const pedido = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
  return JSON.parse(pedido?.[1]?.body as string);
}

describe('EditarOcSheet: cuándo no se ofrece repetir la última OC', () => {
  it('no aparece si el cliente no tiene OC previa (ultima-oc responde null)', async () => {
    servir(() => json(null));
    const { queryClient } = renderPanel();

    await waitFor(() => expect(queryClient.getQueryState(KEY_ULTIMA_OC)?.status).toBe('success'));
    expect(botonSugerencia()).not.toBeInTheDocument();
  });

  it('no aparece si la consulta falla (500), y el formulario se puede usar igual', async () => {
    servir(() => errorJson(500, 'INTERNAL_ERROR'));
    const { user, queryClient, onGuardada } = renderPanel();

    await waitFor(() => expect(queryClient.getQueryState(KEY_ULTIMA_OC)?.status).toBe('error'));
    expect(botonSugerencia()).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Número de OC/), 'OC-342');
    await user.click(screen.getByRole('button', { name: 'Guardar OC' }));

    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith(TEXTO_OC_GUARDADA));
    expect(cuerpoDelPatch()).toEqual({ numeroOc: 'OC-342', montoMensual: null, montoTotal: null });
  });

  it('no aparece si la OC ya estaba cargada, y ni siquiera se pide', async () => {
    servir(() => json({ numeroOc: 'OC-OTRA', montoMensual: 1, montoTotal: 1 }));
    renderPanel({ numeroOc: 'OC-342', montoMensual: 500000, montoTotal: null });

    expect(await screen.findByLabelText(/Número de OC/)).toHaveValue('OC-342');
    expect(botonSugerencia()).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([entrada]) => urlDe(entrada).endsWith(RUTA_ULTIMA_OC))).toBe(
      false,
    );
  });
});

describe('EditarOcSheet: vaciar un campo lo borra', () => {
  it('vaciar el número y guardar manda null en el PATCH', async () => {
    servir(() => json(null));
    const { user, onGuardada } = renderPanel({
      numeroOc: 'OC-342',
      montoMensual: 500000,
      montoTotal: 6000000,
    });

    await user.clear(await screen.findByLabelText(/Número de OC/));
    await user.click(screen.getByRole('button', { name: 'Guardar OC' }));

    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith(TEXTO_OC_GUARDADA));
    expect(cuerpoDelPatch()).toEqual({ numeroOc: null, montoMensual: 500000, montoTotal: 6000000 });
  });
});
