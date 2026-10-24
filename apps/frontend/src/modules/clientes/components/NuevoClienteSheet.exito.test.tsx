import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { useState } from 'react';

import { DURACION_EXITO_MS } from '@/hooks/use-exito-breve';
import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';
import { elegirOpcion } from '@/test/select';
import { avanzar, congelarTiempo, esperar } from '@/test/tiempo-congelado';

// Feedback del alta: Registrar cliente → Registrando… → Registrado (500 ms) → recién ahí sigue.
// La pausa se controla con temporizadores falsos, activados recién después de completar el
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

const clienteCreado = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: [],
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

/** El próximo POST queda en vuelo hasta que se llame a `responder`. */
function postEnVuelo() {
  let responder: (respuesta: Response) => void = () => undefined;
  fetchMock.mockReturnValueOnce(
    new Promise<Response>((resolver) => {
      responder = resolver;
    }),
  );
  return (respuesta: Response) => responder(respuesta);
}

/** Como la página: el alta cierra el panel. Un botón afuera permite volver a abrirlo. */
function Pagina({ onCreado }: { onCreado: (cliente: Cliente) => void }) {
  const [abierto, setAbierto] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>
        Abrir alta
      </button>
      <NuevoClienteSheet
        abierto={abierto}
        onAbiertoChange={setAbierto}
        onCreado={(cliente) => {
          onCreado(cliente);
          setAbierto(false);
        }}
      />
    </>
  );
}

function renderPagina() {
  const onCreado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Pagina onCreado={onCreado} />
    </QueryClientProvider>,
  );
  // Con temporizadores falsos, userEvent necesita avanzarlos para sus propias pausas.
  const user = userEvent.setup({
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
  return { user, onCreado };
}

const panel = () => screen.queryByRole('dialog', { name: 'Nuevo cliente' });
const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const boton = (nombre: string) => screen.getByRole('button', { name: nombre });

async function completar(user: UserEvent) {
  await user.type(campo('Razón social'), 'Municipio de Ejemplo');
  await user.type(campo('Denominación'), 'Muni Ejemplo');
  await user.type(campo('CUIT'), '30500012745');
  await elegirOpcion(user, campo('Sector'), 'PUBLICO');
  await elegirOpcion(user, campo('Subtipo público'), 'MUNICIPAL');
  await elegirOpcion(user, campo('Condición frente al IVA'), 'EXENTO');
  await user.type(campo('Email de contacto'), 'compras@municipio.example');
}

// Cada test completa el alta entera (~2 s solo en tipear): con la suite en paralelo, los 5 s por
// defecto quedan justos.
describe('NuevoClienteSheet: feedback del alta', { timeout: 15_000 }, () => {
  it('Registrar cliente → Registrando… → Registrado, y avisa el alta recién a los 500 ms', async () => {
    const { user, onCreado } = renderPagina();
    const responder = postEnVuelo();
    await completar(user);
    expect(boton('Registrar cliente')).not.toHaveAttribute('aria-busy');
    congelarTiempo();

    fireEvent.click(boton('Registrar cliente'));
    expect(boton('Registrando…')).toHaveAttribute('aria-busy', 'true');

    responder(jsonResponse(clienteCreado, 201));
    const registrado = await esperar(() => boton('Registrado'));
    expect(registrado).toHaveAttribute('data-success');
    expect(registrado).not.toHaveAttribute('aria-busy');
    expect(panel()).toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();

    await avanzar(DURACION_EXITO_MS);
    expect(onCreado).toHaveBeenCalledTimes(1);
    expect(onCreado).toHaveBeenCalledWith(
      expect.objectContaining({ id: clienteCreado.id, razonSocial: 'Municipio de Ejemplo' }),
    );
    await esperar(() => expect(panel()).not.toBeInTheDocument());
  });

  it('mientras confirma, ni la X ni Escape cierran el panel', async () => {
    const { user, onCreado } = renderPagina();
    const responder = postEnVuelo();
    await completar(user);
    congelarTiempo();
    fireEvent.click(boton('Registrar cliente'));
    responder(jsonResponse(clienteCreado, 201));
    await esperar(() => boton('Registrado'));

    fireEvent.click(boton('Cerrar'));
    // Escape desde un campo: el botón ocupado se traga las teclas, y eso no probaría la guarda.
    fireEvent.keyDown(campo('Denominación'), { key: 'Escape' });

    expect(panel()).toBeInTheDocument();
    expect(boton('Registrado')).toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();

    await avanzar(DURACION_EXITO_MS);
    expect(onCreado).toHaveBeenCalledTimes(1);
  });

  it('al volver a abrir después de un alta, el botón está otra vez en "Registrar cliente"', async () => {
    const { user } = renderPagina();
    const responder = postEnVuelo();
    await completar(user);
    congelarTiempo();
    fireEvent.click(boton('Registrar cliente'));
    responder(jsonResponse(clienteCreado, 201));
    await esperar(() => boton('Registrado'));
    await avanzar(DURACION_EXITO_MS);
    await esperar(() => expect(panel()).not.toBeInTheDocument());
    vi.useRealTimers();

    await user.click(boton('Abrir alta'));

    expect(await screen.findByRole('button', { name: 'Registrar cliente' })).not.toHaveAttribute(
      'data-success',
    );
    expect(screen.queryByRole('button', { name: 'Registrado' })).not.toBeInTheDocument();
  });

  it('si falla, nunca confirma: queda abierto, con los datos y el botón en reposo', async () => {
    const { user, onCreado } = renderPagina();
    const responder = postEnVuelo();
    await completar(user);
    congelarTiempo();
    fireEvent.click(boton('Registrar cliente'));

    responder(jsonResponse({ error: { code: 'INTERNAL_ERROR' } }, 500));

    expect(await esperar(() => screen.getByRole('alert'))).toHaveTextContent(
      'No pudimos registrar el cliente.',
    );
    expect(boton('Registrar cliente')).not.toHaveAttribute('aria-disabled');
    expect(boton('Registrar cliente')).not.toHaveAttribute('data-success');
    await avanzar(DURACION_EXITO_MS * 2);
    expect(screen.queryByRole('button', { name: 'Registrado' })).not.toBeInTheDocument();
    expect(onCreado).not.toHaveBeenCalled();
    expect(panel()).toBeInTheDocument();
    expect(campo('Razón social')).toHaveValue('Municipio de Ejemplo');
    expect(campo('Email de contacto')).toHaveValue('compras@municipio.example');
  });
});
