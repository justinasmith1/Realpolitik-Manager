import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { DURACION_EXITO_MS } from '@/hooks/use-exito-breve';
import { GestionarContactosSheet } from '@/modules/clientes/components/GestionarContactosSheet';
import { avanzar, congelarTiempo, esperar } from '@/test/tiempo-congelado';

// Feedback de los contactos: Guardar contactos → Guardando… → Guardado (500 ms) → recién ahí
// avisa `onGuardado`. La pausa se controla con temporizadores falsos, activados recién después
// de editar el formulario (ver `@/test/tiempo-congelado`).

const fetchMock = vi.fn<typeof fetch>();

const CLIENTE_A = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const clienteA = { id: CLIENTE_A, razonSocial: 'Municipio de Ejemplo' } as Cliente;

const ana = {
  id: 'c1111111-1111-4111-a111-111111111111',
  clienteId: CLIENTE_A,
  nombre: 'Ana Pérez',
  area: 'Tesorería',
  email: 'ana@ejemplo.example',
  recibeRendiciones: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Los GET devuelven a Ana; el próximo PUT queda en vuelo hasta que se llame a `responder`. */
function putEnVuelo() {
  let responder: (respuesta: Response) => void = () => undefined;
  const put = new Promise<Response>((resolver) => {
    responder = resolver;
  });
  fetchMock.mockImplementation((_entrada, init) =>
    init?.method === 'PUT' ? put : Promise.resolve(json([ana])),
  );
  return (respuesta: Response) => responder(respuesta);
}

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

/** Como la página: guardar cierra el panel. Un botón afuera permite volver a abrirlo. */
function Pagina({ onGuardado }: { onGuardado: (cliente: Cliente) => void }) {
  const [abierto, setAbierto] = useState<Cliente | null>(clienteA);
  return (
    <>
      <button type="button" onClick={() => setAbierto(clienteA)}>
        Abrir contactos
      </button>
      <GestionarContactosSheet
        cliente={abierto}
        onClose={() => setAbierto(null)}
        onGuardado={(cliente) => {
          onGuardado(cliente);
          setAbierto(null);
        }}
      />
    </>
  );
}

function renderPagina() {
  const onGuardado = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Pagina onGuardado={onGuardado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onGuardado };
}

const panel = () => screen.queryByRole('dialog', { name: /Contactos de/ });
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });
const nombreDeAna = () =>
  within(screen.getByRole('group', { name: 'Contacto 1' })).getByLabelText('Nombre');

/** Carga el panel y modifica a Ana, con temporizadores reales. */
async function editarAna(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Guardar contactos' });
  await user.type(nombreDeAna(), ' (editado)');
}

describe('GestionarContactosSheet: feedback del guardado', () => {
  it('Guardar contactos → Guardando… → Guardado, y avisa onGuardado recién a los 500 ms', async () => {
    const responder = putEnVuelo();
    const { user, onGuardado } = renderPagina();
    await editarAna(user);
    congelarTiempo();

    fireEvent.click(boton('Guardar contactos'));
    expect(boton('Guardando…')).toHaveAttribute('aria-busy', 'true');

    responder(json([{ ...ana, nombre: 'Ana Pérez (editado)' }]));
    const guardado = await esperar(() => boton('Guardado'));
    expect(guardado).toHaveAttribute('data-success');
    expect(panel()).toBeInTheDocument();
    expect(onGuardado).not.toHaveBeenCalled();

    await avanzar(DURACION_EXITO_MS);
    expect(onGuardado).toHaveBeenCalledTimes(1);
    expect(onGuardado).toHaveBeenCalledWith(clienteA);
    await esperar(() => expect(panel()).not.toBeInTheDocument());
  });

  it('mientras confirma, ni la X, ni Escape, ni Cancelar cierran el panel', async () => {
    const responder = putEnVuelo();
    const { user, onGuardado } = renderPagina();
    await editarAna(user);
    congelarTiempo();
    fireEvent.click(boton('Guardar contactos'));
    responder(json([ana]));
    await esperar(() => boton('Guardado'));

    expect(boton('Cancelar')).toBeDisabled();
    fireEvent.click(boton('Cerrar'));
    fireEvent.keyDown(nombreDeAna(), { key: 'Escape' });

    expect(panel()).toBeInTheDocument();
    expect(onGuardado).not.toHaveBeenCalled();
    await avanzar(DURACION_EXITO_MS);
    expect(onGuardado).toHaveBeenCalledTimes(1);
  });

  it('al volver a abrir después de guardar, el botón está otra vez en "Guardar contactos"', async () => {
    const responder = putEnVuelo();
    const { user } = renderPagina();
    await editarAna(user);
    congelarTiempo();
    fireEvent.click(boton('Guardar contactos'));
    responder(json([ana]));
    await esperar(() => boton('Guardado'));
    await avanzar(DURACION_EXITO_MS);
    await esperar(() => expect(panel()).not.toBeInTheDocument());
    vi.useRealTimers();

    await user.click(boton('Abrir contactos'));

    expect(await screen.findByRole('button', { name: 'Guardar contactos' })).not.toHaveAttribute(
      'data-success',
    );
    expect(screen.queryByRole('button', { name: 'Guardado' })).not.toBeInTheDocument();
  });

  it('si falla, nunca confirma: queda abierto, con lo escrito y el botón en reposo', async () => {
    const responder = putEnVuelo();
    const { user, onGuardado } = renderPagina();
    await editarAna(user);
    congelarTiempo();
    fireEvent.click(boton('Guardar contactos'));

    responder(new Response('boom', { status: 500 }));

    expect(await esperar(() => screen.getByRole('alert'))).toHaveTextContent(
      'No pudimos guardar los contactos.',
    );
    expect(boton('Guardar contactos')).not.toHaveAttribute('aria-disabled');
    await avanzar(DURACION_EXITO_MS * 2);
    expect(screen.queryByRole('button', { name: 'Guardado' })).not.toBeInTheDocument();
    expect(onGuardado).not.toHaveBeenCalled();
    expect(panel()).toBeInTheDocument();
    expect(nombreDeAna()).toHaveValue('Ana Pérez (editado)');
  });
});
