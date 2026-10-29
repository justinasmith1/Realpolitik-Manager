import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';

// Las observaciones internas en la pantalla del cliente (HU2.10): el panel las muestra y su botón
// abre la misma hoja "Editar cliente" que el de las indicaciones de armado. Ahí se editan, con el
// cliente en cualquier estado, aunque la matriz de requisitos no se pueda modificar.

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

const ID = '11111111-1111-4111-a111-111111111111';
const fechas = { creadoEn: '2026-10-08T12:00:00.000Z', actualizadoEn: '2026-10-08T12:00:00.000Z' };

const cliente = {
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
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: true,
  ...fechas,
};

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

interface Opciones {
  estado?: string;
  nota?: string | null;
  lecturaFalla?: boolean;
  /** Demora la lectura de las observaciones hasta que se llame a la función que se devuelve. */
  lecturaDemorada?: boolean;
}

/** Servidor de mentira: `nota` es lo guardado y un PUT la reemplaza. */
function servir({
  estado = 'ACTIVO',
  nota = null,
  lecturaFalla = false,
  lecturaDemorada = false,
}: Opciones = {}) {
  const guardado = { nota };
  let liberar: () => void = () => undefined;
  const lectura = new Promise<void>((resolver) => {
    liberar = resolver;
  });
  fetchMock.mockImplementation((entrada, init) => {
    const path = new URL(urlDe(entrada)).pathname;
    if (path.endsWith('/observaciones')) {
      if (init?.method === 'PUT') {
        const { observaciones } = JSON.parse(init.body as string) as { observaciones: string };
        guardado.nota = observaciones;
        return Promise.resolve(json({ observaciones }));
      }
      const respuesta = () =>
        lecturaFalla
          ? json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500)
          : json({ observaciones: guardado.nota });
      return lecturaDemorada ? lectura.then(respuesta) : Promise.resolve(respuesta());
    }
    if (path.endsWith('/indicaciones-armado')) {
      return Promise.resolve(json({ indicacionesArmado: 'Factura primero.' }));
    }
    if (path.endsWith('/rendiciones') || path.endsWith('/requisitos')) {
      return Promise.resolve(json([]));
    }
    return Promise.resolve(json({ ...cliente, estado }));
  });
  return { guardado, liberar };
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

