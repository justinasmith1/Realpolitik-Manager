import type { Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GestionarContactosSheet } from '@/modules/clientes/components/GestionarContactosSheet';
import { contactosQueryKey } from '@/modules/clientes/hooks/useContactos';

// La API se simula en `fetch`: el test recorre panel → formulario → mutation → contactos.api → http().
const fetchMock = vi.fn<typeof fetch>();

const CLIENTE_A = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const CLIENTE_B = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';
const ID_ANA = 'c1111111-1111-4111-a111-111111111111';
const ID_BRUNO = 'c2222222-2222-4222-a222-222222222222';
const ID_DIEGO = 'c4444444-4444-4444-a444-444444444444';

const cliente = (id: string, razonSocial: string) => ({ id, razonSocial }) as Cliente;
const clienteA = cliente(CLIENTE_A, 'Municipio de Ejemplo');
const clienteB = cliente(CLIENTE_B, 'Empresa de Ejemplo');

const contactoJson = (id: string, clienteId: string, nombre: string, email: string) => ({
  id,
  clienteId,
  nombre,
  area: 'Tesorería',
  email,
  recibeRendiciones: false,
  createdAt: '2026-10-08T12:00:00.000Z',
  updatedAt: '2026-10-08T12:00:00.000Z',
});

const ana = contactoJson(ID_ANA, CLIENTE_A, 'Ana Pérez', 'ana@ejemplo.example');
const bruno = contactoJson(ID_BRUNO, CLIENTE_A, 'Bruno Gómez', 'bruno@ejemplo.example');
const diego = contactoJson(ID_DIEGO, CLIENTE_B, 'Diego Ruiz', 'diego@ejemplo.example');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const errorApi = (status: number, code: string, message: string, details?: unknown) =>
  json({ error: { code, message, details } }, status);

/** Contactos que "tiene el servidor" por cliente. `PUT` los reemplaza. */
let servidor: Record<string, unknown[]>;

function simularServidor() {
  fetchMock.mockImplementation((entrada, init) => {
    const url =
      typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const clienteId = /\/clientes\/([^/]+)\/contactos/.exec(url)?.[1] ?? '';
    if (init?.method === 'PUT') {
      const { contactos } = JSON.parse(init.body as string) as { contactos: { id?: string }[] };
      servidor[clienteId] = contactos.map((c, i) =>
        contactoJson(
          c.id ?? `c9999999-9999-4999-a999-99999999999${i}`,
          clienteId,
          'Guardado',
          `g${i}@ejemplo.example`,
        ),
      );
      return Promise.resolve(json(servidor[clienteId]));
    }
    return Promise.resolve(json(servidor[clienteId] ?? []));
  });
}

const pedidos = (metodo?: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === (metodo ?? 'GET'));
const cuerpoDelPut = () =>
  JSON.parse(pedidos('PUT')[0]?.[1]?.body as string) as { contactos: unknown[] };

function renderPanel(inicial: Cliente | null = clienteA) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const arbol = (actual: Cliente | null) => (
    <QueryClientProvider client={queryClient}>
      <GestionarContactosSheet cliente={actual} onClose={onClose} />
    </QueryClientProvider>
  );
  const vista = render(arbol(inicial));
  return {
    queryClient,
    onClose,
    user: userEvent.setup(),
    cambiarCliente: (actual: Cliente | null) => vista.rerender(arbol(actual)),
  };
}

const grupo = (n: number) => within(screen.getByRole('group', { name: `Contacto ${n}` }));
const botonGuardar = () => screen.getByRole('button', { name: 'Guardar contactos' });
const panel = () => screen.queryByRole('dialog', { name: /Contactos de/ });

/**
 * TanStack Query agrupa sus notificaciones con un `setTimeout(0)`: tras un refetch o un cambio de
 * caché, el re-render llega un instante después. Hay que esperarlo antes de afirmar que algo
 * NO cambió; si no, la aserción corre antes del re-render y pasa por vacío.
 */
const esperarRender = () => act(() => new Promise<void>((resolver) => setTimeout(resolver, 50)));

/** Espera a que el panel termine de cargar y muestre el formulario. */
const formularioCargado = () => screen.findByRole('button', { name: 'Guardar contactos' });

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  servidor = { [CLIENTE_A]: [ana, bruno], [CLIENTE_B]: [diego] };
  simularServidor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  focusManager.setFocused(undefined);
});

