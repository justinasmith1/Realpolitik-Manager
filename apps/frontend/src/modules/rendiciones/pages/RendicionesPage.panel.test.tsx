import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { RendicionesPage } from '@/modules/rendiciones/pages/RendicionesPage';
import {
  CLIENTE_ID,
  errorJson,
  itemJson,
  json,
  OTRA_ID,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Pantalla Rendiciones, HU3.5: tocar una fila abre el resumen de su rendición al costado, de solo
// lectura, con la rendición en la URL.

const fetchMock = vi.fn<typeof fetch>();
// Mediados de noviembre de 2026 en Buenos Aires: las de septiembre o antes, sin enviar, están
// atrasadas.
const HOY = new Date('2026-11-15T12:00:00-03:00');

const fila = (id: string, denominacion: string, extra: Record<string, unknown> = {}) => ({
  id,
  clienteId: CLIENTE_ID,
  cliente: { denominacion, sector: 'PUBLICO', subtipo: 'MUNICIPAL' },
  numeroFactura: 'B 00002-00001482',
  estado: 'EN_CURSO',
  avance: { reunidos: 2, total: 3, faltantes: 1 },
  ultimoPaso: null,
  atrasada: false,
  cobro: null,
  ...extra,
});

const LA_PLATA = fila(RENDICION_ID, 'Muni La Plata');
const ZETA = fila(OTRA_ID, 'Zeta', {
  cliente: { denominacion: 'Zeta', sector: 'PRIVADO', subtipo: null },
  numeroFactura: 'A 00001-00000009',
});

/** El detalle de La Plata: tres documentos, dos reunidos (uno de ellos, el 2 de 2 de un print). */
const detalle = (extra: Record<string, unknown> = {}) =>
  rendicionJson({
    anio: 2026,
    mes: 11,
    numeroFactura: 'B 00002-00001482',
    items: [
      itemJson({ id: 'f1a2b3c4-d5e6-4789-8abc-000000000001', completado: true }),
      itemJson({
        id: 'f1a2b3c4-d5e6-4789-8abc-000000000002',
        nombreTipoDocumento: 'Print',
        ordinal: 1,
        totalOrdinal: 2,
      }),
      itemJson({
        id: 'f1a2b3c4-d5e6-4789-8abc-000000000003',
        nombreTipoDocumento: 'Print',
        ordinal: 2,
        totalOrdinal: 2,
        completado: true,
      }),
    ],
    ...extra,
  });

/**
 * El backend simulado: el listado de cada mes (por `anio-mes`), ninguna atrasada en su listado, y
 * el detalle de cada rendición por id (un número es un error con ese status).
 */
function servir(porMes: Record<string, object[]>, detalles: Record<string, object | number> = {}) {
  fetchMock.mockImplementation((entrada) => {
    const url = new URL(urlDe(entrada));
    if (url.pathname === '/rendiciones/atrasadas') return Promise.resolve(json([]));
    const id = /^\/rendiciones\/([^/]+)$/.exec(url.pathname)?.[1];
    if (id !== undefined) {
      const cuerpo = detalles[id] ?? 404;
      return Promise.resolve(
        typeof cuerpo === 'number' ? errorJson(cuerpo, 'ERROR') : json(cuerpo),
      );
    }
    const clave = `${url.searchParams.get('anio')}-${url.searchParams.get('mes')}`;
    return Promise.resolve(json(porMes[clave] ?? []));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderPantalla(url = '/rendiciones') {
  const router = createMemoryRouter(
    [
      { path: '/rendiciones', element: <RendicionesPage /> },
      { path: '/clientes/:clienteId/rendiciones/:rendicionId', element: <h1>Detalle</h1> },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const filaDe = (nombre: RegExp) => screen.findByRole('link', { name: nombre });
const panel = (cliente = 'Muni La Plata') =>
  screen.findByRole('region', { name: `Resumen de la rendición de ${cliente}` });
const parametros = (router: ReturnType<typeof renderPantalla>['router']) =>
  Object.fromEntries(new URLSearchParams(router.state.location.search));

describe('RendicionesPage, panel de resumen (HU3.5)', () => {
  it('sin una rendición en la URL, el panel no se renderiza ni se pide ningún detalle', async () => {
    servir({ '2026-11': [LA_PLATA, ZETA] }, { [RENDICION_ID]: detalle() });
    renderPantalla();

    await filaDe(/Muni La Plata/);
    expect(screen.queryByRole('region', { name: /Resumen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ir a la rendición' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link', { current: true })).toHaveLength(0);
    const detalles = fetchMock.mock.calls.filter(([entrada]) =>
      new URL(urlDe(entrada)).pathname.startsWith(`/rendiciones/${RENDICION_ID}`),
    );
    expect(detalles).toHaveLength(0);
  });

  it('tocar una fila abre el panel, la marca, guarda la rendición en la URL y lleva el foco', async () => {
    servir({ '2026-11': [LA_PLATA, ZETA] }, { [RENDICION_ID]: detalle() });
    const { router, user } = renderPantalla('/rendiciones?tipo=MUNICIPAL');

    await user.click(await filaDe(/Muni La Plata/));

    const region = await panel();
    expect(region).toHaveFocus();
    expect(parametros(router)).toEqual({ tipo: 'MUNICIPAL', rendicion: RENDICION_ID });
    expect(screen.getByRole('link', { name: /Muni La Plata/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // No navegó al detalle: el listado sigue a la vista.
    expect(router.state.location.pathname).toBe('/rendiciones');
    expect(screen.getByRole('list', { name: 'Rendiciones de Noviembre 2026' })).toBeInTheDocument();
  });

  it('muestra la cabecera, el estado, el período y los documentos reunidos y pendientes', async () => {
    servir({ '2026-11': [LA_PLATA] }, { [RENDICION_ID]: detalle() });
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    expect(within(region).getByRole('heading', { name: 'Muni La Plata' })).toBeInTheDocument();
    expect(within(region).getByText('Municipio')).toBeInTheDocument();
    expect(within(region).getByText('Factura B 00002-00001482')).toHaveClass('font-mono');
    expect(await within(region).findByText('En curso')).toHaveAttribute('data-slot', 'badge');
    expect(within(region).getByText('Noviembre 2026')).toBeInTheDocument();
    expect(within(region).getByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
    expect(within(region).getByText('2 de 3 reunidos')).toBeInTheDocument();

    const documentos = within(within(region).getByRole('list', { name: 'Documentos' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(documentos).toEqual(['FacturaReunido', 'Print 1 de 2Pendiente', 'Print 2 de 2Reunido']);
    // Ni "Atrasada" ni fecha: está en curso y es de este mes.
    expect(within(region).queryByText('Atrasada')).not.toBeInTheDocument();
  });

  it('una enviada muestra la fecha de su último paso, como la fila', async () => {
    const enviada = { ...LA_PLATA, estado: 'ENVIADA' };
    servir(
      { '2026-11': [enviada] },
      {
        [RENDICION_ID]: detalle({
          estado: 'ENVIADA',
          historial: [
            { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-11-02T13:00:00.000Z' },
            {
              estadoAnterior: 'EN_CURSO',
              estadoNuevo: 'ENVIADA',
              fecha: '2026-11-08T13:00:00.000Z',
            },
          ],
        }),
      },
    );
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    expect(await within(region).findByText('Enviada 08/11')).toBeInTheDocument();
  });

  describe('el motivo del rechazo pendiente (HU3.9)', () => {
    const HASTA_EL_RECHAZO = [
      { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-11-02T13:00:00.000Z' },
      { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-11-03T13:00:00.000Z' },
      {
        estadoAnterior: 'COMPLETA',
        estadoNuevo: 'ENVIADA',
        fecha: '2026-11-04T13:00:00.000Z',
        fechaEfectiva: '2026-11-04',
      },
      {
        estadoAnterior: 'ENVIADA',
        estadoNuevo: 'RECHAZADA',
        fecha: '2026-11-09T13:00:00.000Z',
        motivo: 'Falta el sello',
      },
    ];
    const REABIERTA = {
      estadoAnterior: 'RECHAZADA',
      estadoNuevo: 'EN_CURSO',
      fecha: '2026-11-10T13:00:00.000Z',
    };

    it.each([
      ['Rechazada', 'RECHAZADA', HASTA_EL_RECHAZO],
      ['En curso que se está corrigiendo', 'EN_CURSO', [...HASTA_EL_RECHAZO, REABIERTA]],
    ])('una %s muestra el motivo destacado con su fecha', async (_nombre, estado, historial) => {
      servir(
        { '2026-11': [{ ...LA_PLATA, estado }] },
        { [RENDICION_ID]: detalle({ estado, historial }) },
      );
      renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

      const region = await panel();
      expect(
        await within(region).findByText('Rechazada el 09/11/2026: Falta el sello'),
      ).toBeVisible();
    });

    it('una reenviada ya no lo muestra', async () => {
      servir(
        { '2026-11': [{ ...LA_PLATA, estado: 'ENVIADA' }] },
        {
          [RENDICION_ID]: detalle({
            estado: 'ENVIADA',
            historial: [
              ...HASTA_EL_RECHAZO,
              REABIERTA,
              {
                estadoAnterior: 'EN_CURSO',
                estadoNuevo: 'COMPLETA',
                fecha: '2026-11-11T13:00:00.000Z',
              },
              {
                estadoAnterior: 'COMPLETA',
                estadoNuevo: 'ENVIADA',
                fecha: '2026-11-12T13:00:00.000Z',
                fechaEfectiva: '2026-11-12',
              },
            ],
          }),
        },
      );
      renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

      const region = await panel();
      expect(await within(region).findByText('Enviada 12/11')).toBeInTheDocument();
      expect(within(region).queryByText(/Rechazada el/)).not.toBeInTheDocument();
    });
  });

  it('una rendición atrasada muestra la marca "Atrasada" en rojo', async () => {
    servir(
      { '2026-9': [{ ...LA_PLATA, atrasada: true }] },
      { [RENDICION_ID]: detalle({ mes: 9 }) },
    );
    renderPantalla(`/rendiciones?anio=2026&mes=9&rendicion=${RENDICION_ID}`);

    const region = await panel();
    expect(await within(region).findByText('Atrasada')).toHaveClass('text-atrasada');
    expect(within(region).getByText('Septiembre 2026')).toBeInTheDocument();
  });

  it('"Ir a la rendición" lleva al detalle', async () => {
    servir({ '2026-11': [LA_PLATA] }, { [RENDICION_ID]: detalle() });
    const { router, user } = renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    await user.click(within(await panel()).getByRole('link', { name: 'Ir a la rendición' }));

    expect(router.state.location.pathname).toBe(
      `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
    );
    expect(await screen.findByRole('heading', { name: 'Detalle' })).toBeInTheDocument();
  });

  it('no tiene botones de acción: solo cerrar e "Ir a la rendición"', async () => {
    servir({ '2026-11': [LA_PLATA] }, { [RENDICION_ID]: detalle() });
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    await within(region).findByText('2 de 3 reunidos');
    expect(
      within(region)
        .getAllByRole('button')
        .map((boton) => boton.textContent),
    ).toEqual(['']);
    expect(within(region).getByRole('button')).toHaveAccessibleName('Cerrar el resumen');
    expect(
      within(region)
        .getAllByRole('link')
        .map((enlace) => enlace.textContent),
    ).toEqual(['Ir a la rendición']);
  });

  it.each([
    [
      'la X',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole('button', { name: 'Cerrar el resumen' }));
      },
    ],
    [
      'Escape',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.keyboard('{Escape}');
      },
    ],
  ])(
    'cerrar con %s quita la rendición de la URL, mantiene el mes y los filtros, y vuelve a la fila',
    async (_forma, cerrar) => {
      servir({ '2026-10': [LA_PLATA, ZETA] }, { [RENDICION_ID]: detalle({ mes: 10 }) });
      const { router, user } = renderPantalla('/rendiciones?anio=2026&mes=10&tipo=MUNICIPAL');

      await user.click(await filaDe(/Muni La Plata/));
      await panel();
      await cerrar(user);

      await waitFor(() =>
        expect(screen.queryByRole('region', { name: /Resumen/ })).not.toBeInTheDocument(),
      );
      expect(parametros(router)).toEqual({ anio: '2026', mes: '10', tipo: 'MUNICIPAL' });
      expect(screen.getByRole('link', { name: /Muni La Plata/ })).toHaveFocus();
      expect(screen.getByRole('link', { name: /Muni La Plata/ })).not.toHaveAttribute(
        'aria-current',
      );
    },
  );

  it('recargar con la rendición en la URL abre su panel', async () => {
    servir({ '2026-11': [LA_PLATA, ZETA] }, { [OTRA_ID]: detalle({ id: OTRA_ID }) });
    renderPantalla(`/rendiciones?rendicion=${OTRA_ID}`);

    expect(await panel('Zeta')).toHaveFocus();
  });

  it.each([
    ['un valor que no es un id', 'abc'],
    ['un id que no está en el listado', 'e1f2a3b4-c5d6-4789-8abc-000000000777'],
  ])('%s se quita de la URL y el panel no se abre', async (_caso, valor) => {
    servir({ '2026-10': [LA_PLATA] }, { [RENDICION_ID]: detalle() });
    const { router } = renderPantalla(`/rendiciones?anio=2026&mes=10&rendicion=${valor}`);

    await filaDe(/Muni La Plata/);
    await waitFor(() => expect(parametros(router)).toEqual({ anio: '2026', mes: '10' }));
    expect(screen.queryByRole('region', { name: /Resumen/ })).not.toBeInTheDocument();
  });

  it('si la rendición ya no existe (404), se quita de la URL', async () => {
    servir({ '2026-11': [LA_PLATA] }, { [RENDICION_ID]: 404 });
    const { router } = renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    await panel();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    // El router cambia la URL antes de que React vuelva a dibujar la pantalla: el panel se va en el
    // render siguiente, así que se espera su ausencia en vez de afirmarla en el mismo instante.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /Resumen/ })).not.toBeInTheDocument(),
    );
  });

  it('mientras carga muestra un skeleton y, si falla, un aviso con "Reintentar"', async () => {
    servir({ '2026-11': [LA_PLATA] }, { [RENDICION_ID]: 500 });
    const { user } = renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    expect(within(region).getByRole('status')).toHaveTextContent('Cargando la rendición…');
    expect(await within(region).findByText('No pudimos cargar la rendición.')).toBeInTheDocument();

    servir({ '2026-11': [LA_PLATA] }, { [RENDICION_ID]: detalle() });
    await user.click(within(region).getByRole('button', { name: 'Reintentar' }));

    expect(await within(region).findByText('2 de 3 reunidos')).toBeInTheDocument();
  });

  it('si un filtro deja afuera a la rendición abierta, el panel se cierra', async () => {
    servir({ '2026-11': [LA_PLATA, ZETA] }, { [RENDICION_ID]: detalle() });
    const { router, user } = renderPantalla();

    await user.click(await filaDe(/Muni La Plata/));
    await panel();
    await user.type(screen.getByRole('searchbox'), 'Zeta');

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /Resumen/ })).not.toBeInTheDocument(),
    );
    expect(parametros(router)).toEqual({ q: 'Zeta' });
  });

  it('al cambiar de mes, el panel de una rendición que no está en el nuevo mes se cierra', async () => {
    servir({ '2026-11': [LA_PLATA], '2026-10': [ZETA] }, { [RENDICION_ID]: detalle() });
    const { router, user } = renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    await panel();
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));

    await filaDe(/Zeta/);
    await waitFor(() => expect(parametros(router)).toEqual({ anio: '2026', mes: '10' }));
    expect(screen.queryByRole('region', { name: /Resumen/ })).not.toBeInTheDocument();
  });
});

// HU3.10: el resumen es de solo lectura; muestra el cobro informado por el cliente, con su fecha y su
// nota, y no ofrece registrarlo ni cambiarlo (eso se hace desde el detalle).
describe('RendicionesPage, panel de resumen: cobro (HU3.10)', () => {
  const COBRADA = { ...LA_PLATA, estado: 'APROBADA', cobro: { fecha: '2026-11-10' } };

  it('una rendición cobrada muestra "Cobrada el dd/mm/aaaa" y la nota', async () => {
    servir(
      { '2026-11': [COBRADA] },
      {
        [RENDICION_ID]: detalle({
          estado: 'APROBADA',
          cobro: { fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' },
        }),
      },
    );
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    expect(await within(region).findByText('Cobrada el 10/11/2026')).toBeVisible();
    expect(within(region).getByText('Avisó por mail Juan, de Tesorería')).toBeVisible();
  });

  it('el cobro no tiene nota: solo la fecha', async () => {
    servir(
      { '2026-11': [COBRADA] },
      {
        [RENDICION_ID]: detalle({ estado: 'APROBADA', cobro: { fecha: '2026-11-10', nota: null } }),
      },
    );
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    expect(await within(region).findByText('Cobrada el 10/11/2026')).toBeVisible();
  });

  it('una rendición sin cobro no dice nada de cobrada', async () => {
    servir(
      { '2026-11': [{ ...LA_PLATA, estado: 'ENVIADA' }] },
      { [RENDICION_ID]: detalle({ estado: 'ENVIADA' }) },
    );
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    await within(region).findByText('Documentos');
    expect(within(region).queryByText(/Cobrada/)).not.toBeInTheDocument();
  });

  it('es de solo lectura: no ofrece registrar, editar ni quitar el cobro', async () => {
    servir(
      { '2026-11': [COBRADA] },
      {
        [RENDICION_ID]: detalle({ estado: 'APROBADA', cobro: { fecha: '2026-11-10', nota: null } }),
      },
    );
    renderPantalla(`/rendiciones?rendicion=${RENDICION_ID}`);

    const region = await panel();
    await within(region).findByText('Cobrada el 10/11/2026');
    expect(within(region).queryByRole('button', { name: /cobro/i })).not.toBeInTheDocument();
  });
});
