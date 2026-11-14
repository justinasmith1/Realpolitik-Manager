import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClienteDetalleSheet } from '@/modules/clientes/components/ClienteDetalleSheet';

const fetchMock = vi.fn<typeof fetch>();

const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };

/** Cliente público, por portal, bimestral y con emisor. */
const publico = {
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'PORTAL_WEB',
  portalUrl: 'https://portal.ejemplo.example/proveedores',
  emisor: 'SOCIEDAD',
  periodicidad: { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 },
  estado: 'ACTIVO',
  matrizConfigurada: true,
  ...fechas,
};

/** Cliente privado, inactivo, por WhatsApp, sin periodicidad ni emisor. */
const privado = {
  ...publico,
  id: '33333333-3333-4333-a333-333333333333',
  razonSocial: 'Zeta Producciones S.A.',
  denominacion: 'Zeta',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  subtipo: undefined,
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'zeta@ejemplo.example',
  canalEntrega: 'WHATSAPP',
  portalUrl: undefined,
  whatsappNumero: '+5491122334455',
  emisor: undefined,
  periodicidad: null,
  estado: 'INACTIVO',
  matrizConfigurada: false,
};

const comoCliente = (datos: object): Cliente => ClienteSchema.parse(datos);

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const rutaDe = (entrada: Parameters<typeof fetch>[0]) =>
  new URL(
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url,
  ).pathname;

interface Respuestas {
  detalle?: (id: string) => Promise<Response>;
  indicaciones?: () => Promise<Response>;
  observaciones?: () => Promise<Response>;
}

/** Simula `GET /clientes/:id` y sus dos notas. Cada respuesta se puede cambiar por test. */
function simular(respuestas: Respuestas = {}) {
  fetchMock.mockImplementation((entrada) => {
    const ruta = rutaDe(entrada);
    if (ruta.endsWith('/indicaciones-armado')) {
      return respuestas.indicaciones?.() ?? Promise.resolve(json({ indicacionesArmado: null }));
    }
    if (ruta.endsWith('/observaciones')) {
      return respuestas.observaciones?.() ?? Promise.resolve(json({ observaciones: null }));
    }
    const id = ruta.split('/').at(-1) ?? '';
    if (respuestas.detalle) return respuestas.detalle(id);
    const datos = [publico, privado].find((c) => c.id === id);
    return Promise.resolve(datos ? json(datos) : json({}, 404));
  });
}

function renderFicha(cliente: Cliente | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const vista = render(
    <QueryClientProvider client={queryClient}>
      <ClienteDetalleSheet cliente={cliente} onClose={onClose} />
    </QueryClientProvider>,
  );
  const rerender = (otro: Cliente | null) =>
    vista.rerender(
      <QueryClientProvider client={queryClient}>
        <ClienteDetalleSheet cliente={otro} onClose={onClose} />
      </QueryClientProvider>,
    );
  return { onClose, rerender, user: userEvent.setup() };
}

const ficha = async (razonSocial: string) =>
  within(await screen.findByRole('dialog', { name: `Ficha de ${razonSocial}` }));

/** El valor (`dd`) de un dato de la ficha, por su nombre (`dt`). */
function valorDe(panel: Awaited<ReturnType<typeof ficha>>, etiqueta: string): HTMLElement {
  const dt: HTMLElement = panel.getByText(etiqueta, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`Sin valor para ${etiqueta}`);
  return dd;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  simular();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('ClienteDetalleSheet: los datos', () => {
  it('muestra lo que devuelve GET /clientes/:id, no el resumen que vino del listado', async () => {
    // El listado tenía un email viejo: la ficha muestra el del detalle.
    renderFicha(comoCliente({ ...publico, emailContacto: 'viejo@ejemplo.example' }));
    const panel = await ficha(publico.razonSocial);

    expect(await panel.findByText('muni@ejemplo.example')).toBeInTheDocument();
    expect(panel.queryByText('viejo@ejemplo.example')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([e]) => rutaDe(e))).toContain(`/clientes/${publico.id}`);
  });

  it('cliente público por portal y bimestral: subtipo, URL del portal y mes de inicio', async () => {
    renderFicha(comoCliente(publico));
    const panel = await ficha(publico.razonSocial);
    await panel.findByText(publico.cuit);

    expect(valorDe(panel, 'Razón social')).toHaveTextContent('Municipalidad de Ejemplo');
    expect(valorDe(panel, 'Denominación')).toHaveTextContent('Muni Ejemplo');
    expect(valorDe(panel, 'Estado')).toHaveTextContent('Activo');
    expect(valorDe(panel, 'Sector')).toHaveTextContent('Público');
    expect(valorDe(panel, 'Subtipo público')).toHaveTextContent('Municipio');
    expect(valorDe(panel, 'Condición frente al IVA')).toHaveTextContent('Exento');
    expect(valorDe(panel, 'Emisor')).toHaveTextContent('Realpolitik');
    expect(valorDe(panel, 'Canal habitual')).toHaveTextContent('Portal web');
    expect(within(valorDe(panel, 'URL del portal')).getByRole('link')).toHaveAttribute(
      'href',
      publico.portalUrl,
    );
    expect(valorDe(panel, 'Periodicidad')).toHaveTextContent('Bimestral');
    expect(valorDe(panel, 'Día límite')).toHaveTextContent('Día 15');
    expect(valorDe(panel, 'Mes de inicio del ciclo')).toHaveTextContent('Marzo');
    expect(panel.queryByText('Número de WhatsApp')).not.toBeInTheDocument();
  });

  it('cliente privado, inactivo, por WhatsApp y sin periodicidad: solo sus campos', async () => {
    renderFicha(comoCliente(privado));
    const panel = await ficha(privado.razonSocial);
    await panel.findByText(privado.cuit);

    expect(valorDe(panel, 'Estado')).toHaveTextContent('Inactivo');
    expect(valorDe(panel, 'Sector')).toHaveTextContent('Privado');
    expect(panel.queryByText('Subtipo público')).not.toBeInTheDocument();
    expect(valorDe(panel, 'Emisor')).toHaveTextContent('Pendiente');
    expect(valorDe(panel, 'Número de WhatsApp')).toHaveTextContent('+5491122334455');
    expect(panel.queryByText('URL del portal')).not.toBeInTheDocument();
    expect(valorDe(panel, 'Periodicidad')).toHaveTextContent('Sin configurar');
    expect(panel.queryByText('Día límite')).not.toBeInTheDocument();
    expect(panel.queryByText('Mes de inicio del ciclo')).not.toBeInTheDocument();
  });
});

