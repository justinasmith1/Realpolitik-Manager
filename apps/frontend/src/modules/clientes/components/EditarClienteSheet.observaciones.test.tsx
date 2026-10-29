import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { observacionesClienteQueryKey } from '@/modules/clientes/api/observaciones-cliente.api';
import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';

// Observaciones internas en la edición (HU2.10), con el GET y el PUT reales sobre `fetch`. Se
// guardan en un pedido propio, después del PATCH del cliente y junto a las indicaciones de armado.

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

const CLIENTE_ID = 'c3d4e5f6-a7b8-4901-8def-012345678901';

const clienteJson = {
  id: CLIENTE_ID,
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
  /** Respuesta del GET de observaciones (una promesa permite demorarla). */
  getObservaciones?: () => Promise<Response>;
  putObservaciones?: () => Response | Promise<Response>;
  putIndicaciones?: () => Response | Promise<Response>;
  patch?: () => Response;
}

function servir({
  getObservaciones = () => Promise.resolve(json({ observaciones: 'Cambió el mail.' })),
  putObservaciones = () => json({ observaciones: 'Texto nuevo' }),
  putIndicaciones = () => json({ indicacionesArmado: 'Indicaciones nuevas' }),
  patch = () => json({ ...clienteJson, razonSocial: 'Municipio Nuevo' }),
}: Servidor = {}) {
  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    const metodo = init?.method ?? 'GET';
    if (url.endsWith('/observaciones')) {
      return metodo === 'PUT' ? Promise.resolve(putObservaciones()) : getObservaciones();
    }
    if (url.endsWith('/indicaciones-armado')) {
      return metodo === 'PUT'
        ? Promise.resolve(putIndicaciones())
        : Promise.resolve(json({ indicacionesArmado: 'Factura primero.' }));
    }
    return Promise.resolve(patch());
  });
}

/** Los pedidos que escriben, en orden, como "PATCH /ruta". */
const escrituras = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method !== undefined && init.method !== 'GET')
    .map(([entrada, init]) => `${init?.method} ${new URL(urlDe(entrada)).pathname}`);
const RUTA_CLIENTE = `/clientes/${CLIENTE_ID}`;
const putsDeObservaciones = () =>
  fetchMock.mock.calls.filter(
    ([entrada, init]) => init?.method === 'PUT' && urlDe(entrada).endsWith('/observaciones'),
  );

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
  return { user: userEvent.setup(), onActualizado, onClose };
}

const observaciones = () => screen.getByRole('textbox', { name: 'Observaciones internas' });
const indicaciones = () => screen.getByRole('textbox', { name: 'Indicaciones de armado' });
const botonGuardar = () => screen.getByRole('button', { name: 'Guardar cambios' });

async function reemplazar(user: UserEvent, campo: HTMLElement, texto: string) {
  await user.clear(campo);
  await user.click(campo);
  await user.paste(texto);
}

const esperarCargadas = () =>
  vi.waitFor(() => {
    expect(observaciones()).toHaveValue('Cambió el mail.');
    expect(indicaciones()).toHaveValue('Factura primero.');
  });

