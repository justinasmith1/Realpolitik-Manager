import type { TipoDocumento } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { DURACION_EXITO_MS } from '@/hooks/use-exito-breve';
import { NuevoTipoDocumentoSheet } from '@/modules/tipos-documento/components/NuevoTipoDocumentoSheet';
import { avanzar, congelarTiempo, esperar } from '@/test/tiempo-congelado';

// Feedback del alta: Crear tipo → Guardando… → Guardado (500 ms) → recién ahí sigue. La pausa se
// controla con temporizadores falsos, activados después de completar el formulario (ver
// `@/test/tiempo-congelado`).

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const tipoCreado = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  nombre: 'Libre deuda',
  descripcion: null,
  activo: true,
  creadoEn: '2026-10-21T12:00:00.000Z',
  actualizadoEn: '2026-10-21T12:00:00.000Z',
};

/** El próximo pedido queda en vuelo hasta que se llame a `responder`. */
function pedidoEnVuelo() {
  let responder: (respuesta: Response) => void = () => undefined;
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolver) => {
      responder = resolver;
    }),
  );
  return (respuesta: Response) => responder(respuesta);
}

/** Como la página: el alta cierra el panel. */
function Pagina({ onCreado }: { onCreado: (tipo: TipoDocumento) => void }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <NuevoTipoDocumentoSheet
      abierto={abierto}
      onAbiertoChange={setAbierto}
      onCreado={(tipo) => {
        onCreado(tipo);
        setAbierto(false);
      }}
    />
  );
}

function renderPagina() {
  const onCreado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Pagina onCreado={onCreado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onCreado };
}

const panel = () => screen.queryByRole('dialog', { name: 'Nuevo tipo de documento' });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

describe('NuevoTipoDocumentoSheet: feedback del alta', () => {
  it('Crear tipo → Guardando… → Guardado, y avisa el alta recién a los 500 ms', async () => {
    const { user, onCreado } = renderPagina();
    const responder = pedidoEnVuelo();
    await user.type(screen.getByLabelText('Nombre'), 'Libre deuda');
    congelarTiempo();

    fireEvent.click(boton('Crear tipo'));
    expect(boton('Guardando…')).toHaveAttribute('aria-busy', 'true');

    responder(jsonResponse(tipoCreado, 201));
    const guardado = await esperar(() => boton('Guardado'));
    expect(guardado).toHaveAttribute('data-success');
    expect(panel()).toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();

    await avanzar(DURACION_EXITO_MS);
    expect(onCreado).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Libre deuda' }));
    await esperar(() => expect(panel()).not.toBeInTheDocument());
  });

  it('mientras confirma, ni la X ni Escape cierran el panel', async () => {
    const { user, onCreado } = renderPagina();
    const responder = pedidoEnVuelo();
    await user.type(screen.getByLabelText('Nombre'), 'Libre deuda');
    congelarTiempo();
    fireEvent.click(boton('Crear tipo'));
    responder(jsonResponse(tipoCreado, 201));
    await esperar(() => boton('Guardado'));

    fireEvent.click(boton('Cerrar'));
    fireEvent.keyDown(screen.getByLabelText('Nombre'), { key: 'Escape' });

    expect(panel()).toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();
    await avanzar(DURACION_EXITO_MS);
    expect(onCreado).toHaveBeenCalledTimes(1);
  });

  it('si falla, nunca confirma: queda abierto, con los datos y el botón en reposo', async () => {
    const { user, onCreado } = renderPagina();
    const responder = pedidoEnVuelo();
    await user.type(screen.getByLabelText('Nombre'), 'Libre deuda');
    congelarTiempo();
    fireEvent.click(boton('Crear tipo'));

    responder(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));

    expect(await esperar(() => screen.getByRole('alert'))).toHaveTextContent(
      'No pudimos crear el tipo de documento.',
    );
    await avanzar(DURACION_EXITO_MS * 2);
    expect(boton('Crear tipo')).not.toHaveAttribute('data-success');
    expect(onCreado).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Libre deuda');
  });
});
