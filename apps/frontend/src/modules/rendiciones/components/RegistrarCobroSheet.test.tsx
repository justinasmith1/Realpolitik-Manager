import { hoyEnBuenosAires, RendicionDetalleSchema } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RegistrarCobroSheet } from '@/modules/rendiciones/components/RegistrarCobroSheet';
import {
  errorJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// La hoja del cobro (HU3.10): fecha obligatoria (hoy por defecto, no futura), nota opcional, y no
// se cierra ni se envía dos veces mientras guarda.

const fetchMock = vi.fn<typeof fetch>();

/** El día siguiente a `dia` (`AAAA-MM-DD`): una fecha futura que no se vuelve válida con el tiempo. */
const diaSiguiente = (dia: string): string =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  // 13/11/2026, 12:00 en Buenos Aires. Solo el reloj de Date: los timers reales siguen andando.
  vi.useFakeTimers({ now: new Date('2026-11-13T15:00:00.000Z'), toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const detalle = (extra: Record<string, unknown> = {}) =>
  RendicionDetalleSchema.parse({ ...rendicionJson({ estado: 'ENVIADA', ...extra }), items: [] });

const esPut = (entrada: Parameters<typeof fetch>[0], init?: RequestInit) =>
  urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/cobro`) && init?.method === 'PUT';

const puts = () => fetchMock.mock.calls.filter(([entrada, init]) => esPut(entrada, init));
const cuerpoDelPut = () => JSON.parse(puts()[0]?.[1]?.body as string) as Record<string, unknown>;

function renderHoja(rendicion = detalle(), onQuitar?: () => void) {
  const props = { onAbiertoChange: vi.fn(), onGuardada: vi.fn() };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RegistrarCobroSheet
        rendicion={rendicion}
        abierto
        {...props}
        {...(onQuitar !== undefined && { onQuitar })}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), ...props };
}

const fecha = () => screen.getByLabelText(/Fecha en que el cliente avisó el pago/);
const nota = () => screen.getByLabelText(/Nota/);
const guardar = () => screen.getByRole('button', { name: 'Guardar cobro' });

const respuestaDeCobro = () => json({ ...rendicionJson({ estado: 'ENVIADA' }), items: [] });

describe('RegistrarCobroSheet', () => {
  it('la fecha empieza en hoy, no admite una posterior y la nota empieza vacía', () => {
    renderHoja();

    expect(fecha()).toHaveValue('2026-11-13');
    expect(fecha()).toHaveAttribute('type', 'date');
    expect(fecha()).toHaveAttribute('max', '2026-11-13');
    expect(nota()).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Quitar marca' })).not.toBeInTheDocument();
  });

  it('al editar, muestra el cobro guardado', () => {
    renderHoja(detalle({ cobro: { fecha: '2026-11-10', nota: 'Avisó por mail' } }));

    expect(fecha()).toHaveValue('2026-11-10');
    expect(nota()).toHaveValue('Avisó por mail');
  });

  it('guarda con PUT la fecha y la nota recortada, y avisa', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuestaDeCobro()));
    const { user, onGuardada } = renderHoja();

    await user.clear(fecha());
    await user.type(fecha(), '2026-11-10');
    await user.type(nota(), '  Avisó por mail  ');
    await user.click(guardar());

    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith('Cobro guardado.'));
    expect(puts()).toHaveLength(1);
    expect(cuerpoDelPut()).toEqual({ fecha: '2026-11-10', nota: 'Avisó por mail' });
  });

  it('con la nota vacía manda nota null', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuestaDeCobro()));
    const { user, onGuardada } = renderHoja();

    await user.click(guardar());

    await waitFor(() => expect(onGuardada).toHaveBeenCalled());
    expect(cuerpoDelPut()).toEqual({ fecha: '2026-11-13', nota: null });
  });

  it('una fecha futura se bloquea sin llamar al servidor, con el error asociado al campo', async () => {
    const { user, onGuardada } = renderHoja();

    await user.clear(fecha());
    await user.type(fecha(), diaSiguiente(hoyEnBuenosAires()));
    await user.click(guardar());

    expect(
      await screen.findByText('La fecha del cobro no puede ser posterior a hoy.'),
    ).toBeVisible();
    expect(fecha()).toHaveAttribute('aria-invalid', 'true');
    expect(fecha()).toHaveAccessibleDescription(/no puede ser posterior a hoy/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onGuardada).not.toHaveBeenCalled();
  });

  it('una nota de más de 300 caracteres se bloquea sin llamar al servidor', async () => {
    const { user } = renderHoja();

    await user.click(nota());
    await user.paste('a'.repeat(301));
    await user.click(guardar());

    expect(await screen.findByText('La nota debe tener entre 1 y 300 caracteres.')).toBeVisible();
    expect(nota()).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mientras guarda, el botón está deshabilitado: un doble clic no envía dos veces ni se cierra', async () => {
    let responder: () => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolver) => {
          responder = () => resolver(respuestaDeCobro());
        }),
    );
    const { user, onGuardada, onAbiertoChange } = renderHoja();

    await user.dblClick(guardar());

    await waitFor(() => expect(puts()).toHaveLength(1));
    // Bloqueado pero enfocable (`aria-disabled`), como el resto de los botones que guardan.
    expect(screen.getByRole('button', { name: /Guardando/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(onGuardada).not.toHaveBeenCalled();
    expect(onAbiertoChange).not.toHaveBeenCalled();

    responder();
    await waitFor(() => expect(onGuardada).toHaveBeenCalledTimes(1));
    expect(puts()).toHaveLength(1);
  });

  it('un 409 COBRO_ESTADO_INVALIDO se explica en la hoja, que sigue abierta con lo escrito', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        errorJson(409, 'CONFLICT', { motivo: 'COBRO_ESTADO_INVALIDO', estadoActual: 'RECHAZADA' }),
      ),
    );
    const { user, onGuardada } = renderHoja();

    await user.type(nota(), 'Pagó');
    await user.click(guardar());

    expect(
      await screen.findByText(
        'Solo se puede registrar el cobro de una rendición enviada o aprobada.',
      ),
    ).toBeVisible();
    expect(nota()).toHaveValue('Pagó');
    expect(onGuardada).not.toHaveBeenCalled();
    expect(guardar()).toBeEnabled();
  });

  it('un 409 RENDICION_ANULADA se explica en la hoja', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorJson(409, 'CONFLICT', { motivo: 'RENDICION_ANULADA' })),
    );
    const { user } = renderHoja();

    await user.click(guardar());

    expect(
      await screen.findByText('La rendición está anulada: ya no se puede modificar.'),
    ).toBeVisible();
  });

  it('un 400 del servidor en la fecha queda en el campo', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        errorJson(400, 'VALIDATION_ERROR', [
          { campo: 'fecha', mensaje: 'La fecha del cobro no puede ser posterior a hoy.' },
        ]),
      ),
    );
    const { user } = renderHoja();

    await user.click(guardar());

    expect(
      await screen.findByText('La fecha del cobro no puede ser posterior a hoy.'),
    ).toBeVisible();
    expect(fecha()).toHaveAttribute('aria-invalid', 'true');
  });

  it('al editar ofrece "Quitar marca", que pide quitarla a quien abrió la hoja', async () => {
    const onQuitar = vi.fn();
    const { user } = renderHoja(detalle({ cobro: { fecha: '2026-11-10', nota: null } }), onQuitar);

    await user.click(screen.getByRole('button', { name: 'Quitar marca' }));

    expect(onQuitar).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
