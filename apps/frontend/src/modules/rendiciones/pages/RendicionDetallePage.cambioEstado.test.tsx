import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  CLIENTE_ID,
  errorJson,
  itemReunidoJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Marcar la rendición como Completa y volverla a En curso, desde el detalle (HU3.6). El pedido es
// `PATCH /rendiciones/:id/estado`. Con todo reunido el botón está habilitado; el servidor vuelve a
// decidir y, si algo cambió en el medio (faltan documentos), el aviso dice cuántos. Lo que falta
// antes de pedirlo ("Faltan N") está en RendicionDetallePage.enviada.test.tsx.

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
  matrizConfigurada: true,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const ITEMS = [itemReunidoJson({ id: 'f1a2b3c4-d5e6-4789-8abc-def012345670' })];

const esPedidoDeEstado = (entrada: Parameters<typeof fetch>[0], init?: RequestInit) =>
  urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/estado`) && init?.method === 'PATCH';

function servir({
  inicial = {},
  respuestaDelPatch,
}: {
  inicial?: Record<string, unknown>;
  /** Cómo responde el PATCH; sin esto, aplica el estado pedido. */
  respuestaDelPatch?: () => Response | Promise<Response>;
} = {}) {
  let actual = { ...rendicionJson(inicial), items: ITEMS };

  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (esPedidoDeEstado(entrada, init)) {
      if (respuestaDelPatch !== undefined) return Promise.resolve(respuestaDelPatch());
      const { estado } = JSON.parse(init?.body as string) as { estado: string };
      actual = { ...actual, estado };
      return Promise.resolve(json(actual));
    }
    if (url.includes('/rendiciones/')) {
      return Promise.resolve(json(actual));
    }
    return Promise.resolve(json(clienteJson));
  });
}

function renderDetalle() {
  const router = createMemoryRouter(
    [{ path: '/clientes/:id/rendiciones/:rendicionId', element: <RendicionDetallePage /> }],
    { initialEntries: [`/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const esperarDetalle = () =>
  screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

const estadoMostrado = () => {
  const termino = screen.getByText('Estado', { selector: 'dt' });
  return within(termino.parentElement as HTMLElement).getByRole('definition');
};

const pedidosDeEstado = () =>
  fetchMock.mock.calls.filter(([entrada, init]) => esPedidoDeEstado(entrada, init));

/** El primer PATCH de estado: su URL y su cuerpo ya leído. */
function primerPedidoDeEstado(): { url: string; cuerpo: unknown } {
  const pedido = pedidosDeEstado()[0];
  if (pedido === undefined) throw new Error('No hubo ningún pedido de estado');
  const [entrada, init] = pedido;
  return { url: urlDe(entrada), cuerpo: JSON.parse(init?.body as string) };
}