function renderMatriz() {
  const router = createMemoryRouter([{ path: '/clientes/:id/matriz', element: <MatrizPage /> }], {
    initialEntries: [`/clientes/${ID}/matriz`],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const panel = () => screen.findByRole('region', { name: 'Observaciones internas' });
const botonDeObservaciones = () =>
  screen.findByRole('button', { name: 'Editar en la ficha del cliente: observaciones internas' });
const botonDeIndicaciones = () =>
  screen.findByRole('button', { name: 'Editar en la ficha del cliente: indicaciones de armado' });
const hoja = () => screen.findByRole('dialog', { name: 'Editar cliente' });
const campoDeObservaciones = () => screen.getByRole('textbox', { name: 'Observaciones internas' });
const putsDeObservaciones = () =>
  fetchMock.mock.calls.filter(
    ([entrada, init]) => init?.method === 'PUT' && urlDe(entrada).endsWith('/observaciones'),
  );

describe('MatrizPage: observaciones internas', () => {
  it('muestra la nota guardada del cliente, después de las indicaciones de armado (el orden de la hoja)', async () => {
    servir({ nota: 'Cambió el mail.' });
    renderMatriz();

    const observaciones = await panel();
    expect(await within(observaciones).findByText('Cambió el mail.')).toBeInTheDocument();
    const indicaciones = await screen.findByRole('region', { name: 'Indicaciones de armado' });
    expect(
      indicaciones.compareDocumentPosition(observaciones) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('cada panel tiene su propio título: los ids generados no se repiten', async () => {
    servir({ nota: 'Cambió el mail.' });
    renderMatriz();

    const observaciones = await panel();
    const indicaciones = await screen.findByRole('region', { name: 'Indicaciones de armado' });
    const idObservaciones = observaciones.getAttribute('aria-labelledby');
    const idIndicaciones = indicaciones.getAttribute('aria-labelledby');
    expect(idObservaciones).toBeTruthy();
    expect(idIndicaciones).toBeTruthy();
    expect(idObservaciones).not.toBe(idIndicaciones);
    expect(document.querySelectorAll(`[id="${idObservaciones}"]`)).toHaveLength(1);
  });

  it('el panel es de solo lectura: no hay cuadro de texto en la pantalla', async () => {
    servir({ nota: 'Cambió el mail.' });
    renderMatriz();
    await within(await panel()).findByText('Cambió el mail.');

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('los dos botones dicen lo mismo a la vista, se distinguen por su nombre accesible y abren la misma hoja "Editar cliente"', async () => {
    servir({ nota: 'Cambió el mail.' });
    const { user } = renderMatriz();
    await within(await panel()).findByText('Cambió el mail.');

    const deObservaciones = await botonDeObservaciones();
    const deIndicaciones = await botonDeIndicaciones();
    // Lo que se ve es igual; lo que anuncia el lector de pantalla, no.
    expect(deObservaciones).toHaveTextContent(/^Editar en la ficha del cliente$/);
    expect(deIndicaciones).toHaveTextContent(/^Editar en la ficha del cliente$/);
    expect(deObservaciones.textContent).toBe(deIndicaciones.textContent);
    expect(deObservaciones).toHaveAccessibleName(
      'Editar en la ficha del cliente: observaciones internas',
    );
    expect(deIndicaciones).toHaveAccessibleName(
      'Editar en la ficha del cliente: indicaciones de armado',
    );

    await user.click(deObservaciones);
    expect(await hoja()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(await botonDeIndicaciones());
    expect(await hoja()).toBeInTheDocument();
  });

  it('se edita en la hoja y el panel muestra lo nuevo sin recargar la página', async () => {
    const { guardado } = servir({ nota: 'Cambió el mail.' });
    const { user } = renderMatriz();
    await within(await panel()).findByText('Cambió el mail.');

    await user.click(await botonDeObservaciones());
    await hoja();
    await user.clear(campoDeObservaciones());
    await user.click(campoDeObservaciones());
    await user.paste('Pausó la pauta hasta marzo.');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      await within(await panel()).findByText('Pausó la pauta hasta marzo.'),
    ).toBeInTheDocument();
    expect(guardado.nota).toBe('Pausó la pauta hasta marzo.');
    expect(putsDeObservaciones()).toHaveLength(1);
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    'con el cliente %s también se edita en la hoja, aunque la matriz no se pueda modificar',
    async (estado) => {
      const { guardado } = servir({ estado });
      const { user } = renderMatriz();

      expect(
        await screen.findByText('Este cliente debe estar activo para modificar sus requisitos.'),
      ).toBeInTheDocument();
      await user.click(await botonDeObservaciones());
      await hoja();
      // Las indicaciones quedan bloqueadas; las observaciones, no.
      expect(screen.getByRole('textbox', { name: 'Indicaciones de armado' })).toBeDisabled();
      expect(campoDeObservaciones()).toBeEnabled();
      await user.click(campoDeObservaciones());
      await user.paste('Pausó la pauta.');
      await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await within(await panel()).findByText('Pausó la pauta.')).toBeInTheDocument();
      expect(guardado.nota).toBe('Pausó la pauta.');
    },
  );

  it('si no se pueden leer las observaciones, el resto de la pantalla sigue funcionando', async () => {
    servir({ lecturaFalla: true });
    renderMatriz();

    expect(
      await within(await panel()).findByText('No pudimos cargar las observaciones.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Factura primero.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Muni Ejemplo' })).toBeInTheDocument();
  });
});

describe('MatrizPage: foco al abrir la hoja desde el panel de observaciones', () => {
  it('lleva el foco al campo de observaciones y no lo pierde después', async () => {
    servir({ nota: 'Cambió el mail.' });
    const { user } = renderMatriz();
    await within(await panel()).findByText('Cambió el mail.');

    await user.click(await botonDeObservaciones());
    await hoja();

    await waitFor(() => expect(campoDeObservaciones()).toHaveFocus());
    // Nadie se lo roba después: ni el foco inicial del diálogo ni la carga de las indicaciones.
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 100));
    });
    expect(campoDeObservaciones()).toHaveFocus();
  });

  it('desde el botón de las indicaciones no lo mueve a las observaciones', async () => {
    servir({ nota: 'Cambió el mail.' });
    const { user } = renderMatriz();
    await within(await panel()).findByText('Cambió el mail.');

    await user.click(await botonDeIndicaciones());
    await hoja();
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 100));
    });

    expect(campoDeObservaciones()).not.toHaveFocus();
  });

  it('si el campo todavía no cargó, no fuerza nada: queda el foco habitual de la hoja', async () => {
    const { liberar } = servir({ nota: 'Cambió el mail.', lecturaDemorada: true });
    const { user } = renderMatriz();
    await screen.findByRole('region', { name: 'Observaciones internas' });

    await user.click(await botonDeObservaciones());
    await hoja();

    expect(campoDeObservaciones()).toBeDisabled();
    expect(campoDeObservaciones()).not.toHaveFocus();

    await act(async () => {
      liberar();
      await new Promise((resolver) => setTimeout(resolver, 50));
    });
    await waitFor(() => expect(campoDeObservaciones()).toHaveValue('Cambió el mail.'));
    // Sin foco "tardío": no se le quita al usuario lo que haya hecho entretanto.
    expect(campoDeObservaciones()).not.toHaveFocus();
  });
});
