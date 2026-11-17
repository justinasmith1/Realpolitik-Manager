import { RendicionDetalleSchema, type RendicionDetalle } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import { AprobarRendicionDialog } from '@/modules/rendiciones/components/AprobarRendicionDialog';
import { MarcarEnviadaDialog } from '@/modules/rendiciones/components/MarcarEnviadaDialog';
import { RechazarDialog } from '@/modules/rendiciones/components/RechazarDialog';
import { useAperturaDeDialogo } from '@/modules/rendiciones/hooks/useAperturaDeDialogo';
import { errorJson, rendicionJson } from '@/modules/rendiciones/test/rendiciones.fixtures';

// Los diálogos de estado arrancan limpios en cada apertura (deuda post HU3.7 y HU3.8): al cerrar y
// reabrir enseguida la MISMA rendición, con la animación de cierre todavía en curso, no queda ni el
// error ni el dato del intento anterior.

const fetchMock = vi.fn<typeof fetch>();

// Lo que responde el servidor a cualquier cambio de estado: la rendición ya no existe.
const MENSAJE_DEL_FALLO = 'La rendición ya no existe. Volvé a cargar la página.';

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(() => Promise.resolve(errorJson(404, 'NOT_FOUND')));
  // 13/11/2026, 12:00 en Buenos Aires. Solo el reloj de Date: los timers reales siguen andando.
  vi.useFakeTimers({ now: new Date('2026-11-13T15:00:00.000Z'), toFake: ['Date'] });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const detalle = (estado: string): RendicionDetalle =>
  RendicionDetalleSchema.parse({ ...rendicionJson({ estado, anio: 2026, mes: 11 }), items: [] });

/**
 * Una animación de cierre que todavía no terminó. jsdom no tiene `getAnimations`, así que Base UI
 * da el cierre por terminado en el acto; con esto queda en curso, como en el navegador cuando se
 * reabre durante la animación.
 */
function animacionDeCierreEnCurso() {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [{ finished: new Promise(() => {}), pending: false, playState: 'running' }],
  });
}

interface Apertura {
  abierto: boolean;
  onCerrar: () => void;
}

/** Abre el diálogo con un botón, como la página: con `useAperturaDeDialogo` y su `key`. */
function Pagina({ dialogo }: { dialogo: (apertura: Apertura) => ReactElement }) {
  const apertura = useAperturaDeDialogo();
  return (
    <>
      <button type="button" onClick={apertura.abrir}>
        Abrir
      </button>
      <div key={apertura.clave}>
        {dialogo({ abierto: apertura.abierto, onCerrar: apertura.cerrar })}
      </div>
    </>
  );
}

async function montar(dialogo: (apertura: Apertura) => ReactElement) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Pagina dialogo={dialogo} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Abrir' }));
  return {
    user,
    /** "Cancelar" y "Abrir" enseguida, sin esperar a que termine la animación de cierre. */
    cerrarYReabrir: async () => {
      animacionDeCierreEnCurso();
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      await user.click(screen.getByRole('button', { name: 'Abrir', hidden: true }));
    },
  };
}

describe('MarcarEnviadaDialog: reabrir la misma rendición', () => {
  const rendicion = detalle('COMPLETA');
  const conDialogo = (apertura: Apertura) => (
    <MarcarEnviadaDialog rendicion={rendicion} onEnviada={vi.fn()} {...apertura} />
  );
  const fecha = () => screen.getByLabelText('Fecha de envío');

  it('vuelve a hoy, sin el error de la fecha anterior', async () => {
    const { user, cerrarYReabrir } = await montar(conDialogo);

    await user.clear(fecha());
    await user.type(fecha(), '2026-11-20');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(fecha()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/posterior a hoy/)).toBeVisible();

    await cerrarYReabrir();

    await screen.findByRole('alertdialog', { name: 'Registrar el envío' });
    expect(fecha()).toHaveValue('2026-11-13');
    expect(fecha()).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(/posterior a hoy/)).not.toBeInTheDocument();
  });

  it('sin el error general del servidor', async () => {
    const { user, cerrarYReabrir } = await montar(conDialogo);

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(MENSAJE_DEL_FALLO)).toBeVisible();

    await cerrarYReabrir();

    await screen.findByRole('alertdialog', { name: 'Registrar el envío' });
    expect(screen.queryByText(MENSAJE_DEL_FALLO)).not.toBeInTheDocument();
  });
});

describe('AprobarRendicionDialog: reabrir la misma rendición', () => {
  it('sin el error del intento anterior', async () => {
    const rendicion = detalle('ENVIADA');
    const { user, cerrarYReabrir } = await montar((apertura) => (
      <AprobarRendicionDialog rendicion={rendicion} onAprobada={vi.fn()} {...apertura} />
    ));

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(MENSAJE_DEL_FALLO)).toBeVisible();

    await cerrarYReabrir();

    await screen.findByRole('alertdialog', { name: 'Aprobada por el cliente' });
    expect(screen.queryByText(MENSAJE_DEL_FALLO)).not.toBeInTheDocument();
  });
});

describe('RechazarDialog: reabrir la misma rendición', () => {
  it('con el motivo vacío y sin el error del intento anterior', async () => {
    const rendicion = detalle('ENVIADA');
    const { user, cerrarYReabrir } = await montar((apertura) => (
      <RechazarDialog rendicion={rendicion} onRechazada={vi.fn()} {...apertura} />
    ));
    const motivo = () => screen.getByLabelText(/¿Qué observó el cliente\?/);

    await user.type(motivo(), 'Falta la firma');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(MENSAJE_DEL_FALLO)).toBeVisible();

    await cerrarYReabrir();

    await screen.findByRole('alertdialog', { name: 'Rechazada por el cliente' });
    expect(motivo()).toHaveValue('');
    expect(screen.queryByText(MENSAJE_DEL_FALLO)).not.toBeInTheDocument();
  });
});
