import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ObservacionesClientePanel } from '@/modules/clientes/components/ObservacionesClientePanel';

// Panel "Observaciones internas" de la pantalla del cliente (HU2.10): solo lectura. Se edita en la
// hoja "Editar cliente", a la que lleva su botón.

const fetchMock = vi.fn<typeof fetch>();

const CLIENTE = { id: '11111111-1111-4111-a111-111111111111' };

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

/** El GET de las observaciones responde lo que se indique (una promesa permite demorarlo). */
function servir(get: () => Response | Promise<Response>) {
  fetchMock.mockImplementation((entrada) => {
    const path = new URL(urlDe(entrada)).pathname;
    return path === `/clientes/${CLIENTE.id}/observaciones`
      ? Promise.resolve(get())
      : Promise.resolve(json({}, 404));
  });
}

const servirNota = (nota: string | null) => servir(() => json({ observaciones: nota }));

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

/** `null` = sin quien atienda el botón (solo lectura total). */
function renderPanel({ conBoton = true }: { conBoton?: boolean } = {}) {
  const onEditarCliente = conBoton ? vi.fn() : undefined;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ObservacionesClientePanel cliente={CLIENTE} onEditarCliente={onEditarCliente} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), onEditarCliente };
}

const panel = () => screen.getByRole('region', { name: 'Observaciones internas' });
const botonEditar = () =>
  screen.getByRole('button', { name: 'Editar en la ficha del cliente: observaciones internas' });
const escrituras = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method !== undefined && init.method !== 'GET');

describe('ObservacionesClientePanel (solo lectura)', () => {
  it('es una sección con el título "Observaciones internas"', async () => {
    servirNota(null);
    renderPanel();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Observaciones internas' }),
    ).toBeInTheDocument();
    expect(panel()).toBeInTheDocument();
  });

  it('mientras carga muestra un esqueleto y no un "sin observaciones"', async () => {
    servir(() => new Promise<Response>(() => undefined));
    renderPanel();

    expect(await screen.findByTestId('observaciones-cargando')).toBeInTheDocument();
    expect(screen.queryByText('Sin observaciones internas.')).not.toBeInTheDocument();
  });

  it('si no se pudo leer, lo dice y ofrece reintentar, sin afirmar que no hay nada', async () => {
    let falla = true;
    servir(() =>
      falla
        ? json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500)
        : json({ observaciones: 'Cambió el mail.' }),
    );
    const { user } = renderPanel();

    expect(await within(panel()).findByRole('alert')).toHaveTextContent(
      'No pudimos cargar las observaciones.',
    );
    expect(screen.queryByText('Sin observaciones internas.')).not.toBeInTheDocument();

    falla = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Cambió el mail.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sin observaciones lo dice', async () => {
    servirNota(null);
    renderPanel();

    expect(await screen.findByText('Sin observaciones internas.')).toBeInTheDocument();
  });

  it('con texto lo muestra respetando los saltos de línea', async () => {
    const nota = 'Cambió el mail.\nPausó la pauta hasta marzo.';
    servirNota(nota);
    renderPanel();

    const texto = await screen.findByTestId('texto-observaciones');
    expect(texto.textContent).toBe(nota);
    expect(texto).toHaveClass('whitespace-pre-wrap');
  });

  it('una nota de solo espacios se muestra como "sin observaciones"', async () => {
    servirNota('   \n  ');
    renderPanel();

    expect(await screen.findByText('Sin observaciones internas.')).toBeInTheDocument();
  });

  it('no se edita acá: no hay cuadro de texto, contador ni botón de guardar', async () => {
    servirNota('Nota.');
    renderPanel();
    await screen.findByText('Nota.');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contador-observaciones')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /guardar|cancelar/i })).not.toBeInTheDocument();
    expect(escrituras()).toHaveLength(0);
  });

  it('lee una sola vez al montarse', async () => {
    servirNota('Nota.');
    renderPanel();
    await screen.findByText('Nota.');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe('ObservacionesClientePanel: botón para editar', () => {
  it('dice "Editar en la ficha del cliente" y su nombre accesible aclara que es de las observaciones', async () => {
    servirNota('Nota.');
    renderPanel();
    await screen.findByText('Nota.');

    expect(botonEditar()).toHaveTextContent(/^Editar en la ficha del cliente$/);
    // El nombre contiene el texto visible (etiqueta en el nombre) y agrega de qué es.
    expect(botonEditar()).toHaveAccessibleName(
      'Editar en la ficha del cliente: observaciones internas',
    );
  });

  it('al apretarlo avisa a quien lo usa, sin hacer ningún pedido más', async () => {
    servirNota('Nota.');
    const { user, onEditarCliente } = renderPanel();
    await screen.findByText('Nota.');

    await user.click(botonEditar());

    expect(onEditarCliente).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('está disponible también sin observaciones, mientras carga y si falló la lectura', async () => {
    servir(() => json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500));
    renderPanel();

    await within(panel()).findByRole('alert');

    expect(botonEditar()).toBeEnabled();
  });

  it('sin quien lo atienda (solo lectura total), no se ofrece', async () => {
    servirNota('Nota.');
    renderPanel({ conBoton: false });
    await screen.findByText('Nota.');

    expect(screen.queryByRole('button', { name: /Editar en la ficha/ })).not.toBeInTheDocument();
  });
});

describe('ObservacionesClientePanel: diseño', () => {
  it('no usa colores directos: solo tokens del sistema de diseño', async () => {
    servirNota('Nota.');
    renderPanel();
    await screen.findByText('Nota.');

    const html = panel().outerHTML;

    expect(html).not.toMatch(
      /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|blue|indigo|violet|purple|pink)-\d{2,3})\b/,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});

describe('ObservacionesClientePanel: ids generados', () => {
  it('dos paneles en la misma página tienen títulos con ids distintos', async () => {
    servirNota(null);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ObservacionesClientePanel cliente={CLIENTE} />
        <ObservacionesClientePanel cliente={CLIENTE} />
      </QueryClientProvider>,
    );

    const paneles = await screen.findAllByRole('region', { name: 'Observaciones internas' });
    const ids = paneles.map((p) => p.getAttribute('aria-labelledby'));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const [i, id] of ids.entries()) {
      expect(within(paneles[i] as HTMLElement).getByRole('heading', { level: 2 })).toHaveAttribute(
        'id',
        id,
      );
    }
  });
});
