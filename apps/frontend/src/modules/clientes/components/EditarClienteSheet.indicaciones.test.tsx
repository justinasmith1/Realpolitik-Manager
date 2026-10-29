import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';

// Indicaciones de armado en la edición (HU2.4), con el GET y el PUT reales sobre `fetch`.

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

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

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
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
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const aCliente = (datos: typeof clienteJson): Cliente =>
  ({
    ...datos,
    creadoEn: new Date(datos.creadoEn),
    actualizadoEn: new Date(datos.actualizadoEn),
  }) as Cliente;

const ERROR_500 = { error: { code: 'INTERNAL_ERROR', message: 'Error' } };

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

interface Servidor {
  /** Respuesta del GET de indicaciones (una promesa permite demorarla). */
  get?: () => Promise<Response>;
  put?: () => Response;
  patch?: () => Response;
}

function servir({
  get = () => Promise.resolve(json({ indicacionesArmado: 'Factura primero.' })),
  put = () => json({ indicacionesArmado: 'Texto nuevo' }),
  patch = () => json({ ...clienteJson, razonSocial: 'Municipio Nuevo' }),
}: Servidor = {}) {
  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    const metodo = init?.method ?? 'GET';
    if (url.endsWith('/indicaciones-armado')) {
      return metodo === 'PUT' ? Promise.resolve(put()) : get();
    }
    if (url.endsWith('/observaciones')) return Promise.resolve(json({ observaciones: null }));
    return Promise.resolve(patch());
  });
}

const pedidos = (metodo: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === metodo);

function renderEdicion(cliente: Cliente = aCliente(clienteJson)) {
  const onActualizado = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <EditarClienteSheet cliente={cliente} onClose={onClose} onActualizado={onActualizado} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onActualizado };
}

const indicaciones = () => screen.getByLabelText('Instrucciones para el legajo');
const botonGuardar = () => screen.getByRole('button', { name: 'Guardar cambios' });

async function reemplazarIndicaciones(user: UserEvent, texto: string) {
  await user.clear(indicaciones());
  await user.click(indicaciones());
  await user.paste(texto);
}

describe('EditarClienteSheet: indicaciones de armado (HU2.4)', () => {
  it('muestra las guardadas y, mientras llegan, no deja editar', async () => {
    let responder: (respuesta: Response) => void = () => {};
    servir({ get: () => new Promise<Response>((resolver) => (responder = resolver)) });
    renderEdicion();

    expect(indicaciones()).toBeDisabled();
    expect(indicaciones()).toHaveValue('');

    act(() => responder(json({ indicacionesArmado: 'Factura primero.' })));

    await vi.waitFor(() => expect(indicaciones()).toBeEnabled());
    expect(indicaciones()).toHaveValue('Factura primero.');
  });

  it('si no se pudieron cargar, no deja editar ni reemplazarlas a ciegas', async () => {
    servir({ get: () => Promise.resolve(json(ERROR_500, 500)) });
    renderEdicion();

    expect(await screen.findByText(/No pudimos cargar las indicaciones de armado/)).toBeVisible();
    expect(indicaciones()).toBeDisabled();
  });

  it('borrar todo el texto envía null', async () => {
    servir({ put: () => json({ indicacionesArmado: null }) });
    const { user, onActualizado } = renderEdicion();
    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));

    await user.clear(indicaciones());
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
    const [, init] = pedidos('PUT')[0] ?? [];
    expect(JSON.parse(init?.body as string)).toEqual({ indicacionesArmado: null });
    expect(pedidos('PATCH')).toHaveLength(0);
  });

  it('volver al texto guardado deja el formulario sin cambios', async () => {
    servir();
    const { user } = renderEdicion();
    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));

    await reemplazarIndicaciones(user, 'Otro texto');
    expect(botonGuardar()).toBeEnabled();
    await reemplazarIndicaciones(user, 'Factura primero.');

    expect(botonGuardar()).toBeDisabled();
  });

  it('si se guarda el cliente pero falla el PUT, no muestra "Guardado" y dice qué se guardó', async () => {
    servir({ put: () => json(ERROR_500, 500) });
    const { user, onActualizado } = renderEdicion();
    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));

    await user.clear(screen.getByLabelText('Razón social'));
    await user.type(screen.getByLabelText('Razón social'), 'Municipio Nuevo');
    await reemplazarIndicaciones(user, 'Texto nuevo');
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Se guardaron los datos del cliente, pero no las indicaciones de armado. Probá de nuevo en unos segundos.',
    );
    expect(pedidos('PATCH')).toHaveLength(1);
    expect(onActualizado).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Guardado' })).not.toBeInTheDocument();
  });

  it('si solo cambian las indicaciones y el cliente ya no está activo, lo dice', async () => {
    servir({
      put: () =>
        json(
          {
            error: {
              code: 'CONFLICT',
              message: 'El cliente no está activo',
              details: { motivo: 'CLIENTE_NO_ACTIVO', estado: 'SUSPENDIDO' },
            },
          },
          409,
        ),
    });
    const { user, onActualizado } = renderEdicion();
    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));

    await reemplazarIndicaciones(user, 'Texto nuevo');
    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos guardar las indicaciones de armado. El cliente está suspendido: reactivalo para editar sus indicaciones.',
    );
    expect(onActualizado).not.toHaveBeenCalled();
  });

  it('un 400 del PUT se marca en el campo de indicaciones', async () => {
    servir({
      put: () =>
        json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Los datos enviados no son válidos',
              details: [
                {
                  campo: 'indicacionesArmado',
                  mensaje: 'Las indicaciones de armado no pueden contener caracteres de control.',
                },
              ],
            },
          },
          400,
        ),
    });
    const { user } = renderEdicion();
    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));

    await reemplazarIndicaciones(user, 'Texto nuevo');
    await user.click(botonGuardar());

    await vi.waitFor(() =>
      expect(indicaciones()).toHaveAccessibleDescription(
        expect.stringContaining('no pueden contener caracteres de control'),
      ),
    );
    expect(indicaciones()).toHaveAttribute('aria-invalid', 'true');
    expect(indicaciones()).toHaveFocus();
  });

  it('con más de 1000 caracteres no envía ni el cliente ni las indicaciones', async () => {
    servir();
    const { user, onActualizado } = renderEdicion();
    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));

    await user.clear(screen.getByLabelText('Razón social'));
    await user.type(screen.getByLabelText('Razón social'), 'Municipio Nuevo');
    await reemplazarIndicaciones(user, 'x'.repeat(1001));
    await user.click(botonGuardar());

    expect(indicaciones()).toHaveAccessibleDescription(
      expect.stringContaining('no pueden superar los 1000 caracteres'),
    );
    expect(indicaciones()).toHaveFocus();
    expect(pedidos('PATCH')).toHaveLength(0);
    expect(pedidos('PUT')).toHaveLength(0);
    expect(onActualizado).not.toHaveBeenCalled();
  });

  it('con el cliente inactivo muestra las indicaciones sin dejar editarlas', async () => {
    servir();
    renderEdicion(aCliente({ ...clienteJson, estado: 'INACTIVO' }));

    await vi.waitFor(() => expect(indicaciones()).toHaveValue('Factura primero.'));
    expect(indicaciones()).toBeDisabled();
    expect(
      screen.getByText(
        'El cliente está inactivo: reactivalo para editar sus indicaciones de armado.',
      ),
    ).toBeInTheDocument();
  });
});