describe('GestionarContactosSheet: carga', () => {
  it('muestra el panel del cliente con sus contactos', async () => {
    renderPanel();

    expect(
      screen.getByRole('dialog', { name: 'Contactos de Municipio de Ejemplo' }),
    ).toBeInTheDocument();
    await formularioCargado();
    expect(grupo(1).getByLabelText('Nombre')).toHaveValue('Ana Pérez');
    expect(grupo(2).getByLabelText('Nombre')).toHaveValue('Bruno Gómez');
    expect(pedidos()).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example/clientes/${CLIENTE_A}/contactos`,
    );
  });

  it('con el panel cerrado no pide nada', () => {
    renderPanel(null);

    expect(panel()).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si no puede cargar los contactos lo avisa', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Error al cargar contactos');
  });
});

describe('GestionarContactosSheet: lo escrito no se pierde por un refetch', () => {
  it('si la query se vuelve a pedir, el formulario no se remonta y conserva lo tipeado', async () => {
    const { user, queryClient } = renderPanel();
    await formularioCargado();
    const nombre = grupo(1).getByLabelText('Nombre');
    await user.type(nombre, ' (en edición)');
    // El servidor ahora devuelve datos distintos: el formulario no debe pisar lo escrito con ellos.
    servidor[CLIENTE_A] = [{ ...ana, nombre: 'Ana desde el servidor' }, bruno];

    await act(() => queryClient.refetchQueries({ queryKey: contactosQueryKey(CLIENTE_A) }));
    await esperarRender();

    expect(pedidos()).toHaveLength(2);
    expect(grupo(1).getByLabelText('Nombre')).toBe(nombre);
    expect(nombre).toHaveValue('Ana Pérez (en edición)');
    expect(screen.queryByDisplayValue('Ana desde el servidor')).not.toBeInTheDocument();
  });

  it('si llegan datos nuevos a la caché de la query, el formulario no se remonta', async () => {
    const { user, queryClient } = renderPanel();
    await formularioCargado();
    const nombre = grupo(1).getByLabelText('Nombre');
    await user.type(nombre, ' (en edición)');

    // Es lo que ocurre cuando un refetch trae datos distintos: la query cambia de `data` y de
    // `dataUpdatedAt`. Antes, `dataUpdatedAt` formaba parte del `key` del formulario.
    act(() => {
      queryClient.setQueryData(contactosQueryKey(CLIENTE_A), [
        contactoJson(ID_ANA, CLIENTE_A, 'Ana desde el servidor', 'ana@ejemplo.example'),
      ]);
    });
    await esperarRender();

    expect(grupo(1).getByLabelText('Nombre')).toBe(nombre);
    expect(nombre).toHaveValue('Ana Pérez (en edición)');
    expect(screen.queryAllByRole('group')).toHaveLength(2);
  });

  it('también conserva un contacto agregado que todavía no se guardó', async () => {
    const { user, queryClient } = renderPanel();
    await formularioCargado();
    await user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    await user.type(grupo(3).getByLabelText('Nombre'), 'Carla Díaz');

    await act(() => queryClient.refetchQueries({ queryKey: contactosQueryKey(CLIENTE_A) }));
    await esperarRender();

    expect(grupo(3).getByLabelText('Nombre')).toHaveValue('Carla Díaz');
  });

  it('volver a la pestaña (foco de la ventana) no dispara ningún pedido ni resetea el formulario', async () => {
    const { user } = renderPanel();
    await formularioCargado();
    const nombre = grupo(1).getByLabelText('Nombre');
    await user.type(nombre, ' (en edición)');

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(() => new Promise((resolver) => setTimeout(resolver, 50)));

    expect(pedidos()).toHaveLength(1);
    expect(grupo(1).getByLabelText('Nombre')).toBe(nombre);
    expect(nombre).toHaveValue('Ana Pérez (en edición)');
  });

  it('invalidar las queries de clientes (alta, edición, estado) no vuelve a pedir los contactos', async () => {
    const { queryClient } = renderPanel();
    await formularioCargado();

    await act(() => queryClient.invalidateQueries({ queryKey: ['clientes'] }));
    await esperarRender();

    expect(pedidos()).toHaveLength(1);
  });
});

describe('GestionarContactosSheet: guardar', () => {
  it('guarda con UNA sola request PUT que lleva la colección completa, y cierra', async () => {
    const { user, onClose } = renderPanel();
    await formularioCargado();
    await user.clear(grupo(1).getByLabelText('Nombre'));
    await user.type(grupo(1).getByLabelText('Nombre'), 'Ana Renombrada');
    await user.clear(grupo(2).getByLabelText('Email'));
    await user.type(grupo(2).getByLabelText('Email'), 'bruno.nuevo@ejemplo.example');
    await user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    await user.type(grupo(3).getByLabelText('Nombre'), 'Carla Díaz');
    await user.type(grupo(3).getByLabelText('Área'), 'Compras');
    await user.type(grupo(3).getByLabelText('Email'), 'carla@ejemplo.example');
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Una sola request de escritura, y ninguna otra: ni POST/PATCH/DELETE sueltos ni un refetch.
    expect(pedidos('PUT')).toHaveLength(1);
    expect(pedidos('POST')).toHaveLength(0);
    expect(pedidos('PATCH')).toHaveLength(0);
    expect(pedidos('DELETE')).toHaveLength(0);
    expect(pedidos()).toHaveLength(1);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `https://api.example/clientes/${CLIENTE_A}/contactos`,
    );
    expect(cuerpoDelPut().contactos).toStrictEqual([
      {
        id: ID_ANA,
        nombre: 'Ana Renombrada',
        area: 'Tesorería',
        email: 'ana@ejemplo.example',
        recibeRendiciones: false,
      },
      {
        id: ID_BRUNO,
        nombre: 'Bruno Gómez',
        area: 'Tesorería',
        email: 'bruno.nuevo@ejemplo.example',
        recibeRendiciones: false,
      },
      {
        nombre: 'Carla Díaz',
        area: 'Compras',
        email: 'carla@ejemplo.example',
        recibeRendiciones: false,
      },
    ]);
  });

  it('un contacto eliminado simplemente no viaja en la lista', async () => {
    const { user, onClose } = renderPanel();
    await formularioCargado();

    await user.click(screen.getByRole('button', { name: 'Eliminar contacto Ana Pérez' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pedidos('PUT')).toHaveLength(1);
    expect(cuerpoDelPut().contactos).toStrictEqual([expect.objectContaining({ id: ID_BRUNO })]);
    expect(pedidos('DELETE')).toHaveLength(0);
  });

  it('al guardar deja la colección que devolvió el servidor en el caché, sin pedirla otra vez', async () => {
    const { user, onClose, queryClient } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pedidos()).toHaveLength(1);
    expect(queryClient.getQueryData(contactosQueryKey(CLIENTE_A))).toEqual([
      expect.objectContaining({ id: ID_ANA }),
      expect.objectContaining({ id: ID_BRUNO }),
    ]);
  });

  it('mientras guarda, deshabilita los botones y no se puede cerrar con Escape', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    fetchMock.mockImplementation((_entrada, init) =>
      init?.method === 'PUT'
        ? new Promise<Response>((resolver) => {
            responder = resolver;
          })
        : Promise.resolve(json([ana])),
    );
    const { user, onClose } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());
    expect(await screen.findByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.keyboard('{Escape}');

    expect(panel()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(pedidos('PUT')).toHaveLength(1);

    responder(json([ana]));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('GestionarContactosSheet: errores al guardar', () => {
  /** Hace que el próximo PUT falle con `respuesta`; los demás pedidos siguen normales. */
  const fallaElPut = (respuesta: () => Promise<Response>) => {
    const normal = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((entrada, init) =>
      init?.method === 'PUT'
        ? respuesta()
        : (normal?.(entrada, init) ?? Promise.reject(new Error('sin servidor'))),
    );
  };

  it('ante un error del servidor el panel queda abierto, avisa y conserva TODO lo tipeado', async () => {
    fallaElPut(() => Promise.resolve(new Response('boom', { status: 500 })));
    const { user, onClose } = renderPanel();
    await formularioCargado();
    await user.type(grupo(1).getByLabelText('Nombre'), ' (editado)');
    await user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    await user.type(grupo(3).getByLabelText('Nombre'), 'Carla Díaz');
    await user.type(grupo(3).getByLabelText('Área'), 'Compras');
    await user.type(grupo(3).getByLabelText('Email'), 'carla@ejemplo.example');

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos guardar los contactos. Probá de nuevo en unos segundos.',
    );
    expect(panel()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(grupo(1).getByLabelText('Nombre')).toHaveValue('Ana Pérez (editado)');
    expect(grupo(3).getByLabelText('Nombre')).toHaveValue('Carla Díaz');
    expect(grupo(3).getByLabelText('Email')).toHaveValue('carla@ejemplo.example');
    // No hubo refetch que pudiera haber pisado el formulario.
    expect(pedidos()).toHaveLength(1);
    expect(botonGuardar()).toBeEnabled();
  });

  it('tras el error se puede reintentar y el segundo intento guarda y cierra', async () => {
    let intentos = 0;
    fallaElPut(() => {
      intentos += 1;
      return intentos === 1
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(json([ana, bruno]));
    });
    const { user, onClose } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(botonGuardar());

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(pedidos('PUT')).toHaveLength(2);
  });

  it('un 409 por email duplicado se explica sin mostrar detalles técnicos', async () => {
    fallaElPut(() =>
      Promise.resolve(
        errorApi(409, 'CONFLICT', 'El cliente ya tiene un contacto con ese email', {
          motivo: 'EMAIL_DUPLICADO',
        }),
      ),
    );
    const { user, onClose } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Alguno de los emails ya lo tiene otro contacto de este cliente. Revisalos y probá de nuevo.',
    );
    expect(screen.queryByText(/EMAIL_DUPLICADO|CONFLICT/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('un 409 por edición concurrente pide reintentar', async () => {
    fallaElPut(() =>
      Promise.resolve(errorApi(409, 'CONFLICT', 'x', { motivo: 'CONTACTOS_MODIFICADOS' })),
    );
    const { user } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent('cambiaron mientras los editabas');
  });

  it('un 404 por un contacto que ya no existe lo dice, y no pierde lo escrito', async () => {
    fallaElPut(() => Promise.resolve(errorApi(404, 'NOT_FOUND', 'Contacto no encontrado')));
    const { user } = renderPanel();
    await formularioCargado();
    await user.type(grupo(2).getByLabelText('Área'), ' Norte');

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Alguno de los contactos ya no existe',
    );
    expect(grupo(2).getByLabelText('Área')).toHaveValue('Tesorería Norte');
  });

  it('un 404 del cliente dice que el cliente ya no existe', async () => {
    fallaElPut(() => Promise.resolve(errorApi(404, 'NOT_FOUND', 'Cliente no encontrado')));
    const { user } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());

    expect(await screen.findByRole('alert')).toHaveTextContent('Este cliente ya no existe');
  });

  it('un 400 del servidor marca el campo indicado con SU mensaje y lo enfoca', async () => {
    fallaElPut(() =>
      Promise.resolve(
        errorApi(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', [
          {
            campo: 'contactos.1.email',
            mensaje: 'El email del contacto no tiene un formato válido.',
          },
        ]),
      ),
    );
    const { user, onClose } = renderPanel();
    await formularioCargado();

    await user.click(botonGuardar());

    await vi.waitFor(() =>
      expect(grupo(2).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(grupo(2).getByLabelText('Email')).toHaveAccessibleDescription(
      'El email del contacto no tiene un formato válido.',
    );
    expect(grupo(2).getByLabelText('Email')).toHaveFocus();
    expect(grupo(1).getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('GestionarContactosSheet: validación antes de enviar', () => {
  it('emails repetidos en el formulario se marcan en línea y NO se hace ningún PUT', async () => {
    const { user } = renderPanel();
    await formularioCargado();
    await user.clear(grupo(2).getByLabelText('Email'));
    await user.type(grupo(2).getByLabelText('Email'), 'ANA@ejemplo.example');

    await user.click(botonGuardar());

    const mensaje = 'Este email está repetido en otro contacto de la lista.';
    expect(grupo(1).getByLabelText('Email')).toHaveAccessibleDescription(mensaje);
    expect(grupo(2).getByLabelText('Email')).toHaveAccessibleDescription(mensaje);
    expect(pedidos('PUT')).toHaveLength(0);
  });

  it('un nombre inválido muestra el mensaje de shared y no envía', async () => {
    const { user } = renderPanel();
    await formularioCargado();
    await user.clear(grupo(1).getByLabelText('Nombre'));
    await user.type(grupo(1).getByLabelText('Nombre'), 'A');

    await user.click(botonGuardar());

    expect(screen.getByText('El nombre debe tener al menos 2 caracteres.')).toBeInTheDocument();
    expect(pedidos('PUT')).toHaveLength(0);
  });
});

describe('GestionarContactosSheet: cambio de cliente y reapertura', () => {
  it('al pasar a otro cliente carga SUS contactos y descarta lo escrito del anterior', async () => {
    const { user, cambiarCliente } = renderPanel(clienteA);
    await formularioCargado();
    await user.type(grupo(1).getByLabelText('Nombre'), ' (sin guardar)');

    cambiarCliente(clienteB);

    await vi.waitFor(() => expect(screen.getByDisplayValue('Diego Ruiz')).toBeInTheDocument());
    expect(
      screen.getByRole('dialog', { name: 'Contactos de Empresa de Ejemplo' }),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/Ana Pérez/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('group')).toHaveLength(1);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `https://api.example/clientes/${CLIENTE_B}/contactos`,
    );
  });

  it('tras guardar y volver a abrir, muestra lo persistido y no lo que había en el formulario', async () => {
    const { user, onClose, cambiarCliente } = renderPanel(clienteA);
    await formularioCargado();
    await user.click(screen.getByRole('button', { name: 'Eliminar contacto Bruno Gómez' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(botonGuardar());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    cambiarCliente(null);
    await vi.waitFor(() => expect(panel()).not.toBeInTheDocument());

    // Lo que "persistió" el servidor es lo que devolvió el PUT.
    cambiarCliente(clienteA);

    await formularioCargado();
    expect(pedidos()).toHaveLength(2);
    expect(screen.queryAllByRole('group')).toHaveLength(servidor[CLIENTE_A]?.length ?? -1);
  });
});