describe('ClienteDetalleSheet: indicaciones y observaciones', () => {
  it('muestra las dos notas en solo lectura', async () => {
    simular({
      indicaciones: () => Promise.resolve(json({ indicacionesArmado: 'Un PDF por factura.' })),
      observaciones: () => Promise.resolve(json({ observaciones: 'Pagan a 60 días.' })),
    });
    renderFicha(comoCliente(publico));
    const panel = await ficha(publico.razonSocial);

    expect(await panel.findByText('Un PDF por factura.')).toBeInTheDocument();
    expect(await panel.findByText('Pagan a 60 días.')).toBeInTheDocument();
    expect(panel.getByRole('heading', { level: 3, name: 'Indicaciones de armado' })).toBeVisible();
    expect(panel.getByRole('heading', { level: 3, name: 'Observaciones internas' })).toBeVisible();
  });

  it('sin notas lo dice; con un error de lectura no dice que no hay, y deja reintentar', async () => {
    let fallar = true;
    simular({
      observaciones: () =>
        Promise.resolve(fallar ? json({}, 500) : json({ observaciones: 'Ahora sí.' })),
    });
    const { user } = renderFicha(comoCliente(publico));
    const panel = await ficha(publico.razonSocial);

    expect(await panel.findByText('Sin indicaciones de armado registradas.')).toBeInTheDocument();
    expect(await panel.findByText('No pudimos cargar las observaciones.')).toBeInTheDocument();
    expect(panel.queryByText('Sin observaciones internas.')).not.toBeInTheDocument();

    fallar = false;
    await user.click(panel.getByRole('button', { name: 'Reintentar' }));

    expect(await panel.findByText('Ahora sí.')).toBeInTheDocument();
  });
});

describe('ClienteDetalleSheet: carga, error y solo lectura', () => {
  it('si falla la ficha lo dice y deja reintentar', async () => {
    let fallar = true;
    simular({
      detalle: () => Promise.resolve(fallar ? json({}, 500) : json(publico)),
    });
    const { user } = renderFicha(comoCliente(publico));
    const panel = await ficha(publico.razonSocial);

    expect(await panel.findByText('No pudimos cargar la ficha del cliente.')).toBeInTheDocument();
    expect(panel.queryByText('Razón social')).not.toBeInTheDocument();

    fallar = false;
    await user.click(panel.getByRole('button', { name: 'Reintentar' }));

    expect(await panel.findByText(publico.cuit)).toBeInTheDocument();
  });

  it('no tiene controles de escritura: ningún campo y ningún botón salvo Cerrar', async () => {
    renderFicha(comoCliente(publico));
    const panel = await ficha(publico.razonSocial);
    await panel.findByText(publico.cuit);
    await panel.findByText('Sin observaciones internas.');

    expect(panel.queryByRole('textbox')).not.toBeInTheDocument();
    expect(panel.queryByRole('combobox')).not.toBeInTheDocument();
    expect(panel.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(panel.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cerrar']);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('al pasar a otro cliente no muestra los datos del anterior mientras carga', async () => {
    let entregar: (r: Response) => void = () => undefined;
    simular({
      detalle: (id) =>
        id === privado.id
          ? new Promise<Response>((resolver) => {
              entregar = resolver;
            })
          : Promise.resolve(json(publico)),
    });
    const { rerender } = renderFicha(comoCliente(publico));
    const primera = await ficha(publico.razonSocial);
    await primera.findByText(publico.cuit);

    rerender(comoCliente(privado));

    const segunda = await ficha(privado.razonSocial);
    expect(segunda.getByTestId('ficha-cargando')).toBeInTheDocument();
    expect(segunda.queryByText(publico.cuit)).not.toBeInTheDocument();

    entregar(json(privado));
    expect(await segunda.findByText(privado.cuit)).toBeInTheDocument();
  });

  it('"Cerrar" avisa a quien la abrió', async () => {
    const { onClose, user } = renderFicha(comoCliente(publico));
    const panel = await ficha(publico.razonSocial);

    await user.click(panel.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
