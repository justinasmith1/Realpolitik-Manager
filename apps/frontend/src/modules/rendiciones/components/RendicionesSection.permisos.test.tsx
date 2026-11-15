// Las rendiciones de un cliente (en su matriz) según el rol (HU4.3). CONSULTA las lista, filtra y
// abre su detalle, sin "Abrir rendición", sin "Anular" (ni su diálogo) y sin el aviso de cliente
// inactivo, que no es su motivo. ADMINISTRATIVO y ADMINISTRADOR conservan todo.

import {
  ETIQUETAS_ESTADO_RENDICION,
  type ClienteEstadoType,
  type RolUsuarioType,
} from '@realpolitik/shared';
import { screen, within } from '@testing-library/react';

import { RendicionesSection } from '@/modules/rendiciones/components/RendicionesSection';
import { rutaDeRendicion } from '@/modules/rendiciones/rendiciones.rutas';
import { renderEnMatriz } from '@/modules/rendiciones/test/renderConRouter';
import {
  CLIENTE_ID,
  HOY,
  json,
  OTRA_ID,
  RENDICION_ID,
  resumenJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';
import { elegirOpcion } from '@/test/select';

const fetchMock = vi.fn<typeof fetch>();

const ACTIVA = resumenJson({ cobro: { fecha: '2026-11-10', nota: null } });
const ANULADA = resumenJson({
  id: OTRA_ID,
  mes: 9,
  numeroFactura: 'A 00001-00000002',
  vigencia: 'ANULADA',
  anuladaEn: '2026-10-20T15:00:00.000Z',
});

const AVISO_INACTIVO = 'El cliente no está activo: no se pueden abrir rendiciones nuevas.';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  // El listado según la vigencia pedida; nada más (ninguna escritura).
  fetchMock.mockImplementation((entrada, init) => {
    if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json({}, 500));
    const vigencia = new URL(urlDe(entrada)).searchParams.get('vigencia') ?? 'ACTIVA';
    return Promise.resolve(
      json(
        vigencia === 'ANULADA' ? [ANULADA] : vigencia === 'TODAS' ? [ACTIVA, ANULADA] : [ACTIVA],
      ),
    );
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderSeccion(rol: RolUsuarioType, estado: ClienteEstadoType = 'ACTIVO') {
  return renderEnMatriz(
    <RendicionesSection
      cliente={{ id: CLIENTE_ID, denominacion: 'Muni Ejemplo', estado, emisor: 'SOCIEDAD' }}
      onAviso={vi.fn()}
    />,
    `/clientes/${CLIENTE_ID}/matriz`,
    rol,
  );
}

const tarjeta = async (periodo: string) =>
  within((await screen.findByRole('link', { name: periodo })).closest('article') as HTMLElement);

describe('RendicionesSection con CONSULTA', () => {
  it.each(['ACTIVO', 'INACTIVO'] as const)(
    'con el cliente %s lista las rendiciones sin abrir, anular ni avisar del estado',
    async (estado) => {
      renderSeccion('CONSULTA', estado);
      const octubre = await tarjeta('Octubre 2026');

      expect(octubre.getByText('A 00001-00000001')).toBeInTheDocument();
      expect(octubre.getByText(/Cobrada/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Abrir rendición/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Anular/ })).not.toBeInTheDocument();
      expect(screen.queryByText(AVISO_INACTIVO)).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    },
  );

  it('filtra por vigencia y estado, y consulta las anuladas', async () => {
    const { user, router } = renderSeccion('CONSULTA');
    await tarjeta('Octubre 2026');

    await elegirOpcion(user, screen.getByLabelText('Vigencia'), 'Anuladas');
    const septiembre = await tarjeta('Septiembre 2026');
    expect(septiembre.getByText('Anulada')).toBeInTheDocument();
    expect(router.state.location.search).toContain('vigencia=ANULADA');

    await user.click(
      screen.getByRole('button', { name: ETIQUETAS_ESTADO_RENDICION.EN_CURSO, pressed: false }),
    );
    expect(router.state.location.search).toContain('estado=EN_CURSO');
  });

  it('cada tarjeta lleva al detalle', async () => {
    const { user, router } = renderSeccion('CONSULTA');

    await user.click(await screen.findByRole('link', { name: 'Octubre 2026' }));

    expect(router.state.location.pathname).toBe(rutaDeRendicion(CLIENTE_ID, RENDICION_ID));
  });

  it('solo pide lecturas', async () => {
    renderSeccion('CONSULTA');
    await tarjeta('Octubre 2026');

    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});

describe.each(['ADMINISTRATIVO', 'ADMINISTRADOR'] as const)('RendicionesSection con %s', (rol) => {
  it('con el cliente activo abre rendiciones y anula, con confirmación', async () => {
    const { user } = renderSeccion(rol);
    const octubre = await tarjeta('Octubre 2026');

    expect(screen.getByRole('button', { name: /Abrir rendición/ })).toBeInTheDocument();
    await user.click(octubre.getByRole('button', { name: /^Anular la rendición de Octubre 2026/ }));

    expect(
      await screen.findByRole('alertdialog', { name: '¿Anular la rendición de Octubre 2026?' }),
    ).toBeInTheDocument();
  });

  it('con el cliente inactivo explica por qué no se abren rendiciones', async () => {
    renderSeccion(rol, 'INACTIVO');
    await tarjeta('Octubre 2026');

    expect(screen.getByText(AVISO_INACTIVO)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Abrir rendición/ })).not.toBeInTheDocument();
  });
});
