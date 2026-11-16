import type { EstadoRendicionType, RolUsuarioType } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { sembrarSesion } from '@/modules/auth/test/sesionDePrueba';
import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import {
  CLIENTE_ID,
  itemJson,
  itemReunidoJson,
  json,
  RENDICION_ID,
  rendicionJson,
  urlDe,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

// Una rendición que ya salió hacia el organismo (Enviada, Aprobada o Rechazada) no se arma ni se
// envía: el checklist pasa a ser el registro de lo que se mandó. Se titula "Documentos enviados" y
// no ofrece elegir ítems, filtrar faltantes, enviar ni cambiar canales o documentos; lo que se
// consulta (el archivo, su descarga, el historial, el estado del ítem y el canal) se queda.
// Al reabrir una Rechazada con "Corregir" vuelve el checklist normal.

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

/** Un reunido con su documento y un pendiente: el checklist completo que se mira. */
const REUNIDO = itemReunidoJson({ id: 'f1a2b3c4-d5e6-4789-8abc-def012345670' });
const PENDIENTE = itemJson({
  id: 'f1a2b3c4-d5e6-4789-8abc-def012345671',
  nombreTipoDocumento: 'Print',
  canalEntrega: 'PORTAL_WEB',
});

const HISTORIAL_ENVIADA = [
  { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: '2026-10-02T12:00:00.000Z' },
  { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-10-19T12:00:00.000Z' },
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'ENVIADA',
    fecha: '2026-10-20T12:00:00.000Z',
    fechaEfectiva: '2026-10-20',
  },
];
const HISTORIAL_RECHAZADA = [
  ...HISTORIAL_ENVIADA,
  {
    estadoAnterior: 'ENVIADA',
    estadoNuevo: 'RECHAZADA',
    fecha: '2026-11-05T15:00:00.000Z',
    motivo: 'Falta la firma del intendente',
  },
];

/** El historial que corresponde a cada estado, para que el detalle muestre su último paso. */
const HISTORIAL: Record<string, unknown[]> = {
  EN_CURSO: [HISTORIAL_ENVIADA[0]],
  COMPLETA: HISTORIAL_ENVIADA.slice(0, 2),
  ENVIADA: HISTORIAL_ENVIADA,
  APROBADA: [
    ...HISTORIAL_ENVIADA,
    { estadoAnterior: 'ENVIADA', estadoNuevo: 'APROBADA', fecha: '2026-11-02T12:00:00.000Z' },
  ],
  RECHAZADA: HISTORIAL_RECHAZADA,
};

const esPedidoDeEstado = (entrada: Parameters<typeof fetch>[0], init?: RequestInit) =>
  urlDe(entrada).endsWith(`/rendiciones/${RENDICION_ID}/estado`) && init?.method === 'PATCH';

/** El detalle en un estado, con los dos ítems. El PATCH de estado devuelve la rendición nueva. */
function servir(inicial: Record<string, unknown>, items: unknown[] = [REUNIDO, PENDIENTE]) {
  let actual: Record<string, unknown> = { ...rendicionJson(inicial), items };

  fetchMock.mockImplementation((entrada, init) => {
    const url = urlDe(entrada);
    if (url.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (esPedidoDeEstado(entrada, init)) {
      const { estado } = JSON.parse(init?.body as string) as { estado: string };
      actual = {
        ...actual,
        estado,
        historial: [
          ...(actual.historial as unknown[]),
          { estadoAnterior: actual.estado, estadoNuevo: estado, fecha: new Date().toISOString() },
        ],
      };
      return Promise.resolve(json(actual));
    }
    if (url.includes('/rendiciones/')) return Promise.resolve(json(actual));
    return Promise.resolve(json(clienteJson));
  });
}

/** El detalle en ese estado, con el historial que le corresponde. */
const enEstado = (estado: string, extra: Record<string, unknown> = {}) =>
  servir({ estado, historial: HISTORIAL[estado], ...extra });

function renderDetalle(rol: RolUsuarioType = 'ADMINISTRATIVO') {
  const router = createMemoryRouter(
    [{ path: '/clientes/:id/rendiciones/:rendicionId', element: <RendicionDetallePage /> }],
    { initialEntries: [`/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`] },
  );
  render(
    <QueryClientProvider
      client={sembrarSesion(new QueryClient({ defaultOptions: { queries: { retry: false } } }), {
        rol,
      })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const esperarDetalle = () =>
  screen.findByRole('heading', { level: 1, name: 'Rendición Octubre 2026' });

/** La sección del checklist, por su título (cambia de texto según el estado). */
const seccion = (titulo: string) => screen.getByRole('region', { name: titulo });

/** Los controles de armado y envío, que el modo solo lectura no ofrece. */
const filtroDeFaltantes = () => screen.queryByRole('checkbox', { name: /Ver solo faltantes/ });
const botonEnviar = () => screen.queryByRole('button', { name: /^Enviar \(/ });
const casillasDeItem = () =>
  screen.queryAllByRole('checkbox').filter((casilla) => casilla !== filtroDeFaltantes());

const CERRADOS: EstadoRendicionType[] = ['ENVIADA', 'APROBADA', 'RECHAZADA'];
const ABIERTOS: EstadoRendicionType[] = ['EN_CURSO', 'COMPLETA'];

describe('RendicionDetallePage: el checklist de una rendición ya enviada es de solo lectura', () => {
  it.each(CERRADOS)(
    'una %s se titula "Documentos enviados" y no ofrece armarla ni enviarla',
    async (estado) => {
      enEstado(estado);
      renderDetalle();
      await esperarDetalle();

      expect(seccion('Documentos enviados')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Checklist' })).not.toBeInTheDocument();
      expect(filtroDeFaltantes()).not.toBeInTheDocument();
      expect(botonEnviar()).not.toBeInTheDocument();
      expect(casillasDeItem()).toEqual([]);
      expect(
        screen.queryByRole('button', { name: /^Cambiar el canal de/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Reemplazar documento de/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Asociar documento existente/ }),
      ).not.toBeInTheDocument();
    },
  );

  it.each(CERRADOS)(
    'una %s conserva lo que se consulta: el documento, su descarga, el historial, el estado y el canal',
    async (estado) => {
      enEstado(estado);
      renderDetalle();
      await esperarDetalle();

      const documentos = within(seccion('Documentos enviados'));
      expect(documentos.getByText('factura.pdf')).toBeInTheDocument();
      expect(documentos.getByRole('button', { name: 'Descargar factura.pdf' })).toBeEnabled();
      expect(documentos.getByRole('button', { name: 'Ver historial de Factura' })).toBeEnabled();
      expect(documentos.getByText('Reunido')).toBeInTheDocument();
      expect(documentos.getByText('Correo')).toBeInTheDocument();
      // El nombre del ítem ya no es la etiqueta de una casilla, pero se sigue leyendo.
      expect(documentos.getByText('Factura')).toBeInTheDocument();
    },
  );

  it.each(ABIERTOS)('una %s mantiene el checklist como hasta ahora', async (estado) => {
    enEstado(estado);
    renderDetalle();
    await esperarDetalle();

    expect(seccion('Checklist')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Documentos enviados' })).not.toBeInTheDocument();
    expect(filtroDeFaltantes()).toBeInTheDocument();
    expect(botonEnviar()).toBeInTheDocument();
    expect(casillasDeItem()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Cambiar el canal de Factura' })).toBeEnabled();
  });

  it('al reabrir una Rechazada con "Corregir" vuelve el checklist normal', async () => {
    enEstado('RECHAZADA');
    const { user } = renderDetalle();
    await esperarDetalle();
    expect(seccion('Documentos enviados')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Corregir' }));

    expect(await screen.findByRole('region', { name: 'Checklist' })).toBeInTheDocument();
    expect(filtroDeFaltantes()).toBeInTheDocument();
    expect(botonEnviar()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar el canal de Factura' })).toBeEnabled();
  });

  it('el filtro de faltantes no deja la lista recortada al pasar a Enviada', async () => {
    enEstado('COMPLETA', { historial: HISTORIAL.COMPLETA });
    const { user } = renderDetalle();
    await esperarDetalle();

    await user.click(screen.getByRole('checkbox', { name: /Ver solo faltantes/ }));
    expect(screen.queryByText('factura.pdf')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Marcar como enviada' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }),
    );

    // Sin la casilla para desmarcarlo, el filtro no puede dejar ítems escondidos.
    const documentos = within(await screen.findByRole('region', { name: 'Documentos enviados' }));
    expect(documentos.getByText('Factura')).toBeInTheDocument();
    expect(documentos.getByText('Print')).toBeInTheDocument();
    expect(documentos.getByText('factura.pdf')).toBeInTheDocument();
  });

  it('una anulada que nunca se envió conserva el checklist (la vigencia no decide el modo)', async () => {
    enEstado('EN_CURSO', { vigencia: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' });
    renderDetalle();
    await esperarDetalle();

    expect(seccion('Checklist')).toBeInTheDocument();
    expect(filtroDeFaltantes()).toBeInTheDocument();
    // Una anulada nunca ofrece elegir ni enviar, como hasta ahora.
    expect(botonEnviar()).not.toBeInTheDocument();
    expect(casillasDeItem()).toEqual([]);
  });

  it('con CONSULTA, una Enviada se ve igual que para quien opera', async () => {
    enEstado('ENVIADA');
    renderDetalle('CONSULTA');
    await esperarDetalle();

    const documentos = within(seccion('Documentos enviados'));
    expect(filtroDeFaltantes()).not.toBeInTheDocument();
    expect(botonEnviar()).not.toBeInTheDocument();
    expect(casillasDeItem()).toEqual([]);
    expect(documentos.getByRole('button', { name: 'Descargar factura.pdf' })).toBeEnabled();
    expect(documentos.getByRole('button', { name: 'Ver historial de Factura' })).toBeEnabled();
  });
});