describe('RendicionDetallePage: marcar como completa (HU3.6)', () => {
  it('con la rendición En curso ofrece "Marcar como completa" y no "Volver a en curso"', async () => {
    servir();
    renderDetalle();
    await esperarDetalle();

    const boton = screen.getByRole('button', { name: 'Marcar como completa' });
    expect(boton).toHaveAttribute('type', 'button');
    expect(boton).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Volver a en curso' })).not.toBeInTheDocument();
  });

  it('con la rendición Completa ofrece "Volver a en curso" y no "Marcar como completa"', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByRole('button', { name: 'Volver a en curso' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Marcar como completa' })).not.toBeInTheDocument();
  });

  it('los botones de estado van en un bloque de acciones propio, fuera de la línea de datos, en tamaño normal', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    renderDetalle();
    await esperarDetalle();

    const acciones = screen.getByRole('group', { name: 'Cambiar el estado' });
    const volver = within(acciones).getByRole('button', { name: 'Volver a en curso' });
    const enviar = within(acciones).getByRole('button', { name: 'Marcar como enviada' });
    expect(within(estadoMostrado()).queryAllByRole('button')).toHaveLength(0);
    // La principal en el estilo primario y la secundaria en outline; tamaño normal (no `xs`).
    expect(enviar).toHaveClass('bg-primary');
    expect(volver).toHaveClass('border-border', 'bg-background');
    expect(volver).not.toHaveClass('bg-primary');
    for (const boton of [volver, enviar]) {
      expect(boton).toHaveClass('h-11', 'md:h-9');
      expect(boton).not.toHaveClass('h-6');
    }
  });

  it('en una rendición anulada no ofrece ningún botón de estado', async () => {
    servir({ inicial: { vigencia: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByRole('button', { name: 'Marcar como completa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a en curso' })).not.toBeInTheDocument();
  });

  it('con la rendición Enviada no ofrece botones de completar ni de volver (HU3.7)', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByRole('button', { name: 'Marcar como completa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a en curso' })).not.toBeInTheDocument();
  });

  it('al marcar como completa pide PATCH /rendiciones/:id/estado con COMPLETA, muestra el nuevo estado y lo avisa', async () => {
    servir();
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

    expect(await screen.findByText('La rendición quedó completa.')).toBeVisible();
    const { url, cuerpo } = primerPedidoDeEstado();
    expect(url).toBe(`https://api.example/rendiciones/${RENDICION_ID}/estado`);
    expect(cuerpo).toEqual({ estado: 'COMPLETA' });
    expect(estadoMostrado()).toHaveTextContent('Completa');
    expect(await screen.findByRole('button', { name: 'Volver a en curso' })).toBeInTheDocument();
  });

  it('al volver a en curso pide EN_CURSO y lo avisa', async () => {
    servir({ inicial: { estado: 'COMPLETA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Volver a en curso' }));

    expect(await screen.findByText('La rendición volvió a En curso.')).toBeVisible();
    expect(primerPedidoDeEstado().cuerpo).toEqual({ estado: 'EN_CURSO' });
    expect(estadoMostrado()).toHaveTextContent('En curso');
  });

  it.each([
    [2, 'No se puede marcar como completa: faltan 2 documentos.'],
    [1, 'No se puede marcar como completa: falta 1 documento.'],
    [0, 'No se puede marcar como completa: la rendición no tiene documentos.'],
  ])(
    'si el servidor responde ITEMS_PENDIENTES con faltantes %i, avisa cuántos faltan',
    async (faltantes, texto) => {
      servir({
        respuestaDelPatch: () =>
          errorJson(409, 'CONFLICT', { motivo: 'ITEMS_PENDIENTES', faltantes }),
      });
      const { user } = renderDetalle();
      await esperarDetalle();

      await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

      expect(await screen.findByText(texto)).toBeVisible();
      expect(estadoMostrado()).toHaveTextContent('En curso');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Marcar como completa' })).toBeEnabled(),
      );
    },
  );

  it('si la rendición se anuló mientras tanto (409 RENDICION_ANULADA), lo avisa', async () => {
    servir({
      respuestaDelPatch: () => errorJson(409, 'CONFLICT', { motivo: 'RENDICION_ANULADA' }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

    expect(
      await screen.findByText('La rendición está anulada: ya no se puede modificar.'),
    ).toBeVisible();
  });

  it('ante TRANSICION_INVALIDA muestra un mensaje genérico', async () => {
    servir({
      respuestaDelPatch: () =>
        errorJson(409, 'CONFLICT', {
          motivo: 'TRANSICION_INVALIDA',
          estadoActual: 'ENVIADA',
          estadoNuevo: 'COMPLETA',
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));

    expect(
      await screen.findByText('Ese cambio de estado no está permitido desde el estado actual.'),
    ).toBeVisible();
  });

  it('mientras espera la respuesta el botón queda ocupado y no manda un segundo pedido', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    servir({
      respuestaDelPatch: () =>
        new Promise<Response>((resolver) => {
          responder = resolver;
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Marcar como completa' }));
    const ocupado = await screen.findByRole('button', { name: 'Guardando…' });
    expect(ocupado).toHaveAttribute('aria-disabled', 'true');
    await user.click(ocupado);
    expect(pedidosDeEstado()).toHaveLength(1);

    responder(json({ ...rendicionJson({ estado: 'COMPLETA' }), items: ITEMS }));
    expect(await screen.findByText('La rendición quedó completa.')).toBeVisible();
  });
});

describe('RendicionDetallePage: aprobar o rechazar (HU3.8)', () => {
  const MOTIVO = 'Faltó el CUIT 20-12345678-4';

  const confirmarAprobacion = () =>
    screen.findByRole('alertdialog', { name: '¿Confirmar aprobación?' });
  const dialogoDeRechazo = () => screen.findByRole('alertdialog', { name: 'Rechazar rendición' });

  it('una Enviada ofrece "Aprobar" y "Rechazar", y no los botones de las otras etapas', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeEnabled();
    for (const nombre of ['Marcar como completa', 'Volver a en curso', 'Marcar como enviada']) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument();
    }
  });

  it.each(['EN_CURSO', 'COMPLETA', 'APROBADA', 'RECHAZADA'])(
    'una %s no ofrece "Aprobar" ni "Rechazar"',
    async (estado) => {
      servir({ inicial: { estado } });
      renderDetalle();
      await esperarDetalle();

      expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
    },
  );

  it('una Enviada anulada no ofrece "Aprobar" ni "Rechazar"', async () => {
    servir({
      inicial: { estado: 'ENVIADA', vigencia: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' },
    });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
  });

  it('"Aprobar" abre un diálogo de confirmación sin pedir nada todavía', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    const dialogo = within(await confirmarAprobacion());
    expect(
      dialogo.getByText('Esta acción cierra la rendición. No se puede deshacer.'),
    ).toBeVisible();
    expect(dialogo.getByRole('button', { name: 'Aprobar' })).toBeEnabled();
    expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    expect(pedidosDeEstado()).toHaveLength(0);
  });

  it('cancelar la aprobación cierra el diálogo y no pide nada', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    await user.click(within(await confirmarAprobacion()).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(pedidosDeEstado()).toHaveLength(0);
  });

  it('confirmar la aprobación pide { estado: APROBADA }, avisa y deja la rendición Aprobada', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    await user.click(within(await confirmarAprobacion()).getByRole('button', { name: 'Aprobar' }));

    expect(await screen.findByText('La rendición fue aprobada.')).toBeVisible();
    expect(primerPedidoDeEstado()).toEqual({
      url: expect.stringContaining(`/rendiciones/${RENDICION_ID}/estado`) as unknown,
      cuerpo: { estado: 'APROBADA' },
    });
    expect(estadoMostrado()).toHaveTextContent('Aprobada');
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('el pedido de aprobación no se manda dos veces si se toca dos veces', async () => {
    let soltar: (respuesta: Response) => void = () => undefined;
    servir({
      inicial: { estado: 'ENVIADA' },
      respuestaDelPatch: () =>
        new Promise<Response>((resolver) => {
          soltar = resolver;
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    const confirmar = within(await confirmarAprobacion()).getByRole('button', {
      name: /Aprobar|Guardando/,
    });

    await user.click(confirmar);
    await user.click(confirmar);

    expect(pedidosDeEstado()).toHaveLength(1);
    soltar(json({ ...rendicionJson({ estado: 'APROBADA' }), items: ITEMS }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('si la aprobación falla con TRANSICION_INVALIDA, lo dice dentro del diálogo y sigue abierto', async () => {
    servir({
      inicial: { estado: 'ENVIADA' },
      respuestaDelPatch: () =>
        errorJson(409, 'CONFLICT', {
          motivo: 'TRANSICION_INVALIDA',
          estadoActual: 'RECHAZADA',
          estadoNuevo: 'APROBADA',
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    await user.click(within(await confirmarAprobacion()).getByRole('button', { name: 'Aprobar' }));

    const dialogo = within(await confirmarAprobacion());
    expect(
      await dialogo.findByText('La rendición ya cambió de estado. Volvé a cargar la página.'),
    ).toBeVisible();
  });

  it('"Rechazar" abre el diálogo con el campo del motivo y la confirmación deshabilitada', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('button', { name: 'Rechazar' }));

    const dialogo = within(await dialogoDeRechazo());
    const campo = dialogo.getByRole('textbox', { name: 'Motivo del rechazo' });
    expect(campo).toHaveAttribute('placeholder', 'Describí qué pidió corregir el cliente...');
    expect(campo).toHaveAttribute('maxlength', '500');
    expect(campo).toBeRequired();
    expect(dialogo.getByRole('button', { name: 'Confirmar rechazo' })).toBeDisabled();
    expect(pedidosDeEstado()).toHaveLength(0);
  });

  it.each(['', '   '])('con el motivo %j la confirmación sigue deshabilitada', async (texto) => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialogo = within(await dialogoDeRechazo());

    if (texto !== '') {
      await user.type(dialogo.getByRole('textbox', { name: 'Motivo del rechazo' }), texto);
    }

    expect(dialogo.getByRole('button', { name: 'Confirmar rechazo' })).toBeDisabled();
  });

  it('confirmar el rechazo pide { estado: RECHAZADA, motivo } recortado, avisa y la deja Rechazada', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialogo = within(await dialogoDeRechazo());

    await user.type(dialogo.getByRole('textbox', { name: 'Motivo del rechazo' }), `  ${MOTIVO}  `);
    await user.click(dialogo.getByRole('button', { name: 'Confirmar rechazo' }));

    expect(await screen.findByText('La rendición fue rechazada.')).toBeVisible();
    expect(primerPedidoDeEstado().cuerpo).toEqual({ estado: 'RECHAZADA', motivo: MOTIVO });
    expect(estadoMostrado()).toHaveTextContent('Rechazada');
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('si el servidor rechaza el motivo, muestra su mensaje en el diálogo y conserva lo escrito', async () => {
    servir({
      inicial: { estado: 'ENVIADA' },
      respuestaDelPatch: () =>
        errorJson(400, 'VALIDATION_ERROR', [
          { campo: 'motivo', mensaje: 'El motivo no puede superar los 500 caracteres.' },
        ]),
    });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialogo = within(await dialogoDeRechazo());
    await user.type(dialogo.getByRole('textbox', { name: 'Motivo del rechazo' }), MOTIVO);

    await user.click(dialogo.getByRole('button', { name: 'Confirmar rechazo' }));

    expect(
      await dialogo.findByText('El motivo no puede superar los 500 caracteres.'),
    ).toBeVisible();
    expect(dialogo.getByRole('textbox', { name: 'Motivo del rechazo' })).toHaveValue(MOTIVO);
    expect(dialogo.getByRole('button', { name: 'Confirmar rechazo' })).toBeEnabled();
  });

  it('el rechazo no se manda dos veces si se toca dos veces', async () => {
    let soltar: (respuesta: Response) => void = () => undefined;
    servir({
      inicial: { estado: 'ENVIADA' },
      respuestaDelPatch: () =>
        new Promise<Response>((resolver) => {
          soltar = resolver;
        }),
    });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));
    const dialogo = within(await dialogoDeRechazo());
    await user.type(dialogo.getByRole('textbox', { name: 'Motivo del rechazo' }), MOTIVO);
    const confirmar = dialogo.getByRole('button', { name: 'Confirmar rechazo' });

    await user.click(confirmar);
    await user.click(confirmar);

    expect(pedidosDeEstado()).toHaveLength(1);
    soltar(json({ ...rendicionJson({ estado: 'RECHAZADA' }), items: ITEMS }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('al reabrir el diálogo de rechazo, el campo vuelve vacío', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    const { user } = renderDetalle();
    await esperarDetalle();
    await user.click(screen.getByRole('button', { name: 'Rechazar' }));
    const primero = within(await dialogoDeRechazo());
    await user.type(primero.getByRole('textbox', { name: 'Motivo del rechazo' }), MOTIVO);
    await user.click(primero.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Rechazar' }));

    const segundo = within(await dialogoDeRechazo());
    expect(segundo.getByRole('textbox', { name: 'Motivo del rechazo' })).toHaveValue('');
  });
});

describe('RendicionDetallePage: una Aprobada no se modifica (HU3.8)', () => {
  it('explica con un motivo verdadero por qué las acciones están deshabilitadas', async () => {
    servir({ inicial: { estado: 'APROBADA' } });
    renderDetalle();
    await esperarDetalle();

    const motivo =
      'La rendición ya fue aprobada: no se pueden cambiar sus documentos ni sus canales.';
    expect(screen.getByText(motivo)).toBeVisible();
    expect(screen.queryByText(/ya fue enviada/)).not.toBeInTheDocument();
    for (const boton of [
      screen.getByRole('button', { name: /Cambiar el canal de/ }),
      screen.getByRole('button', { name: /Reemplazar documento de/ }),
    ]) {
      expect(boton).toBeDisabled();
      expect(boton).toHaveAccessibleDescription(motivo);
    }
    // La OC sigue editable: es un dato administrativo.
    expect(screen.getByRole('button', { name: 'Editar OC' })).toBeEnabled();
  });

  it('no felicita por el checklist completo: ya no se puede tocar', async () => {
    servir({ inicial: { estado: 'APROBADA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByText(/Checklist completo/)).not.toBeInTheDocument();
  });

  it('una Enviada sigue diciendo que ya fue enviada', async () => {
    servir({ inicial: { estado: 'ENVIADA' } });
    renderDetalle();
    await esperarDetalle();

    expect(
      screen.getByText(
        'La rendición ya fue enviada: no se pueden cambiar sus documentos ni sus canales.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/ya fue aprobada/)).not.toBeInTheDocument();
  });

  it('una Rechazada no queda bloqueada: se puede corregir (HU3.9)', async () => {
    servir({ inicial: { estado: 'RECHAZADA' } });
    renderDetalle();
    await esperarDetalle();

    expect(screen.queryByText(/ya fue (aprobada|enviada)/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cambiar el canal de/ })).toBeEnabled();
  });
});
