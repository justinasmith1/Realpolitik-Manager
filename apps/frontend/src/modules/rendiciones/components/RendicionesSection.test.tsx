import type { ClienteEstadoType } from '@realpolitik/shared';
import { screen, waitFor } from '@testing-library/react';

import { RendicionesSection } from '@/modules/rendiciones/components/RendicionesSection';
import { renderEnMatriz } from '@/modules/rendiciones/test/renderConRouter';
import {
  CLIENTE_ID,
  errorJson,
  HOY,
  itemJson,
  json,
  OTRA_ID,
  RENDICION_ID,
  rendicionJson,
  resumenJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';
import { elegirOpcion } from '@/test/select';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

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

const MATRIZ = `/clientes/${CLIENTE_ID}/matriz`;

function renderSeccion(estado: ClienteEstadoType = 'ACTIVO', entrada = MATRIZ) {
  const onAviso = vi.fn();
  const resultado = renderEnMatriz(
    <RendicionesSection
      cliente={{ id: CLIENTE_ID, denominacion: 'Muni Ejemplo', estado }}
      onAviso={onAviso}
    />,
    entrada,
  );
  return { ...resultado, onAviso };
}

const DOS_RENDICIONES = [
  resumenJson(),
  resumenJson({
    id: OTRA_ID,
    mes: 9,
    numeroFactura: 'FC-0002',
    resumen: { totalItems: 2, completados: 2 },
  }),
];

/** URL de cada GET del listado. */
const pedidosDelListado = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? 'GET') === 'GET')
    .map(([entrada]) => urlDe(entrada));

