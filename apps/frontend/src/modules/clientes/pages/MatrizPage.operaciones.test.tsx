import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';
import { elegirOpcion } from '@/test/select';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

const ID = '11111111-1111-4111-a111-111111111111';
const TIPO_FACTURA = '22222222-2222-4222-a222-222222222222';
const TIPO_ZOCALO = '33333333-3333-4333-a333-333333333333';
const TIPO_ACTA = '44444444-4444-4444-a444-444444444444';
const REQ_ZOCALO = '55555555-5555-4555-a555-555555555555';
const REQ_ACTA = '66666666-6666-4666-a666-666666666666';

const fechas = {
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const clienteActivo = {
  id: ID,
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
  estado: 'ACTIVO',
  matrizConfigurada: true,
  ...fechas,
};

function tipo(id: string, nombre: string, activo = true) {
  return { id, nombre, descripcion: null, activo, ...fechas };
}

function requisito(parcial: Record<string, unknown>) {
  return {
    id: REQ_ZOCALO,
    clienteId: ID,
    tipoDocumento: { id: TIPO_ZOCALO, nombre: 'Zócalo', activo: true },
    cantidad: 3,
    diasAproximados: [15, 1, 8],
    canalEntrega: null,
    nota: null,
    ...fechas,
    ...parcial,
  };
}

const zocalo = requisito({});
const acta = requisito({
  id: REQ_ACTA,
  tipoDocumento: { id: TIPO_ACTA, nombre: 'Acta', activo: false },
  cantidad: 2,
  diasAproximados: [],
  canalEntrega: 'WHATSAPP',
  nota: 'Llevar copia',
});

interface Escena {
  cliente: typeof clienteActivo;
  requisitos: ReturnType<typeof requisito>[];
  tipos: ReturnType<typeof tipo>[];
  tiposMal: boolean;
  post: ((cuerpo: Record<string, unknown>) => Response | Promise<Response>) | null;
  patch: ((cuerpo: Record<string, unknown>) => Response | Promise<Response>) | null;
  borrar: (() => Response | Promise<Response>) | null;
}

let escena: Escena;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function cuerpoDe(init?: RequestInit): Record<string, unknown> {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
}

function jsonDePedido(body: RequestInit['body']): unknown {
  if (typeof body !== 'string') {
    throw new Error('Se esperaba un body JSON en formato string');
  }

  return JSON.parse(body) as unknown;
}

function pedidos(metodo: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === metodo);
}

function preparar(parcial: Partial<Escena> = {}) {
  escena = {
    cliente: { ...clienteActivo },
    requisitos: [zocalo],
    tipos: [
      tipo(TIPO_FACTURA, 'Factura'),
      tipo(TIPO_ZOCALO, 'Zócalo'),
      tipo(TIPO_ACTA, 'Acta', false),
    ],
    tiposMal: false,
    post: null,
    patch: null,
    borrar: null,
    ...parcial,
  };
  fetchMock.mockImplementation((entrada, init) => {
    const path = new URL(urlDe(entrada)).pathname;
    const metodo = init?.method ?? 'GET';
    if (path === '/tipos-documento') {
      return Promise.resolve(
        escena.tiposMal ? json({ error: { code: 'INTERNAL_ERROR' } }, 500) : json(escena.tipos),
      );
    }
    if (path === `/clientes/${ID}/requisitos` && metodo === 'GET') {
      return Promise.resolve(json(escena.requisitos));
    }
    if (path === `/clientes/${ID}/requisitos` && metodo === 'POST') {
      const cuerpo = cuerpoDe(init);
      if (escena.post !== null) return Promise.resolve(escena.post(cuerpo));
      const elegido = escena.tipos.find((item) => item.id === cuerpo.tipoDocumentoId);
      const creado = requisito({
        id: '77777777-7777-4777-a777-777777777777',
        tipoDocumento: {
          id: String(cuerpo.tipoDocumentoId),
          nombre: elegido?.nombre ?? 'Documento',
          activo: true,
        },
        cantidad: cuerpo.cantidad,
        diasAproximados: cuerpo.diasAproximados,
        canalEntrega: cuerpo.canalEntrega,
        nota: cuerpo.nota,
      });
      escena.requisitos = [...escena.requisitos, creado];
      escena.cliente = { ...escena.cliente, matrizConfigurada: true };
      return Promise.resolve(json(creado, 201));
    }
    if (path.startsWith(`/clientes/${ID}/requisitos/`) && metodo === 'PATCH') {
      const cuerpo = cuerpoDe(init);
      if (escena.patch !== null) return Promise.resolve(escena.patch(cuerpo));
      const id = path.split('/').at(-1);
      escena.requisitos = escena.requisitos.map((item) =>
        item.id === id ? { ...item, ...cuerpo } : item,
      );
      const actualizado = escena.requisitos.find((item) => item.id === id);
      return Promise.resolve(json(actualizado));
    }
    if (path.startsWith(`/clientes/${ID}/requisitos/`) && metodo === 'DELETE') {
      if (escena.borrar !== null) return Promise.resolve(escena.borrar());
      const id = path.split('/').at(-1);
      escena.requisitos = escena.requisitos.filter((item) => item.id !== id);
      if (escena.requisitos.length === 0) {
        escena.cliente = { ...escena.cliente, matrizConfigurada: false };
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (path === `/clientes/${ID}`) return Promise.resolve(json(escena.cliente));
    return Promise.resolve(json({ error: { code: 'NOT_FOUND' } }, 404));
  });
}

function renderMatriz() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/clientes/:id/matriz', element: <MatrizPage /> },
      { path: '/clientes/tipos-documento', element: <h1>Tipos de documento</h1> },
    ],
    { initialEntries: [`/clientes/${ID}/matriz`] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router };
}

