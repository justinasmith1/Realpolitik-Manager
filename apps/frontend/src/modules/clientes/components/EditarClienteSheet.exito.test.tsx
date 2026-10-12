import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { DURACION_EXITO_MS } from '@/hooks/use-exito-breve';
import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';
import { avanzar, congelarTiempo, esperar } from '@/test/tiempo-congelado';

// Feedback de la edición: Guardar cambios → Guardando… → Guardado (500 ms) → recién ahí sigue.
// La pausa se controla con temporizadores falsos, activados recién después de modificar el
// formulario (ver `@/test/tiempo-congelado`).

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

const clienteJson = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: [],
  canalEntrega: 'PORTAL_WEB',
  portalUrl: 'https://portal.ejemplo.gob.ar',
  periodicidad: null,
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const cliente = {
  ...clienteJson,
  creadoEn: new Date(clienteJson.creadoEn),
  actualizadoEn: new Date(clienteJson.actualizadoEn),
} as Cliente;

/** El próximo PATCH queda en vuelo hasta que se llame a `responder`. */
function patchEnVuelo() {
  let responder: (respuesta: Response) => void = () => undefined;
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolver) => {
      responder = resolver;
    }),
  );
  return (respuesta: Response) => responder(respuesta);
}

/** Como la página: guardar cierra el panel. Un botón afuera permite volver a abrirlo. */
function Pagina({ onActualizado }: { onActualizado: (cliente: Cliente) => void }) {
  const [aEditar, setAEditar] = useState<Cliente | null>(cliente);
  return (
    <>
      <button type="button" onClick={() => setAEditar(cliente)}>
        Editar de nuevo
      </button>
      <EditarClienteSheet
        cliente={aEditar}
        onClose={() => setAEditar(null)}
        onActualizado={(actualizado) => {
          onActualizado(actualizado);
          setAEditar(null);
        }}
      />
    </>
  );
}

function renderPagina() {
  const onActualizado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Pagina onActualizado={onActualizado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onActualizado };
}

const panel = () => screen.queryByRole('dialog', { name: 'Editar cliente' });
const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

async function cambiarDenominacion(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(campo('Denominación'));
  await user.type(campo('Denominación'), 'Muni Nueva');
}

describe('EditarClienteSheet: feedback de la edición', () => {
  it('Guardar cambios → Guardando… → Guardado, y avisa recién a los 500 ms; viaja solo lo modificado', async () => {
    const { user, onActualizado } = renderPagina();
    const responder = patchEnVuelo();
    await cambiarDenominacion(user);
    congelarTiempo();

    fireEvent.click(boton('Guardar cambios'));
    expect(boton('Guardando…')).toHaveAttribute('aria-busy', 'true');
    await esperar(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      denominacion: 'Muni Nueva',
    });

    responder(jsonResponse({ ...clienteJson, denominacion: 'Muni Nueva' }, 200));
    const guardado = await esperar(() => boton('Guardado'));
    expect(guardado).toHaveAttribute('data-success');
    expect(panel()).toBeInTheDocument();
    expect(onActualizado).not.toHaveBeenCalled();

    await avanzar(DURACION_EXITO_MS);
    expect(onActualizado).toHaveBeenCalledTimes(1);
    expect(onActualizado).toHaveBeenCalledWith(
      expect.objectContaining({ id: cliente.id, denominacion: 'Muni Nueva' }),
    );
    await esperar(() => expect(panel()).not.toBeInTheDocument());
  });

  it('mientras confirma, ni la X, ni Escape, ni Cancelar cierran el panel', async () => {
    const { user, onActualizado } = renderPagina();
    const responder = patchEnVuelo();
    await cambiarDenominacion(user);
    congelarTiempo();
    fireEvent.click(boton('Guardar cambios'));
    responder(jsonResponse(clienteJson, 200));
    await esperar(() => boton('Guardado'));

    expect(boton('Cancelar')).toBeDisabled();
    fireEvent.click(boton('Cerrar'));
    fireEvent.keyDown(campo('Razón social'), { key: 'Escape' });

    expect(panel()).toBeInTheDocument();
    expect(onActualizado).not.toHaveBeenCalled();
    await avanzar(DURACION_EXITO_MS);
    expect(onActualizado).toHaveBeenCalledTimes(1);
  });

  it('al volver a abrir después de guardar, el botón está otra vez en "Guardar cambios"', async () => {
    const { user } = renderPagina();
    const responder = patchEnVuelo();
    await cambiarDenominacion(user);
    congelarTiempo();
    fireEvent.click(boton('Guardar cambios'));
    responder(jsonResponse(clienteJson, 200));
    await esperar(() => boton('Guardado'));
    await avanzar(DURACION_EXITO_MS);
    await esperar(() => expect(panel()).not.toBeInTheDocument());
    vi.useRealTimers();

    await user.click(boton('Editar de nuevo'));

    expect(await screen.findByRole('button', { name: 'Guardar cambios' })).not.toHaveAttribute(
      'data-success',
    );
    expect(screen.queryByRole('button', { name: 'Guardado' })).not.toBeInTheDocument();
  });

  it('si falla, nunca confirma: queda abierto, con lo escrito y el botón en reposo', async () => {
    const { user, onActualizado } = renderPagina();
    const responder = patchEnVuelo();
    await cambiarDenominacion(user);
    congelarTiempo();
    fireEvent.click(boton('Guardar cambios'));

    responder(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));

    expect(await esperar(() => screen.getByRole('alert'))).toHaveTextContent(
      'No pudimos guardar los cambios.',
    );
    expect(boton('Guardar cambios')).toBeEnabled();
    expect(boton('Guardar cambios')).not.toHaveAttribute('data-success');
    await avanzar(DURACION_EXITO_MS * 2);
    expect(screen.queryByRole('button', { name: 'Guardado' })).not.toBeInTheDocument();
    expect(onActualizado).not.toHaveBeenCalled();
    expect(panel()).toBeInTheDocument();
    expect(campo('Denominación')).toHaveValue('Muni Nueva');
  });

  it('sin cambios no hay nada que confirmar: no se envía nada ni aparece "Guardado"', async () => {
    const { user, onActualizado } = renderPagina();

    await user.click(boton('Guardar cambios'));

    expect(boton('Guardar cambios')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardado' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onActualizado).not.toHaveBeenCalled();
  });
});
