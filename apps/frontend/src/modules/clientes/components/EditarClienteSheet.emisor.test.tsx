import { type Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  etiquetasEmisor,
  TEXTO_EMISOR_PENDIENTE,
  TEXTO_EMISOR_SIN_ASIGNAR,
} from '@/modules/clientes/clientes.etiquetas';
import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';
import type * as HooksDeIndicaciones from '@/modules/clientes/hooks/useIndicacionesArmado';
import type * as HooksDeObservaciones from '@/modules/clientes/hooks/useObservacionesCliente';
import { elegirOpcion } from '@/test/select';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));
vi.mock('@/modules/clientes/hooks/useIndicacionesArmado', async (importOriginal) => ({
  ...(await importOriginal<typeof HooksDeIndicaciones>()),
  useIndicacionesArmado: () => ({
    data: { indicacionesArmado: null },
    isPending: false,
    isError: false,
  }),
}));
vi.mock('@/modules/clientes/hooks/useObservacionesCliente', async (importOriginal) => ({
  ...(await importOriginal<typeof HooksDeObservaciones>()),
  useObservacionesCliente: () => ({
    data: { observaciones: null },
    isPending: false,
    isError: false,
  }),
}));

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

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Datos ficticios.
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
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const clienteCon = (extra: Record<string, unknown> = {}) =>
  ({
    ...clienteJson,
    ...extra,
    creadoEn: new Date(clienteJson.creadoEn),
    actualizadoEn: new Date(clienteJson.actualizadoEn),
  }) as Cliente;

function renderEdicion(aEditar: Cliente) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EditarClienteSheet cliente={aEditar} onClose={vi.fn()} onActualizado={vi.fn()} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonGuardar = () => screen.getByRole('button', { name: 'Guardar cambios' });

async function cambiarDenominacion(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(campo('Denominación'));
  await user.type(campo('Denominación'), 'Muni Nueva');
}

/** Cuerpo JSON del único PATCH enviado. */
function cuerpoEnviado(): unknown {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
}

describe('EditarClienteSheet: emisor', () => {
  it.each(['PERSONA_FISICA', 'SOCIEDAD'] as const)(
    'precarga el emisor %s del cliente y no marca pendiente',
    (emisor) => {
      renderEdicion(clienteCon({ emisor }));

      expect(campo('Emisor')).toHaveTextContent(etiquetasEmisor[emisor]);
      expect(screen.queryByText(TEXTO_EMISOR_PENDIENTE)).not.toBeInTheDocument();
    },
  );

  it('un cliente sin emisor muestra "Sin asignar" y el marcador de pendiente, sin ser obligatorio', () => {
    renderEdicion(clienteCon());

    expect(campo('Emisor')).toHaveTextContent(TEXTO_EMISOR_SIN_ASIGNAR);
    expect(screen.getByText(TEXTO_EMISOR_PENDIENTE)).toHaveClass('text-warning');
    expect(campo('Emisor')).not.toBeRequired();
  });

  it('ofrece "Sin asignar" y la etiqueta de cada emisor', async () => {
    const user = renderEdicion(clienteCon());

    await user.click(campo('Emisor'));
    const opciones = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((opcion) => opcion.textContent);

    expect(opciones).toEqual([
      TEXTO_EMISOR_SIN_ASIGNAR,
      etiquetasEmisor.PERSONA_FISICA,
      etiquetasEmisor.SOCIEDAD,
    ]);
  });

  it('al elegir un emisor desaparece el marcador de pendiente', async () => {
    const user = renderEdicion(clienteCon());

    await elegirOpcion(user, campo('Emisor'), 'SOCIEDAD');

    expect(campo('Emisor')).toHaveTextContent(etiquetasEmisor.SOCIEDAD);
    expect(screen.queryByText(TEXTO_EMISOR_PENDIENTE)).not.toBeInTheDocument();
  });

  it('asignar un emisor envía solo el emisor', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteJson, emisor: 'SOCIEDAD' }, 200));
    const user = renderEdicion(clienteCon());

    await elegirOpcion(user, campo('Emisor'), 'SOCIEDAD');
    await user.click(botonGuardar());

    expect(cuerpoEnviado()).toStrictEqual({ emisor: 'SOCIEDAD' });
  });

  it('si el cliente tiene emisor y no se toca ese campo, el pedido no lo envía', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...clienteJson, denominacion: 'Muni Nueva', emisor: 'SOCIEDAD' }, 200),
    );
    const user = renderEdicion(clienteCon({ emisor: 'SOCIEDAD' }));

    await cambiarDenominacion(user);
    await user.click(botonGuardar());

    const cuerpo = cuerpoEnviado();
    expect(cuerpo).toStrictEqual({ denominacion: 'Muni Nueva' });
    expect(cuerpo).not.toHaveProperty('emisor');
  });

  it('si el cliente no tiene emisor y no se toca, tampoco lo envía (ni null)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteJson, denominacion: 'Muni Nueva' }, 200));
    const user = renderEdicion(clienteCon());

    await cambiarDenominacion(user);
    await user.click(botonGuardar());

    expect(cuerpoEnviado()).not.toHaveProperty('emisor');
  });

  it('pasar de un emisor a "Sin asignar" envía emisor: null', async () => {
    fetchMock.mockResolvedValue(jsonResponse(clienteJson, 200));
    const user = renderEdicion(clienteCon({ emisor: 'SOCIEDAD' }));

    await elegirOpcion(user, campo('Emisor'), '');
    await user.click(botonGuardar());

    expect(cuerpoEnviado()).toStrictEqual({ emisor: null });
  });

  it('cambiar de un emisor al otro envía el nuevo', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...clienteJson, emisor: 'PERSONA_FISICA' }, 200));
    const user = renderEdicion(clienteCon({ emisor: 'SOCIEDAD' }));

    await elegirOpcion(user, campo('Emisor'), 'PERSONA_FISICA');
    await user.click(botonGuardar());

    expect(cuerpoEnviado()).toStrictEqual({ emisor: 'PERSONA_FISICA' });
  });

  it('elegir un emisor y volver al original deja el guardado deshabilitado', async () => {
    const user = renderEdicion(clienteCon({ emisor: 'SOCIEDAD' }));

    await elegirOpcion(user, campo('Emisor'), 'PERSONA_FISICA');
    await elegirOpcion(user, campo('Emisor'), 'SOCIEDAD');

    expect(botonGuardar()).toBeDisabled();
  });
});