async function panel(nombre: string) {
  const titulo = await screen.findByRole('heading', { name: nombre });
  const dialogo = titulo.closest('[role="dialog"]');
  if (!(dialogo instanceof HTMLElement)) throw new Error(`No está el panel ${nombre}`);
  return dialogo;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('alta', () => {
  it('ofrece los tipos activos que todavía no están en la matriz', async () => {
    preparar();
    const { user } = renderMatriz();

    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await user.click(within(alta).getByLabelText('Tipo de documento'));
    const lista = await screen.findByRole('listbox');
    expect(within(lista).getByRole('option', { name: 'Factura' })).toBeInTheDocument();
    expect(within(lista).queryByRole('option', { name: 'Zócalo' })).not.toBeInTheDocument();
    expect(within(lista).queryByRole('option', { name: 'Acta' })).not.toBeInTheDocument();
  });

  it('sin tipos activos enlaza al catálogo', async () => {
    preparar({ tipos: [tipo(TIPO_ACTA, 'Acta', false)], requisitos: [] });
    const { user, router } = renderMatriz();

    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    expect(
      within(alta).getByText('No hay tipos de documento activos para agregar.'),
    ).toBeInTheDocument();
    await user.click(
      within(alta).getByRole('link', { name: 'Ir al catálogo de tipos de documento' }),
    );
    expect(router.state.location.pathname).toBe('/clientes/tipos-documento');
  });

  it('avisa cuando todos los tipos activos ya están asignados', async () => {
    preparar({ tipos: [tipo(TIPO_ZOCALO, 'Zócalo')] });
    const { user } = renderMatriz();

    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    expect(
      await screen.findByText('Todos los tipos activos ya están en esta matriz.'),
    ).toBeInTheDocument();
    expect(
      within(await panel('Agregar requisito')).getByRole('button', { name: 'Agregar requisito' }),
    ).toBeDisabled();
  });

  it('reintenta el catálogo si no cargó', async () => {
    preparar({ tiposMal: true });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    expect(within(alta).getByRole('alert')).toHaveTextContent(
      'No pudimos cargar los tipos de documento.',
    );
    escena.tiposMal = false;
    await user.click(within(alta).getByRole('button', { name: 'Reintentar' }));
    expect(await within(alta).findByLabelText('Tipo de documento')).toBeInTheDocument();
  });

  it('manda el alta y deja el aviso en la página', async () => {
    preparar({ requisitos: [], cliente: { ...clienteActivo, matrizConfigurada: false } });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await elegirOpcion(user, within(alta).getByLabelText('Tipo de documento'), 'Factura');
    await user.click(within(alta).getByRole('button', { name: 'Indicar días aproximados' }));
    await user.type(within(alta).getByLabelText('Día 1'), '5');
    await user.click(within(alta).getByRole('button', { name: 'Agregar requisito' }));

    expect(await screen.findByText('Se agregó Factura a la matriz.')).toBeInTheDocument();
    const post = pedidos('POST').at(-1);
    expect(jsonDePedido(post?.[1]?.body)).toEqual({
      tipoDocumentoId: TIPO_FACTURA,
      cantidad: 1,
      diasAproximados: [5],
      canalEntrega: null,
      nota: null,
    });
    expect(await screen.findByRole('rowheader', { name: /Factura/ })).toBeInTheDocument();
  });

  it('un error de validación no borra el resto y no envía el pedido', async () => {
    preparar({ requisitos: [] });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await elegirOpcion(user, within(alta).getByLabelText('Tipo de documento'), 'Factura');
    const cantidad = within(alta).getByLabelText('Cantidad requerida');
    await user.clear(cantidad);
    await user.type(cantidad, '0');
    await user.type(within(alta).getByLabelText('Nota'), 'sigue escrita');
    await user.click(within(alta).getByRole('button', { name: 'Agregar requisito' }));

    expect(await within(alta).findByText('La cantidad debe ser al menos 1.')).toBeInTheDocument();
    expect(within(alta).getByLabelText('Nota')).toHaveValue('sigue escrita');
    expect(pedidos('POST')).toHaveLength(0);
    expect(alta).toBeInTheDocument();
  });

  it('un duplicado marca el tipo y conserva lo demás', async () => {
    preparar({
      post: () => {
        escena.requisitos = [
          ...escena.requisitos,
          requisito({
            id: '77777777-7777-4777-a777-777777777777',
            tipoDocumento: { id: TIPO_FACTURA, nombre: 'Factura', activo: true },
            cantidad: 4,
            diasAproximados: [],
          }),
        ];
        return json(
          {
            error: {
              code: 'CONFLICT',
              message: 'El cliente ya tiene un requisito para ese tipo de documento',
              details: {
                motivo: 'REQUISITO_DUPLICADO',
                requisitoExistente: { id: REQ_ZOCALO, tipoDocumentoId: TIPO_FACTURA, cantidad: 4 },
              },
            },
          },
          409,
        );
      },
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await elegirOpcion(user, within(alta).getByLabelText('Tipo de documento'), 'Factura');
    await user.type(within(alta).getByLabelText('Nota'), 'no se pierde');
    await user.click(within(alta).getByRole('button', { name: 'Agregar requisito' }));

    expect(
      await within(alta).findByText(
        'Este cliente ya tiene un requisito activo para ese tipo (cantidad 4).',
      ),
    ).toBeInTheDocument();
    expect(within(alta).getByLabelText('Nota')).toHaveValue('no se pierde');
    expect(alta).toBeInTheDocument();
  });

  it('no manda dos altas si se confirma dos veces', async () => {
    let liberar: (respuesta: Response) => void = () => undefined;
    preparar({
      requisitos: [],
      post: () =>
        new Promise((resolve) => {
          liberar = resolve;
        }),
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await elegirOpcion(user, within(alta).getByLabelText('Tipo de documento'), 'Factura');
    const enviar = within(alta).getByRole('button', { name: 'Agregar requisito' });
    const insistente = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    await insistente.click(enviar);
    await insistente.click(enviar);
    expect(pedidos('POST')).toHaveLength(1);
    liberar(
      json(
        requisito({ tipoDocumento: { id: TIPO_FACTURA, nombre: 'Factura', activo: true } }),
        201,
      ),
    );
    expect(await screen.findByText('Se agregó Factura a la matriz.')).toBeInTheDocument();
  });

  it('pide confirmación para descartar y se puede seguir editando', async () => {
    preparar({ requisitos: [] });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await user.type(within(alta).getByLabelText('Nota'), 'borrador');
    await user.click(within(alta).getByRole('button', { name: 'Cancelar' }));

    const confirmar = await screen.findByRole('alertdialog', { name: /Descartar los cambios/ });
    await user.click(within(confirmar).getByRole('button', { name: 'Continuar editando' }));
    expect(within(alta).getByLabelText('Nota')).toHaveValue('borrador');

    await user.click(within(alta).getByRole('button', { name: 'Cancelar' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: /Descartar los cambios/ })).getByRole(
        'button',
        { name: 'Descartar cambios' },
      ),
    );
    expect(screen.queryByRole('heading', { name: 'Agregar requisito' })).not.toBeInTheDocument();
  });

  it('un cliente que pasa a inactivo a mitad del alta bloquea el envío y deja el panel', async () => {
    preparar({
      requisitos: [],
      post: () => {
        escena.cliente = { ...escena.cliente, estado: 'INACTIVO' };
        return json(
          {
            error: {
              code: 'CONFLICT',
              message: 'El cliente no está activo',
              details: { motivo: 'CLIENTE_NO_ACTIVO', estado: 'INACTIVO' },
            },
          },
          409,
        );
      },
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }));
    const alta = await panel('Agregar requisito');
    await elegirOpcion(user, within(alta).getByLabelText('Tipo de documento'), 'Factura');
    await user.click(within(alta).getByRole('button', { name: 'Agregar requisito' }));

    expect(
      await within(alta).findByText(
        'Este cliente está inactivo. Ya no se puede modificar su matriz.',
      ),
    ).toBeInTheDocument();
    expect(within(alta).getByRole('button', { name: 'Agregar requisito' })).toBeDisabled();
    expect(alta).toBeInTheDocument();
  });
});

describe('edición', () => {
  it('muestra el tipo desactivado como texto y manda solo la nota borrada', async () => {
    preparar({ requisitos: [acta] });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Acta' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const edicion = await panel('Editar requisito');

    expect(within(edicion).getByText('Acta')).toBeInTheDocument();
    expect(within(edicion).getByText('Desactivado')).toBeInTheDocument();
    expect(within(edicion).queryByLabelText('Tipo de documento')).not.toBeInTheDocument();
    expect(within(edicion).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(within(edicion).getByText('Sin cambios para guardar.')).toBeInTheDocument();

    await user.clear(within(edicion).getByLabelText('Nota'));
    await user.click(within(edicion).getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Se guardaron los cambios de Acta.')).toBeInTheDocument();
    expect(jsonDePedido(pedidos('PATCH').at(-1)?.[1]?.body)).toEqual({ nota: null });
  });

  it('no manda un PATCH si solo se reordenan los días', async () => {
    preparar();
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const edicion = await panel('Editar requisito');
    const dia1 = within(edicion).getByLabelText('Día 1');
    const dia2 = within(edicion).getByLabelText('Día 2');
    const dia3 = within(edicion).getByLabelText('Día 3');
    await user.clear(dia1);
    await user.type(dia1, '1');
    await user.clear(dia2);
    await user.type(dia2, '8');
    await user.clear(dia3);
    await user.type(dia3, '15');
    expect(within(edicion).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(pedidos('PATCH')).toHaveLength(0);
  });

  it('bajar la cantidad conserva los días de más hasta quitarlos a propósito', async () => {
    preparar();
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const edicion = await panel('Editar requisito');
    const cantidad = within(edicion).getByLabelText('Cantidad requerida');
    await user.clear(cantidad);
    await user.type(cantidad, '1');
    expect(within(edicion).getByLabelText('Día 3')).toHaveValue('8');
    await user.click(within(edicion).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(edicion).findByText(/Cargá 1 día aproximado/)).toBeInTheDocument();
    expect(pedidos('PATCH')).toHaveLength(0);

    await user.click(within(edicion).getByRole('button', { name: 'Quitar los días que sobran' }));
    expect(within(edicion).queryByLabelText('Día 3')).not.toBeInTheDocument();
    await elegirOpcion(
      user,
      within(edicion).getByLabelText('Canal de entrega'),
      'Usar canal principal del cliente (Correo)',
    );
    await user.click(within(edicion).getByRole('button', { name: 'Guardar cambios' }));
    expect(jsonDePedido(pedidos('PATCH').at(-1)?.[1]?.body)).toEqual({
      cantidad: 1,
      diasAproximados: [15],
    });
  });

  it('volver al canal del cliente manda null', async () => {
    preparar({ requisitos: [acta] });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Acta' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const edicion = await panel('Editar requisito');
    await elegirOpcion(
      user,
      within(edicion).getByLabelText('Canal de entrega'),
      'Usar canal principal del cliente (Correo)',
    );
    await user.click(within(edicion).getByRole('button', { name: 'Guardar cambios' }));
    expect(jsonDePedido(pedidos('PATCH').at(-1)?.[1]?.body)).toEqual({ canalEntrega: null });
  });

  it('un error del servidor deja el panel abierto', async () => {
    preparar({
      requisitos: [acta],
      patch: () => json({ error: { code: 'INTERNAL_ERROR' } }, 500),
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Acta' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const edicion = await panel('Editar requisito');
    await user.type(within(edicion).getByLabelText('Nota'), ' extra');
    await user.click(within(edicion).getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await within(edicion).findByText(
        'No pudimos guardar el requisito. Probá de nuevo en unos segundos.',
      ),
    ).toBeInTheDocument();
    expect(edicion).toBeInTheDocument();
  });
});

describe('baja', () => {
  it('cancelar no borra', async () => {
    preparar();
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la matriz' }));
    const dialogo = await screen.findByRole('alertdialog', { name: /Quitar este requisito/ });
    expect(dialogo).toHaveTextContent('Las rendiciones ya abiertas no se modifican.');
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Zócalo')).toBeInTheDocument();
    expect(pedidos('DELETE')).toHaveLength(0);
  });

  it('confirma, saca el requisito y, si era el último, la matriz queda sin configurar', async () => {
    preparar({ requisitos: [zocalo] });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la matriz' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: /Quitar este requisito/ })).getByRole(
        'button',
        { name: 'Quitar de la matriz' },
      ),
    );
    expect(
      await screen.findByText(
        'Se quitó Zócalo de la matriz. Las rendiciones ya abiertas no cambian.',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Esta matriz todavía no tiene requisitos' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin requisitos configurados')).toBeInTheDocument();
  });

  it('un 404 cierra el diálogo y avisa en la página', async () => {
    preparar({
      borrar: () => json({ error: { code: 'NOT_FOUND', message: 'No existe' } }, 404),
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la matriz' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Quitar de la matriz',
      }),
    );
    expect(await screen.findByText('Este recurso ya no está disponible.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sin red deja el diálogo para reintentar', async () => {
    let intentos = 0;
    preparar({
      borrar: () => {
        intentos += 1;
        if (intentos === 1) return Promise.reject(new TypeError('Failed to fetch'));
        escena.requisitos = [];
        escena.cliente = { ...escena.cliente, matrizConfigurada: false };
        return new Response(null, { status: 204 });
      },
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la matriz' }));
    const dialogo = await screen.findByRole('alertdialog');
    await user.click(within(dialogo).getByRole('button', { name: 'Quitar de la matriz' }));
    expect(
      await within(dialogo).findByText(
        'No pudimos quitar el requisito de la matriz. Probá de nuevo en unos segundos.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialogo).getByRole('button', { name: 'Quitar de la matriz' }));
    expect(
      await screen.findByText(
        'Se quitó Zócalo de la matriz. Las rendiciones ya abiertas no cambian.',
      ),
    ).toBeInTheDocument();
  });

  it('un segundo clic mientras se quita no manda otro DELETE', async () => {
    let liberar: (respuesta: Response) => void = () => undefined;
    preparar({
      borrar: () =>
        new Promise((resolve) => {
          liberar = resolve;
        }),
    });
    const { user } = renderMatriz();
    await user.click(await screen.findByRole('button', { name: 'Acciones de Zócalo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la matriz' }));
    const boton = within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Quitar de la matriz',
    });
    const insistente = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    await insistente.click(boton);
    await insistente.click(boton);
    expect(pedidos('DELETE')).toHaveLength(1);
    escena.requisitos = [];
    liberar(new Response(null, { status: 204 }));
    expect(await screen.findByText(/Se quitó Zócalo/)).toBeInTheDocument();
  });
});
