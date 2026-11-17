import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { crearQueryClient } from '@/app/providers';
import { CLAVE_SESION } from '@/modules/auth/sesion';
import { sembrarSesion, sesionDePrueba } from '@/modules/auth/test/sesionDePrueba';
import {
  VistaPreviaDocumentoSheet,
  type DocumentoAVer,
} from '@/modules/documentos/components/VistaPreviaDocumentoSheet';

// El visor de un documento (HU3.11): pide el archivo a través del backend, como la descarga, y lo
// muestra desde una URL local (`blob:`) que se libera al cerrarlo.

const fetchMock = vi.fn<typeof fetch>();
const crearUrl = vi.fn((_contenido: Blob) => 'blob:vista');
const liberarUrl = vi.fn((_url: string) => undefined);

const PDF: DocumentoAVer = {
  id: '00000000-0000-4000-8000-000000000101',
  nombreOriginal: 'print-octubre.pdf',
  tipoContenido: 'application/pdf',
};
const PNG: DocumentoAVer = {
  id: '00000000-0000-4000-8000-000000000102',
  nombreOriginal: 'constancia.png',
  tipoContenido: 'image/png',
};

// Como texto y no como `Blob`: el `Blob` de jsdom no es el de Node, y `fetch` lo rechaza.
const archivo = (tipo: string) => new Response('contenido', { headers: { 'Content-Type': tipo } });
const fallo = () =>
  new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  // Se limpian acá y no en `afterEach`: el desmontaje del test anterior (que libera su URL) corre
  // después de los `afterEach` de este archivo.
  crearUrl.mockClear();
  liberarUrl.mockClear();
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: crearUrl, revokeObjectURL: liberarUrl }),
  );
  fetchMock.mockImplementation(() => Promise.resolve(archivo('application/pdf')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

function renderVisor(
  documento: DocumentoAVer | null = PDF,
  client: QueryClient = sembrarSesion(
    new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  ),
) {
  const onCerrar = vi.fn();
  const onDescargar = vi.fn();
  const visor = (doc: DocumentoAVer | null) => (
    <QueryClientProvider client={client}>
      <VistaPreviaDocumentoSheet
        documento={doc}
        onCerrar={onCerrar}
        onDescargar={onDescargar}
        descargando={false}
      />
    </QueryClientProvider>
  );
  const resultado = render(visor(documento));
  return {
    ...resultado,
    onCerrar,
    onDescargar,
    user: userEvent.setup(),
    cambiar: (doc: DocumentoAVer | null) => resultado.rerender(visor(doc)),
  };
}

const rutasPedidas = () =>
  fetchMock.mock.calls.map(([entrada]) => new URL(entrada as string).pathname);

describe('VistaPreviaDocumentoSheet', () => {
  it('un PDF se muestra dentro del sistema, pedido a través del backend', async () => {
    renderVisor();

    const visor = within(
      await screen.findByRole('dialog', { name: 'Vista previa de print-octubre.pdf' }),
    );
    expect(visor.getByRole('status')).toHaveTextContent('Cargando la vista previa…');

    const contenido = await visor.findByTitle('Contenido de print-octubre.pdf');
    expect(contenido.tagName).toBe('IFRAME');
    expect(contenido).toHaveAttribute('src', 'blob:vista');
    expect(rutasPedidas()).toEqual([`/documentos/${PDF.id}/archivo`]);
    // Se muestra con el formato verificado al cargarlo, no con lo que diga la respuesta.
    expect(crearUrl.mock.calls[0]?.[0].type).toBe('application/pdf');
  });

  it('una imagen se muestra como imagen', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(archivo('image/png')));
    renderVisor(PNG);

    const imagen = await screen.findByRole('img', { name: 'Contenido de constancia.png' });
    expect(imagen).toHaveAttribute('src', 'blob:vista');
    expect(crearUrl.mock.calls[0]?.[0].type).toBe('image/png');
  });

  it('ofrece abrirlo en otra pestaña y descargarlo', async () => {
    const { user, onDescargar } = renderVisor();
    const visor = within(await screen.findByRole('dialog', { name: /print-octubre\.pdf/ }));

    const pestania = await visor.findByRole('link', { name: 'Abrir en otra pestaña' });
    expect(pestania).toHaveAttribute('href', 'blob:vista');
    expect(pestania).toHaveAttribute('target', '_blank');

    await user.click(visor.getByRole('button', { name: 'Descargar' }));
    expect(onDescargar).toHaveBeenCalledWith(PDF);
  });

  it('si el archivo no se puede cargar, lo dice y ofrece descargarlo o reintentar', async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(fallo()));
    const { user, onDescargar } = renderVisor();
    const visor = within(await screen.findByRole('dialog', { name: /print-octubre\.pdf/ }));

    expect(
      await visor.findByText(
        'El servicio de documentos no está disponible en este momento: no pudimos mostrar print-octubre.pdf. Probá de nuevo en unos minutos.',
      ),
    ).toBeVisible();
    expect(visor.queryByRole('link', { name: 'Abrir en otra pestaña' })).not.toBeInTheDocument();
    await user.click(visor.getByRole('button', { name: 'Descargar' }));
    expect(onDescargar).toHaveBeenCalledWith(PDF);

    await user.click(visor.getByRole('button', { name: 'Reintentar' }));
    expect(await visor.findByTitle('Contenido de print-octubre.pdf')).toBeInTheDocument();
  });

  it('si la imagen no se puede mostrar, lo dice y ofrece descargarla', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(archivo('image/png')));
    renderVisor(PNG);

    fireEvent.error(await screen.findByRole('img', { name: 'Contenido de constancia.png' }));

    expect(
      await screen.findByText(
        'No pudimos mostrar constancia.png. Podés descargarlo para verlo en tu equipo.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('img', { name: 'Contenido de constancia.png' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });

  it('Escape lo cierra', async () => {
    const { user, onCerrar } = renderVisor();
    await screen.findByTitle('Contenido de print-octubre.pdf');

    await user.keyboard('{Escape}');

    expect(onCerrar).toHaveBeenCalled();
  });

  it('libera la URL al cerrarlo', async () => {
    const { cambiar } = renderVisor();
    await screen.findByTitle('Contenido de print-octubre.pdf');
    expect(liberarUrl).not.toHaveBeenCalled();

    cambiar(null);

    await waitFor(() => expect(liberarUrl).toHaveBeenCalledWith('blob:vista'));
  });

  it('libera la URL si se desmonta abierto', async () => {
    const { unmount } = renderVisor();
    await screen.findByTitle('Contenido de print-octubre.pdf');

    unmount();

    expect(liberarUrl).toHaveBeenCalledWith('blob:vista');
  });

  it('un formato que no se puede ver no pide nada', () => {
    renderVisor({
      ...PDF,
      tipoContenido: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(crearUrl).not.toHaveBeenCalled();
  });
});

// ─── Por qué no se pudo traer (HU4.4, CA12) ───────────────────────────────────

const errorJson = (status: number, code: string, details?: unknown) =>
  new Response(JSON.stringify({ error: { code, message: 'mensaje interno', details } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('VistaPreviaDocumentoSheet: motivo del fallo', () => {
  it('403: solo dice que no tiene permiso, sin "Descargar" ni "Reintentar" (darían el mismo 403)', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(errorJson(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' })),
    );
    renderVisor();
    const visor = within(await screen.findByRole('dialog', { name: /print-octubre\.pdf/ }));

    expect(await visor.findByText('No tenés permiso para ver print-octubre.pdf.')).toBeVisible();
    expect(visor.queryByText(/mensaje interno/)).not.toBeInTheDocument();
    expect(visor.queryByRole('button', { name: 'Descargar' })).not.toBeInTheDocument();
    expect(visor.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    // Tampoco el "Descargar" del pie, que solo está cuando el archivo se ve, y no se reintenta solo.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      '404',
      () => Promise.resolve(errorJson(404, 'NOT_FOUND')),
      'print-octubre.pdf ya no está disponible. Actualizá la información y probá de nuevo.',
    ],
    [
      'sin red',
      () => Promise.reject(new TypeError('Failed to fetch')),
      'No pudimos conectarnos con el servidor para mostrar print-octubre.pdf. Revisá tu conexión y probá de nuevo.',
    ],
  ])(
    '%s: lo dice, sin el texto del servidor, y "Reintentar" lo recupera',
    async (_caso, falla, texto) => {
      fetchMock.mockImplementationOnce(falla);
      const { user } = renderVisor();
      const visor = within(await screen.findByRole('dialog', { name: /print-octubre\.pdf/ }));

      expect(await visor.findByText(texto)).toBeVisible();
      expect(visor.queryByText(/mensaje interno/)).not.toBeInTheDocument();
      expect(visor.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
      expect(visor.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();

      await user.click(visor.getByRole('button', { name: 'Reintentar' }));
      expect(await visor.findByTitle('Contenido de print-octubre.pdf')).toBeInTheDocument();
      expect(visor.queryByText(texto)).not.toBeInTheDocument();
    },
  );
});

describe('VistaPreviaDocumentoSheet: sesión, con el manejo global de la app', () => {
  // Con el QueryClient de la app: el error de la query pasa por `manejarErrorGlobal` (una sola
  // vez, lo hace la QueryCache; el visor no lo vuelve a llamar).
  const pedidosA = (ruta: string) => rutasPedidas().filter((r) => r === ruta).length;
  const ARCHIVO = `/documentos/${PDF.id}/archivo`;

  it('401 atrasado: confirma la sesión una vez y vuelve a pedir el archivo, que se muestra', async () => {
    let primero = true;
    fetchMock.mockImplementation((entrada) => {
      if (new URL(entrada as string).pathname === '/auth/sesion') {
        return Promise.resolve(
          new Response(JSON.stringify(sesionDePrueba()), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (primero) {
        primero = false;
        return Promise.resolve(errorJson(401, 'UNAUTHENTICATED', { motivo: 'SESION_REQUERIDA' }));
      }
      return Promise.resolve(archivo('application/pdf'));
    });
    const client = sembrarSesion(crearQueryClient());
    renderVisor(PDF, client);

    expect(await screen.findByTitle('Contenido de print-octubre.pdf')).toBeInTheDocument();
    expect(pedidosA('/auth/sesion')).toBe(1);
    expect(pedidosA(ARCHIVO)).toBe(2);
    expect(client.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
  });

  it('403: la sesión sigue y se revalida, y el visor dice que no tiene permiso', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(errorJson(403, 'FORBIDDEN', { motivo: 'PERMISO_INSUFICIENTE' })),
    );
    const client = sembrarSesion(crearQueryClient());
    renderVisor(PDF, client);

    expect(await screen.findByText('No tenés permiso para ver print-octubre.pdf.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Descargar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(client.getQueryData(CLAVE_SESION)).toEqual(sesionDePrueba());
    expect(client.getQueryState(CLAVE_SESION)?.isInvalidated).toBe(true);
    expect(pedidosA(ARCHIVO)).toBe(1);
  });
});