describe('RendicionesSection', () => {
  it('mientras carga muestra un esqueleto', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderSeccion();

    expect(await screen.findByTestId('rendiciones-cargando')).toBeInTheDocument();
  });

  it('lista las rendiciones del cliente, con su avance', async () => {
    fetchMock.mockResolvedValue(json(DOS_RENDICIONES));
    renderSeccion();

    expect(await screen.findByRole('article', { name: 'Octubre 2026' })).toHaveTextContent(
      '1 de 4 reunidos',
    );
    expect(screen.getByRole('article', { name: 'Septiembre 2026' })).toHaveTextContent(
      'Checklist completo',
    );
    expect(pedidosDelListado()[0]).toBe(`https://api.example/clientes/${CLIENTE_ID}/rendiciones`);
  });

  it('sin rendiciones lo dice', async () => {
    fetchMock.mockResolvedValue(json([]));
    renderSeccion();

    expect(
      await screen.findByText('No hay rendiciones activas para este cliente.'),
    ).toBeInTheDocument();
  });

  it('si no se pudieron cargar, lo dice y permite reintentar', async () => {
    fetchMock
      .mockResolvedValueOnce(errorJson(500, 'INTERNAL_ERROR'))
      .mockResolvedValueOnce(json(DOS_RENDICIONES));
    const { user } = renderSeccion();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos cargar las rendiciones.',
    );
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('article', { name: 'Octubre 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    'con el cliente %s no ofrece abrir rendiciones, pero sí las muestra',
    async (estado) => {
      fetchMock.mockResolvedValue(json(DOS_RENDICIONES));
      renderSeccion(estado);

      expect(await screen.findByRole('article', { name: 'Octubre 2026' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Abrir rendición' })).not.toBeInTheDocument();
      expect(
        screen.getByText('El cliente no está activo: no se pueden abrir rendiciones nuevas.'),
      ).toBeInTheDocument();
    },
  );

  it('al abrir una rendición navega a su detalle con el aviso', async () => {
    fetchMock.mockImplementation((_entrada, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? json(
              {
                ...rendicionJson({ numeroFactura: 'FC-0009' }),
                items: [itemJson(), itemJson({ id: 'f1a2b3c4-d5e6-4789-8abc-def012345679' })],
              },
              201,
            )
          : json([]),
      ),
    );
    const { user, router } = renderSeccion();
    await screen.findByText('No hay rendiciones activas para este cliente.');

    await user.click(screen.getByRole('button', { name: 'Abrir rendición' }));
    await user.type(screen.getByLabelText('Número de factura'), 'fc-0009');
    await user.click(screen.getByRole('button', { name: 'Abrir rendición' }));

    expect(
      await screen.findByRole('heading', { name: `Detalle ${RENDICION_ID}` }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
    );
    expect(
      screen.getByText('Se abrió la rendición de Octubre 2026 (factura FC-0009) con 2 documentos.'),
    ).toBeInTheDocument();
  });

  it('"Ver rendición" en una factura repetida navega al detalle de la existente', async () => {
    fetchMock.mockImplementation((_entrada, init) =>
      Promise.resolve(
        init?.method === 'POST'
          ? errorJson(409, 'CONFLICT', {
              motivo: 'RENDICION_DUPLICADA',
              rendicionExistente: { id: OTRA_ID, anio: 2026, mes: 9, numeroFactura: 'FC-0002' },
            })
          : json([]),
      ),
    );
    const { user, router } = renderSeccion();
    await screen.findByText('No hay rendiciones activas para este cliente.');

    await user.click(screen.getByRole('button', { name: 'Abrir rendición' }));
    await user.type(screen.getByLabelText('Número de factura'), 'fc-0002');
    await user.click(screen.getByRole('button', { name: 'Abrir rendición' }));
    await user.click(await screen.findByRole('button', { name: 'Ver rendición' }));

    expect(await screen.findByRole('heading', { name: `Detalle ${OTRA_ID}` })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/clientes/${CLIENTE_ID}/rendiciones/${OTRA_ID}`);
  });

  describe('filtros de año y mes', () => {
    it('cambiar año y mes actualiza la URL y el pedido; "Todos" deja la URL limpia', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(json([])));
      const { user, router } = renderSeccion();
      await screen.findByText('No hay rendiciones activas para este cliente.');

      await elegirOpcion(user, screen.getByLabelText('Año'), '2026');
      await waitFor(() => expect(router.state.location.search).toBe('?anio=2026'));
      await elegirOpcion(user, screen.getByLabelText('Mes'), '10');
      await waitFor(() => expect(router.state.location.search).toBe('?anio=2026&mes=10'));
      await waitFor(() =>
        expect(pedidosDelListado().at(-1)).toBe(
          `https://api.example/clientes/${CLIENTE_ID}/rendiciones?anio=2026&mes=10`,
        ),
      );

      await elegirOpcion(user, screen.getByLabelText('Año'), '');
      await elegirOpcion(user, screen.getByLabelText('Mes'), '');
      await waitFor(() => expect(router.state.location.search).toBe(''));
      await waitFor(() =>
        expect(pedidosDelListado().at(-1)).toBe(
          `https://api.example/clientes/${CLIENTE_ID}/rendiciones`,
        ),
      );
    });

    it('abrir con ?anio=2026&mes=10 aplica el filtro', async () => {
      fetchMock.mockResolvedValue(json([]));
      renderSeccion('ACTIVO', `${MATRIZ}?anio=2026&mes=10`);

      expect(await screen.findByText('No hay rendiciones activas en ese período.')).toBeVisible();
      expect(pedidosDelListado()[0]).toBe(
        `https://api.example/clientes/${CLIENTE_ID}/rendiciones?anio=2026&mes=10`,
      );
      expect(screen.getByLabelText('Año')).toHaveTextContent('2026');
      expect(screen.getByLabelText('Mes')).toHaveTextContent('Octubre');
    });

    it('un valor inválido se quita de la URL y no se filtra por él', async () => {
      fetchMock.mockResolvedValue(json([]));
      const { router } = renderSeccion('ACTIVO', `${MATRIZ}?mes=13&otro=1`);

      await waitFor(() => expect(router.state.location.search).toBe('?otro=1'));
      expect(pedidosDelListado().every((url) => !url.includes('mes='))).toBe(true);
    });
  });

  describe('filtro de estado', () => {
    const ANULADA = resumenJson({
      id: OTRA_ID,
      mes: 11,
      numeroFactura: 'FC-0009',
      estado: 'ANULADA',
      anuladaEn: '2026-10-20T15:00:00.000Z',
    });

    it('por defecto lista las activas sin escribir el estado en la URL ni en el pedido', async () => {
      fetchMock.mockResolvedValue(json([]));
      const { router } = renderSeccion();

      expect(
        await screen.findByText('No hay rendiciones activas para este cliente.'),
      ).toBeVisible();
      expect(screen.getByLabelText('Estado')).toHaveTextContent('Activas');
      expect(router.state.location.search).toBe('');
      expect(pedidosDelListado()[0]).toBe(`https://api.example/clientes/${CLIENTE_ID}/rendiciones`);
    });

    it('elegir "Anuladas" las pide y lo guarda en la URL; volver a "Activas" la deja limpia', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(json([])));
      const { user, router } = renderSeccion();
      await screen.findByText('No hay rendiciones activas para este cliente.');

      await elegirOpcion(user, screen.getByLabelText('Estado'), 'Anuladas');

      await waitFor(() => expect(router.state.location.search).toBe('?estado=ANULADA'));
      expect(
        await screen.findByText('No hay rendiciones anuladas para este cliente.'),
      ).toBeVisible();
      expect(pedidosDelListado().at(-1)).toBe(
        `https://api.example/clientes/${CLIENTE_ID}/rendiciones?estado=ANULADA`,
      );

      await elegirOpcion(user, screen.getByLabelText('Estado'), 'Activas');

      await waitFor(() => expect(router.state.location.search).toBe(''));
      await waitFor(() =>
        expect(pedidosDelListado().at(-1)).toBe(
          `https://api.example/clientes/${CLIENTE_ID}/rendiciones`,
        ),
      );
    });

    it.each([
      ['?estado=ANULADA&mes=10', 'No hay rendiciones anuladas en ese período.'],
      ['?estado=TODAS', 'Todavía no hay rendiciones para este cliente.'],
      ['?estado=TODAS&anio=2026', 'No hay rendiciones en ese período.'],
    ])('el vacío tiene sentido según el filtro (%s)', async (query, mensaje) => {
      fetchMock.mockResolvedValue(json([]));
      renderSeccion('ACTIVO', `${MATRIZ}${query}`);

      expect(await screen.findByText(mensaje)).toBeVisible();
    });

    it.each(['?estado=ACTIVA', '?estado=borrada', '?estado=TODAS&estado=ANULADA'])(
      '%s se quita de la URL (valor por defecto o inválido) y lista las activas',
      async (query) => {
        fetchMock.mockResolvedValue(json([]));
        const { router } = renderSeccion('ACTIVO', `${MATRIZ}${query}&otro=1`);

        await waitFor(() => expect(router.state.location.search).toBe('?otro=1'));
        expect(router.state.historyAction).toBe('REPLACE');
        expect(pedidosDelListado().every((url) => !url.includes('estado='))).toBe(true);
      },
    );

    it('con "Todas" muestra las activas primero y la anulada atenuada, sin "Anular" y navegable', async () => {
      // El backend ya las manda en ese orden: la anulada es más reciente, pero va después.
      fetchMock.mockResolvedValue(json([resumenJson(), ANULADA]));
      const { user, router } = renderSeccion('ACTIVO', `${MATRIZ}?estado=TODAS`);

      const tarjetas = await screen.findAllByRole('article');
      expect(tarjetas.map((tarjeta) => tarjeta.getAttribute('data-estado'))).toEqual([
        'activa',
        'anulada',
      ]);
      expect(screen.getByLabelText('Estado')).toHaveTextContent('Todas');
      const anulada = screen.getByRole('article', { name: 'Noviembre 2026' });
      expect(anulada).toHaveTextContent('Anulada');
      expect(
        screen.queryByRole('button', { name: /^Anular la rendición de Noviembre 2026/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^Anular la rendición de Octubre 2026/ }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('link', { name: 'Noviembre 2026' }));
      expect(router.state.location.pathname).toBe(`/clientes/${CLIENTE_ID}/rendiciones/${OTRA_ID}`);
    });
  });
});