describe('EditarClienteSheet: observaciones internas (HU2.10)', () => {
  it('muestra las guardadas y, mientras llegan, no deja editar', async () => {
    let llegar: (respuesta: Response) => void = () => undefined;
    servir({
      getObservaciones: () =>
        new Promise<Response>((resolver) => {
          llegar = resolver;
        }),
    });
    renderEdicion();

    expect(observaciones()).toBeDisabled();
    expect(observaciones()).toHaveValue('');

    await act(async () => {
      llegar(json({ observaciones: 'Cambió el mail.' }));
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(observaciones()).toHaveValue('Cambió el mail.'));
    expect(observaciones()).toBeEnabled();
  });

  it('si no se pudieron cargar, no deja editar ni reemplazarlas a ciegas', async () => {
    servir({ getObservaciones: () => Promise.resolve(json(ERROR_500, 500)) });
    renderEdicion();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos cargar las observaciones internas.',
    );
    expect(observaciones()).toBeDisabled();
  });

  it('con solo la nota cambiada, el botón se habilita y se envía únicamente su PUT', async () => {
    servir();
    const { user, onActualizado } = renderEdicion();
    await esperarCargadas();
    expect(botonGuardar()).toBeDisabled();

    await reemplazar(user, observaciones(), '  Pausó la pauta.\nRetoma en marzo.  ');
    expect(botonGuardar()).toBeEnabled();
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
    expect(escrituras()).toEqual([`PUT ${RUTA_CLIENTE}/observaciones`]);
    expect(JSON.parse(putsDeObservaciones()[0]?.[1]?.body as string)).toEqual({
      observaciones: 'Pausó la pauta.\nRetoma en marzo.',
    });
    // Sin cambios en los datos, la página recibe el cliente tal cual estaba.
    expect(onActualizado).toHaveBeenCalledWith(expect.objectContaining({ id: CLIENTE_ID }));
  });

  it('borrar todo el texto envía null', async () => {
    servir({ putObservaciones: () => json({ observaciones: null }) });
    const { user, onActualizado } = renderEdicion();
    await esperarCargadas();

    await user.clear(observaciones());
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
    expect(JSON.parse(putsDeObservaciones()[0]?.[1]?.body as string)).toEqual({
      observaciones: null,
    });
  });

  it('volver al texto guardado, o dejar solo espacios de más, deja el formulario sin cambios', async () => {
    servir();
    const { user } = renderEdicion();
    await esperarCargadas();

    await user.type(observaciones(), '!');
    expect(botonGuardar()).toBeEnabled();
    await user.type(observaciones(), '{Backspace}');
    expect(botonGuardar()).toBeDisabled();
    await user.type(observaciones(), '   ');
    expect(botonGuardar()).toBeDisabled();
  });

  it('con datos y nota cambiados, guarda primero el cliente y después la nota', async () => {
    servir();
    const { user, onActualizado } = renderEdicion();
    await esperarCargadas();

    await user.clear(screen.getByLabelText('Razón social'));
    await user.type(screen.getByLabelText('Razón social'), 'Municipio Nuevo');
    await reemplazar(user, observaciones(), 'Nota nueva.');
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
    expect(escrituras()).toEqual([`PATCH ${RUTA_CLIENTE}`, `PUT ${RUTA_CLIENTE}/observaciones`]);
    expect(onActualizado).toHaveBeenCalledWith(
      expect.objectContaining({ razonSocial: 'Municipio Nuevo' }),
    );
  });

  describe('con el cliente en cualquier estado', () => {
    it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
      'un cliente %s: las indicaciones quedan bloqueadas, pero la nota se edita y se guarda',
      async (estado) => {
        servir();
        const { user, onActualizado } = renderEdicion(aCliente({ ...clienteJson, estado }));
        await esperarCargadas();

        expect(indicaciones()).toBeDisabled();
        expect(observaciones()).toBeEnabled();
        // Ningún aviso de estado en el campo de observaciones.
        expect(observaciones()).not.toHaveAccessibleDescription(/reactivalo/);

        await reemplazar(user, observaciones(), 'Pausó la pauta.');
        await user.click(botonGuardar());

        await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
        expect(escrituras()).toEqual([`PUT ${RUTA_CLIENTE}/observaciones`]);
      },
    );
  });

  describe('si algo falla', () => {
    it('si falla el PATCH del cliente, no se envía la nota y queda lo escrito', async () => {
      servir({ patch: () => json(ERROR_500, 500) });
      const { user, onActualizado } = renderEdicion();
      await esperarCargadas();

      await user.clear(screen.getByLabelText('Razón social'));
      await user.type(screen.getByLabelText('Razón social'), 'Municipio Nuevo');
      await reemplazar(user, observaciones(), 'Nota nueva.');
      await user.click(botonGuardar());

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(escrituras()).toEqual([`PATCH ${RUTA_CLIENTE}`]);
      expect(observaciones()).toHaveValue('Nota nueva.');
      expect(onActualizado).not.toHaveBeenCalled();
    });

    it('si se guarda el cliente pero falla la nota, no muestra "Guardado" y dice qué se guardó', async () => {
      servir({ putObservaciones: () => json(ERROR_500, 500) });
      const { user, onActualizado } = renderEdicion();
      await esperarCargadas();

      await user.clear(screen.getByLabelText('Razón social'));
      await user.type(screen.getByLabelText('Razón social'), 'Municipio Nuevo');
      await reemplazar(user, observaciones(), 'Nota nueva.');
      await user.click(botonGuardar());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Se guardaron los datos del cliente, pero no las observaciones internas. Probá de nuevo en unos segundos.',
      );
      expect(onActualizado).not.toHaveBeenCalled();
      expect(observaciones()).toHaveValue('Nota nueva.');
      expect(botonGuardar()).toBeEnabled();
    });

    it('si solo cambió la nota y falla, el error queda en el panel y se puede reintentar', async () => {
      let falla = true;
      servir({
        putObservaciones: () => (falla ? json(ERROR_500, 500) : json({ observaciones: 'Nota.' })),
      });
      const { user, onActualizado } = renderEdicion();
      await esperarCargadas();
      await reemplazar(user, observaciones(), 'Nota.');

      await user.click(botonGuardar());
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No pudimos guardar las observaciones internas. Probá de nuevo en unos segundos.',
      );
      expect(onActualizado).not.toHaveBeenCalled();

      falla = false;
      await user.click(botonGuardar());

      await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
      expect(putsDeObservaciones()).toHaveLength(2);
    });

    it('un 400 del PUT se marca en el campo de observaciones y lleva el foco ahí', async () => {
      servir({
        putObservaciones: () =>
          json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'x',
                details: [
                  {
                    campo: 'observaciones',
                    mensaje: 'Las observaciones no pueden contener caracteres de control.',
                  },
                ],
              },
            },
            400,
          ),
      });
      const { user } = renderEdicion();
      await esperarCargadas();
      await reemplazar(user, observaciones(), 'Nota.');

      await user.click(botonGuardar());

      expect(
        await screen.findByText('Las observaciones no pueden contener caracteres de control.'),
      ).toBeInTheDocument();
      expect(observaciones()).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(observaciones()).toHaveFocus());
    });

    it('si fallan las indicaciones, la nota se intenta igual y se guarda', async () => {
      servir({ putIndicaciones: () => json(ERROR_500, 500) });
      const { user, onActualizado } = renderEdicion();
      await esperarCargadas();
      await reemplazar(user, indicaciones(), 'Indicaciones nuevas');
      await reemplazar(user, observaciones(), 'Nota nueva.');

      await user.click(botonGuardar());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Se guardaron las observaciones internas, pero no las indicaciones de armado. Probá de nuevo en unos segundos.',
      );
      expect(escrituras()).toEqual([
        `PUT ${RUTA_CLIENTE}/indicaciones-armado`,
        `PUT ${RUTA_CLIENTE}/observaciones`,
      ]);
      expect(onActualizado).not.toHaveBeenCalled();
    });

    it('si fallan las dos notas, el aviso nombra las dos', async () => {
      servir({
        putIndicaciones: () => json(ERROR_500, 500),
        putObservaciones: () => json(ERROR_500, 500),
      });
      const { user } = renderEdicion();
      await esperarCargadas();
      await reemplazar(user, indicaciones(), 'Indicaciones nuevas');
      await reemplazar(user, observaciones(), 'Nota nueva.');

      await user.click(botonGuardar());

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No pudimos guardar las indicaciones de armado ni las observaciones internas.',
      );
    });

    it('con más de 1000 caracteres no envía ni el cliente ni las notas', async () => {
      servir();
      const { user } = renderEdicion();
      await esperarCargadas();
      await user.clear(screen.getByLabelText('Razón social'));
      await user.type(screen.getByLabelText('Razón social'), 'Municipio Nuevo');
      await user.clear(observaciones());
      await user.click(observaciones());
      await user.paste('a'.repeat(1001));

      await user.click(botonGuardar());

      expect(escrituras()).toEqual([]);
      expect(
        screen.getByText('Las observaciones no pueden superar los 1000 caracteres.'),
      ).toBeInTheDocument();
      expect(observaciones()).toHaveFocus();
    });

    it('un dato viejo inválido en un campo que no se tocó impide guardar solo la nota', async () => {
      // Hoy el formulario valida todo, no solo lo modificado: ver `clienteFormResolver`.
      servir();
      const { user } = renderEdicion(aCliente({ ...clienteJson, cuit: '30-50001274-9' }));
      await esperarCargadas();
      await reemplazar(user, observaciones(), 'Nota nueva.');

      await user.click(botonGuardar());

      expect(escrituras()).toEqual([]);
      expect(screen.getByLabelText('CUIT')).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('mientras guarda', () => {
    it('no se cierra el panel ni se envía dos veces', async () => {
      let terminar: (respuesta: Response) => void = () => undefined;
      servir({
        putObservaciones: () =>
          new Promise<Response>((resolver) => {
            terminar = resolver;
          }),
      });
      const { user, onClose, onActualizado } = renderEdicion();
      await esperarCargadas();
      await reemplazar(user, observaciones(), 'Nota nueva.');

      await user.click(botonGuardar());
      await user.click(screen.getByRole('button', { name: /Guardando/ }));
      await user.keyboard('{Escape}');

      expect(putsDeObservaciones()).toHaveLength(1);
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => {
        terminar(json({ observaciones: 'Nota nueva.' }));
        await Promise.resolve();
      });
      await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1));
      expect(putsDeObservaciones()).toHaveLength(1);
    });
  });
});

