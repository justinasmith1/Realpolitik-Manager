import { screen, waitFor, within } from '@testing-library/react';

import { RendicionesSection } from '@/modules/rendiciones/components/RendicionesSection';
import { renderEnMatriz } from '@/modules/rendiciones/test/renderConRouter';
import {
  CLIENTE_ID,
  HOY,
  json,
  OTRA_ID,
  resumenJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Estado de cada rendición en el listado (HU3.1): un badge por tarjeta y chips de filtro por
// estado, sincronizados con la URL (`?estado=`) como los demás filtros.

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();
const MATRIZ = `/clientes/${CLIENTE_ID}/matriz`;

const EN_CURSO = resumenJson();
const ENVIADA = resumenJson({
  id: OTRA_ID,
  mes: 9,
  numeroFactura: 'A 00001-00000002',
  estado: 'ENVIADA',
});

/** El listado responde según el `?estado=` del pedido, como el backend. */
function servir(rendiciones = [EN_CURSO, ENVIADA]) {
  fetchMock.mockImplementation((entrada) => {
    const estado = new URL(urlDe(entrada)).searchParams.get('estado');
    return Promise.resolve(json(rendiciones.filter((r) => estado === null || r.estado === estado)));
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

function renderSeccion(entrada = MATRIZ) {
  return renderEnMatriz(
    <RendicionesSection
      cliente={{
        id: CLIENTE_ID,
        denominacion: 'Muni Ejemplo',
        estado: 'ACTIVO',
        emisor: 'SOCIEDAD',
      }}
      onAviso={vi.fn()}
    />,
    entrada,
  );
}

const chips = () => within(screen.getByRole('group', { name: 'Estado' }));
const ultimoPedido = () => new URL(urlDe(fetchMock.mock.calls.at(-1)?.[0] as string));
const tarjeta = (factura: string) => screen.getByText(factura).closest('article') as HTMLElement;

describe('RendicionesSection: estado de cada rendición (HU3.1)', () => {
  it('cada tarjeta muestra su estado con un badge', async () => {
    servir();
    renderSeccion();

    await screen.findByText('A 00001-00000001');
    expect(within(tarjeta('A 00001-00000001')).getByText('En curso')).toBeInTheDocument();
    expect(within(tarjeta('A 00001-00000002')).getByText('Enviada')).toBeInTheDocument();
  });

  it('ofrece "Todas" y los cinco estados, con "Todas" elegido sin filtro', async () => {
    servir();
    renderSeccion();
    await screen.findByText('A 00001-00000001');

    expect(
      chips()
        .getAllByRole('button')
        .map((boton) => boton.textContent),
    ).toEqual(['Todas', 'En curso', 'Completa', 'Enviada', 'Aprobada', 'Rechazada']);
    expect(chips().getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    expect(ultimoPedido().searchParams.has('estado')).toBe(false);
  });

  it('elegir un estado lo guarda en la URL, lo pide al backend y lista solo esas', async () => {
    servir();
    const { user, router } = renderSeccion();
    await screen.findByText('A 00001-00000001');

    await user.click(chips().getByRole('button', { name: 'Enviada' }));

    await waitFor(() => expect(router.state.location.search).toBe('?estado=ENVIADA'));
    await waitFor(() => expect(ultimoPedido().searchParams.get('estado')).toBe('ENVIADA'));
    await waitFor(() => expect(screen.queryByText('A 00001-00000001')).not.toBeInTheDocument());
    expect(screen.getByText('A 00001-00000002')).toBeInTheDocument();
    expect(chips().getByRole('button', { name: 'Enviada' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // "Todas" quita el filtro de la URL.
    await user.click(chips().getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('abrir la URL con ?estado= muestra ese filtro elegido, y se combina con la vigencia', async () => {
    servir();
    const { router } = renderSeccion(`${MATRIZ}?vigencia=TODAS&estado=ENVIADA`);

    expect(await screen.findByText('A 00001-00000002')).toBeInTheDocument();
    expect(chips().getByRole('button', { name: 'Enviada' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(ultimoPedido().searchParams.get('vigencia')).toBe('TODAS');
    expect(router.state.location.search).toBe('?vigencia=TODAS&estado=ENVIADA');
  });

  it.each(['?estado=enviada', '?estado=ATRASADA', '?estado=ENVIADA&estado=COMPLETA'])(
    'un estado inválido en la URL (%s) se quita y se listan todas',
    async (query) => {
      servir();
      const { router } = renderSeccion(`${MATRIZ}${query}`);

      await waitFor(() => expect(router.state.location.search).toBe(''));
      expect(await screen.findByText('A 00001-00000001')).toBeInTheDocument();
    },
  );

  it('si el filtro no devuelve nada, lo avisa y ofrece limpiarlo', async () => {
    servir();
    const { user, router } = renderSeccion(`${MATRIZ}?estado=APROBADA`);

    expect(
      await screen.findByText('No hay rendiciones activas en estado «Aprobada».'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpiar filtro' }));

    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByText('A 00001-00000001')).toBeInTheDocument();
  });
});