describe('EditarClienteSheet: foco inicial en las observaciones (HU2.10)', () => {
  /** Abre la hoja pidiendo el foco en las observaciones, con la caché como se indique. */
  function renderConFoco({ precargada }: { precargada: boolean }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (precargada) {
      queryClient.setQueryData(observacionesClienteQueryKey(CLIENTE_ID), {
        observaciones: 'Cambió el mail.',
      });
    }
    render(
      <QueryClientProvider client={queryClient}>
        <EditarClienteSheet
          cliente={aCliente(clienteJson)}
          onClose={vi.fn()}
          onActualizado={vi.fn()}
          enfocar="observaciones"
        />
      </QueryClientProvider>,
    );
  }

  const esperar = (ms: number) =>
    act(async () => {
      await new Promise((resolver) => setTimeout(resolver, ms));
    });

  it('con las observaciones ya cargadas, el foco va al campo y se queda ahí', async () => {
    servir();
    renderConFoco({ precargada: true });

    await waitFor(() => expect(observaciones()).toHaveFocus());
    await esperar(100);
    expect(observaciones()).toHaveFocus();
    expect(observaciones()).toHaveValue('Cambió el mail.');
  });

  it('sin pedirlo, la hoja se abre con su foco habitual, no en las observaciones', async () => {
    servir();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <EditarClienteSheet
          cliente={aCliente(clienteJson)}
          onClose={vi.fn()}
          onActualizado={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await esperarCargadas();
    await esperar(100);

    expect(observaciones()).not.toHaveFocus();
  });

  it('si el campo todavía no cargó, no fuerza el foco ni lo mueve cuando termina de cargar', async () => {
    let llegar: (respuesta: Response) => void = () => undefined;
    servir({
      getObservaciones: () =>
        new Promise<Response>((resolver) => {
          llegar = resolver;
        }),
    });
    renderConFoco({ precargada: false });

    expect(observaciones()).toBeDisabled();
    expect(observaciones()).not.toHaveFocus();

    await act(async () => {
      llegar(json({ observaciones: 'Cambió el mail.' }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(observaciones()).toHaveValue('Cambió el mail.'));
    await esperar(50);

    expect(observaciones()).not.toHaveFocus();
  });
});
