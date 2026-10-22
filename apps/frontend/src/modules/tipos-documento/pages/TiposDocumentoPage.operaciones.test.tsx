import { normalizarNombreTipoDocumento } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { TiposDocumentoListado } from '@/modules/tipos-documento/components/TiposDocumentoListado';
import { TiposDocumentoPage } from '@/modules/tipos-documento/pages/TiposDocumentoPage';

// La pausa de éxito (500 ms) no es el tema de estos tests: se prueba en `*.exito.test.tsx`.
vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

function renderPage(url = '/clientes/tipos-documento') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path: '/clientes/tipos-documento', element: <TiposDocumentoPage /> }],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, user: userEvent.setup() };
}

// ─── Servidor simulado ────────────────────────────────────────────────────────

interface TipoJson {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

const fechas = { creadoEn: '2026-10-21T12:00:00.000Z', actualizadoEn: '2026-10-21T12:00:00.000Z' };
const idDe = (n: number) => `99999999-9999-4999-a999-${String(n).padStart(12, '0')}`;

const arca: TipoJson = {
  id: idDe(1),
  nombre: 'Constancia ARCA',
  descripcion: 'Inscripción',
  activo: true,
  ...fechas,
};
const factura: TipoJson = { ...arca, id: idDe(2), nombre: 'Factura', descripcion: null };
const print: TipoJson = { ...arca, id: idDe(3), nombre: 'Print', descripcion: null, activo: false };

/** URL de un pedido de fetch, venga como texto, URL o Request. */
const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const clave = (nombre: string) => normalizarNombreTipoDocumento(nombre);

const conflicto = (existente: unknown) => ({
  error: {
    code: 'CONFLICT',
    message: 'Ya existe un tipo de documento con ese nombre',
    details: { motivo: 'TIPO_DOCUMENTO_DUPLICADO', tipoDocumentoExistente: existente },
  },
});

const NO_ENCONTRADO = { error: { code: 'NOT_FOUND', message: 'Tipo de documento no encontrado' } };

/**
 * Hace lo que el backend con el catálogo en memoria: GET (activos o todos, por clave), POST y
 * PATCH con la unicidad por nombre normalizado (contra TODO el catálogo, no lo listado), 404 si el
 * id no existe. Devuelve los datos para poder cambiarlos a mitad del test.
 */
function simularServidor(inicial: TipoJson[]) {
  const datos = inicial.map((tipo) => ({ ...tipo }));
  let siguienteId = 100;
  fetchMock.mockImplementation((entrada, init) => {
    const url = new URL(urlDe(entrada));
    const metodo = init?.method ?? 'GET';
    const cuerpo = (init?.body ? JSON.parse(init.body as string) : {}) as Record<string, unknown>;

    if (metodo === 'GET') {
      const incluir = url.searchParams.get('incluirInactivos') === 'true';
      const lista = datos
        .filter((tipo) => incluir || tipo.activo)
        .sort((a, b) => clave(a.nombre).localeCompare(clave(b.nombre)));
      return Promise.resolve(json(lista));
    }

    const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre : undefined;
    if (metodo === 'POST') {
      const existente = datos.find((tipo) => clave(tipo.nombre) === clave(nombre ?? ''));
      if (existente) return Promise.resolve(json(conflicto(existente), 409));
      siguienteId += 1;
      const nuevo: TipoJson = {
        ...fechas,
        id: idDe(siguienteId),
        nombre: nombre ?? '',
        descripcion: (cuerpo.descripcion as string | null | undefined) ?? null,
        activo: true,
      };
      datos.push(nuevo);
      return Promise.resolve(json(nuevo, 201));
    }

    // PATCH /tipos-documento/:id[/estado]
    const [, , id, sufijo] = url.pathname.split('/');
    const tipo = datos.find((t) => t.id === id);
    if (tipo === undefined) return Promise.resolve(json(NO_ENCONTRADO, 404));
    if (sufijo === 'estado') {
      tipo.activo = cuerpo.activo as boolean;
      return Promise.resolve(json(tipo));
    }
    if (nombre !== undefined) {
      const otro = datos.find((t) => t.id !== id && clave(t.nombre) === clave(nombre));
      if (otro) return Promise.resolve(json(conflicto(otro), 409));
      tipo.nombre = nombre;
    }
    if ('descripcion' in cuerpo) tipo.descripcion = cuerpo.descripcion as string | null;
    return Promise.resolve(json(tipo));
  });
  return datos;
}

/** Desde ahora, los pedidos con ese método responden con `respuesta`; el resto, el servidor. */
function siempreResponde(metodo: string, respuesta: () => Promise<Response>) {
  const servidor = fetchMock.getMockImplementation();
  fetchMock.mockImplementation((entrada, init) =>
    (init?.method ?? 'GET') === metodo
      ? respuesta()
      : (servidor?.(entrada, init) ?? Promise.reject(new Error('sin servidor'))),
  );
}

/** Los pedidos con ese método quedan en vuelo; `seguir()` deja pasar el último al servidor. */
function enVuelo(metodo: string) {
  const servidor = fetchMock.getMockImplementation();
  const alServidor = (...args: Parameters<typeof fetch>) =>
    servidor?.(...args) ?? Promise.reject(new Error('sin servidor'));
  let seguir: () => void = () => undefined;
  fetchMock.mockImplementation((entrada, init) => {
    if ((init?.method ?? 'GET') !== metodo) {
      return alServidor(entrada, init);
    }
    return new Promise<Response>((resolve, reject) => {
      seguir = () => void alServidor(entrada, init).then(resolve, reject);
    });
  });
  return () => seguir();
}

const pedidos = (metodo: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === metodo);
const cuerpoDe = (metodo: string, indice = 0): unknown =>
  JSON.parse(pedidos(metodo)[indice]?.[1]?.body as string);

// ─── Utilidades de la UI ──────────────────────────────────────────────────────

const panelDeAlta = () => screen.queryByRole('dialog', { name: 'Nuevo tipo de documento' });
const panelDeEdicion = () => screen.queryByRole('dialog', { name: 'Editar tipo de documento' });
const confirmacion = () => screen.queryByRole('alertdialog');
const titulo = () => screen.getByRole('heading', { level: 1, name: 'Clientes' });
const filtro = () => screen.getByRole('checkbox', { name: 'Incluir desactivados' });

/** Los avisos de la página (los `Alert` que no están dentro de un panel o diálogo). */
const avisosDePagina = () =>
  Array.from(document.querySelectorAll('[data-slot="alert"]')).filter(
    (aviso) => aviso.closest('[role="dialog"], [role="alertdialog"]') === null,
  );

async function esperarAviso(texto: string) {
  await waitFor(() => expect(avisosDePagina().map((a) => a.textContent)).toEqual([texto]));
  return avisosDePagina()[0] as HTMLElement;
}

/** Abre el menú ⋯ de ese tipo y elige una opción. */
async function elegirAccion(user: UserEvent, nombre: string, accion: string) {
  await user.click(screen.getByRole('button', { name: `Acciones de ${nombre}` }));
  const menu = within(await screen.findByRole('menu'));
  await user.click(menu.getByRole('menuitem', { name: accion }));
}

async function abrirAlta(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Nuevo tipo' }));
  return within(await screen.findByRole('dialog', { name: 'Nuevo tipo de documento' }));
}

async function abrirEdicionDesdeElNombre(user: UserEvent, nombre: string) {
  await user.click(screen.getByRole('button', { name: nombre }));
  return within(await screen.findByRole('dialog', { name: 'Editar tipo de documento' }));
}

/** El mensaje de error asociado a un campo (por `aria-describedby`). */
function errorDe(campo: HTMLElement) {
  const ids = campo.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

// ─── Alta ─────────────────────────────────────────────────────────────────────

describe('TiposDocumentoPage: nuevo tipo', () => {
  it('"Nuevo tipo" abre el panel con Nombre y Descripción (opcional), y el foco entra al panel', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');

    const panel = await abrirAlta(user);

    const descripcionDelPanel =
      'Agregá un tipo de documento para utilizarlo en las matrices de requisitos.';
    expect(panel.getByText(descripcionDelPanel)).toBeInTheDocument();
    const nombre = panel.getByLabelText('Nombre');
    expect(nombre).toHaveAttribute('placeholder', 'Ej. Constancia de inscripción');
    expect(panel.getByLabelText('Descripción')).toHaveValue('');
    expect(panel.getByText('Opcional')).toBeInTheDocument();
    const enfocado = () => document.activeElement as HTMLElement;
    await waitFor(() => expect(panelDeAlta()).toContainElement(enfocado()));
  });

  it('sin nombre no envía: marca el campo, asocia el error y le lleva el foco', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirAlta(user);

    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    const nombre = panel.getByLabelText('Nombre');
    expect(nombre).toHaveAttribute('aria-invalid', 'true');
    expect(errorDe(nombre)).toBe('El nombre es obligatorio.');
    expect(nombre).toHaveFocus();
    expect(pedidos('POST')).toHaveLength(0);
  });

  it('antes del primer envío, salir de un campo vacío no lo marca', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirAlta(user);

    await user.click(panel.getByLabelText('Nombre'));
    await user.tab();

    expect(panel.getByLabelText('Nombre')).not.toHaveAttribute('aria-invalid');
  });

  it('valida los largos de shared: 100 caracteres de nombre y 500 de descripción', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirAlta(user);

    await user.click(panel.getByLabelText('Nombre'));
    await user.paste('x'.repeat(101));
    await user.click(panel.getByLabelText('Descripción'));
    await user.paste('y'.repeat(501));
    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    const errorDelNombre = errorDe(panel.getByLabelText('Nombre'));
    expect(errorDelNombre).toBe('El nombre no puede superar los 100 caracteres.');
    expect(errorDe(panel.getByLabelText('Descripción'))).toMatch(/500 caracteres/);
    expect(pedidos('POST')).toHaveLength(0);
  });

  it('crea con solo nombre y descripción, cierra el panel, avisa y el listado muestra el tipo', async () => {
    simularServidor([arca]);
    const { user, queryClient } = renderPage();
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByRole('table');
    const panel = await abrirAlta(user);

    await user.type(panel.getByLabelText('Nombre'), '  Libre deuda ');
    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    await esperarAviso('Se creó el tipo Libre deuda. Ya está disponible para las matrices.');
    await waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(cuerpoDe('POST')).toStrictEqual({ nombre: 'Libre deuda', descripcion: null });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['tipos-documento'] });
    expect(await screen.findByRole('button', { name: 'Libre deuda' })).toBeInTheDocument();
  });

  it('mientras guarda: "Guardando…", sin segundo envío y sin poder cerrar el panel', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirAlta(user);
    await user.type(panel.getByLabelText('Nombre'), 'Libre deuda');
    const seguir = enVuelo('POST');

    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    const guardando = panel.getByRole('button', { name: 'Guardando…' });
    expect(guardando).toHaveAttribute('aria-busy', 'true');
    await user.click(guardando);
    fireEvent.keyDown(panel.getByLabelText('Nombre'), { key: 'Escape' });
    expect(panelDeAlta()).toBeInTheDocument();
    expect(pedidos('POST')).toHaveLength(1);

    seguir();

    await waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(pedidos('POST')).toHaveLength(1);
  });

  it('Cancelar cierra sin enviar y el foco vuelve a "Nuevo tipo"', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirAlta(user);
    await user.type(panel.getByLabelText('Nombre'), 'Algo');

    await user.click(panel.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(pedidos('POST')).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nuevo tipo' })).toHaveFocus());
  });

  it('con el catálogo vacío, "Crear el primer tipo" abre el mismo panel', async () => {
    simularServidor([]);
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Crear el primer tipo' }));

    await waitFor(() => expect(panelDeAlta()).toBeInTheDocument());
  });

  it('ante un error inesperado queda abierto, con los datos y un mensaje genérico', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirAlta(user);
    await user.type(panel.getByLabelText('Nombre'), 'Libre deuda');
    siempreResponde('POST', () => Promise.reject(new TypeError('Failed to fetch')));

    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    expect(await panel.findByRole('alert')).toHaveTextContent(
      'No pudimos crear el tipo de documento. Probá de nuevo en unos segundos.',
    );
    expect(panel.getByLabelText('Nombre')).toHaveValue('Libre deuda');
    expect(avisosDePagina()).toHaveLength(0);
  });
});

// ─── Nombres duplicados ───────────────────────────────────────────────────────

describe('TiposDocumentoPage: nombre duplicado', () => {
  async function intentarCrear(user: UserEvent, nombre: string) {
    const panel = await abrirAlta(user);
    await user.type(panel.getByLabelText('Nombre'), nombre);
    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));
    const campo = panel.getByLabelText('Nombre');
    await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
    return panel;
  }

  it('con un tipo activo, el error va al campo Nombre con el nombre real; conserva lo escrito', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');

    const panel = await intentarCrear(user, 'constancia  arca');

    const nombre = panel.getByLabelText('Nombre');
    expect(errorDe(nombre)).toBe('Ya existe «Constancia ARCA» en el catálogo.');
    expect(nombre).toHaveValue('constancia  arca');
    expect(nombre).toHaveFocus();
    expect(panelDeAlta()).toBeInTheDocument();
  });

  it('con un tipo desactivado (que no está en el listado) dice cómo encontrarlo', async () => {
    simularServidor([arca, print]);
    const { user } = renderPage();
    await screen.findByRole('table');
    expect(screen.queryByText('Print')).not.toBeInTheDocument();

    const panel = await intentarCrear(user, 'PRINT');

    expect(errorDe(panel.getByLabelText('Nombre'))).toBe(
      'Ya existe «Print» en el catálogo, pero está desactivado. Podés reactivarlo desde la lista activando «Incluir desactivados».',
    );
    expect(panel.queryByRole('button', { name: /Reactivar/ })).not.toBeInTheDocument();
  });

  it('si el servidor no informa el tipo existente, no afirma si está activo o no', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    siempreResponde('POST', () => Promise.resolve(json(conflicto(undefined), 409)));

    const panel = await intentarCrear(user, 'Constancia ARCA');

    const mensaje = errorDe(panel.getByLabelText('Nombre'));
    expect(mensaje).toBe('Ya existe un tipo de documento con ese nombre.');
  });

  it('al corregir el nombre el error se va, y el alta sale', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await intentarCrear(user, 'Constancia ARCA');

    await user.type(panel.getByLabelText('Nombre'), ' 2');

    expect(panel.getByLabelText('Nombre')).not.toHaveAttribute('aria-invalid');
    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));
    await esperarAviso('Se creó el tipo Constancia ARCA 2. Ya está disponible para las matrices.');
  });
});

// ─── Edición ──────────────────────────────────────────────────────────────────

describe('TiposDocumentoPage: editar', () => {
  it('desde el nombre abre el panel con los datos actuales', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');

    const panel = await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');

    expect(panel.getByLabelText('Nombre')).toHaveValue('Constancia ARCA');
    expect(panel.getByLabelText('Descripción')).toHaveValue('Inscripción');
  });

  it('desde "Editar" del menú abre el mismo panel; sin descripción, el campo arranca vacío', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');

    await elegirAccion(user, 'Factura', 'Editar');

    const panel = within(await screen.findByRole('dialog', { name: 'Editar tipo de documento' }));
    expect(panel.getByLabelText('Nombre')).toHaveValue('Factura');
    expect(panel.getByLabelText('Descripción')).toHaveValue('');
  });

  it('sin cambios "Guardar cambios" está deshabilitado; modificar y volver al original lo deshabilita otra vez', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');
    const guardar = () => panel.getByRole('button', { name: 'Guardar cambios' });

    expect(guardar()).toBeDisabled();
    expect(panel.getByText('Sin cambios para guardar.')).toBeInTheDocument();

    await user.type(panel.getByLabelText('Descripción'), 'X');
    expect(guardar()).toBeEnabled();
    await user.type(panel.getByLabelText('Descripción'), '{Backspace}');
    expect(guardar()).toBeDisabled();
    expect(pedidos('PATCH')).toHaveLength(0);
  });

  it('envía solo la descripción si solo cambió la descripción; avisa y cierra', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');

    await user.clear(panel.getByLabelText('Descripción'));
    await user.type(panel.getByLabelText('Descripción'), 'De inscripción');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await esperarAviso('Se guardaron los cambios del tipo Constancia ARCA.');
    await waitFor(() => expect(panelDeEdicion()).not.toBeInTheDocument());
    expect(cuerpoDe('PATCH')).toStrictEqual({ descripcion: 'De inscripción' });
    const ruta = new URL(urlDe(pedidos('PATCH')[0]?.[0] ?? '')).pathname;
    expect(ruta).toBe(`/tipos-documento/${arca.id}`);
  });

  it('borrar la descripción envía descripcion: null', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');

    await user.clear(panel.getByLabelText('Descripción'));
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(pedidos('PATCH')).toHaveLength(1));
    expect(cuerpoDe('PATCH')).toStrictEqual({ descripcion: null });
  });

  it('cambiar solo las mayúsculas del propio nombre es una edición válida', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');

    await user.clear(panel.getByLabelText('Nombre'));
    await user.type(panel.getByLabelText('Nombre'), 'constancia arca');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await esperarAviso('Se guardaron los cambios del tipo constancia arca.');
    expect(cuerpoDe('PATCH')).toStrictEqual({ nombre: 'constancia arca' });
  });

  it('un nombre que ya tiene otro tipo queda marcado en el campo, sin cerrar', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Factura');

    await user.clear(panel.getByLabelText('Nombre'));
    await user.type(panel.getByLabelText('Nombre'), 'CONSTANCIA ARCA');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    const campo = panel.getByLabelText('Nombre');
    await waitFor(() => expect(errorDe(campo)).toBe('Ya existe «Constancia ARCA» en el catálogo.'));
    expect(panelDeEdicion()).toBeInTheDocument();
    expect(avisosDePagina()).toHaveLength(0);
  });

  it('edita un tipo desactivado y sigue desactivado', async () => {
    simularServidor([arca, print]);
    const { user } = renderPage('/clientes/tipos-documento?desactivados=1');
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Print');

    await user.type(panel.getByLabelText('Descripción'), 'Certificación');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    await esperarAviso('Se guardaron los cambios del tipo Print.');
    const fila = await screen.findByRole('row', { name: /^Print Certificación/ });
    expect(within(fila).getByText('Desactivado')).toBeInTheDocument();
  });

  it('si el tipo ya no existe lo dice, no deja volver a guardar, refresca el listado y se puede cerrar', async () => {
    const datos = simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Factura');
    datos.splice(
      datos.findIndex((tipo) => tipo.id === factura.id),
      1,
    );
    const lecturasAntes = pedidos('GET').length;

    await user.type(panel.getByLabelText('Descripción'), 'X');
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    expect(await panel.findByRole('alert')).toHaveTextContent(
      'Este tipo de documento ya no existe. Actualizá el listado para continuar.',
    );
    expect(panel.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await waitFor(() => expect(pedidos('GET').length).toBeGreaterThan(lecturasAntes));
    expect(avisosDePagina()).toHaveLength(0);

    await user.click(panel.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(panelDeEdicion()).not.toBeInTheDocument());
  });

  it('sin conexión conserva los datos y se puede reintentar', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const panel = await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');
    await user.type(panel.getByLabelText('Descripción'), ' 2');
    const servidor = fetchMock.getMockImplementation();
    siempreResponde('PATCH', () => Promise.reject(new TypeError('Failed to fetch')));

    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    expect(await panel.findByRole('alert')).toHaveTextContent('No pudimos guardar los cambios.');
    expect(panel.getByLabelText('Descripción')).toHaveValue('Inscripción 2');
    if (servidor) fetchMock.mockImplementation(servidor);
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));
    await esperarAviso('Se guardaron los cambios del tipo Constancia ARCA.');
  });
});

// ─── Desactivar y reactivar ───────────────────────────────────────────────────

describe('TiposDocumentoPage: desactivar y reactivar', () => {
  const confirmar = async (user: UserEvent, boton: string) =>
    user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: boton }));

  it('Desactivar pide confirmación con el nombre real y no llama a la API hasta confirmar', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');

    const dialogo = within(screen.getByRole('alertdialog'));
    expect(dialogo.getByText('¿Desactivar este tipo de documento?')).toBeInTheDocument();
    expect(
      dialogo.getByText(
        '«Constancia ARCA» dejará de estar disponible para configurar requisitos nuevos. Los clientes que ya lo tienen configurado seguirán solicitándolo en sus rendiciones. Podés reactivarlo cuando quieras.',
      ),
    ).toBeInTheDocument();
    expect(pedidos('PATCH')).toHaveLength(0);
  });

  it('Cancelar no cambia nada y el foco vuelve al ⋯ del tipo', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');
    await confirmar(user, 'Cancelar');

    await waitFor(() => expect(confirmacion()).not.toBeInTheDocument());
    expect(pedidos('PATCH')).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Acciones de Constancia ARCA' })).toHaveFocus(),
    );
  });

  it('al confirmar: PATCH { activo: false }, aviso, el tipo sale de los activos y el foco va al título', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');
    await confirmar(user, 'Desactivar tipo');

    await esperarAviso('Se desactivó Constancia ARCA. Ya no se ofrece para requisitos nuevos.');
    expect(cuerpoDe('PATCH')).toStrictEqual({ activo: false });
    await waitFor(() => expect(confirmacion()).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Constancia ARCA' })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(titulo()).toHaveFocus());
  });

  it('con desactivados incluidos, el tipo sigue en la lista como Desactivado y el filtro no cambia', async () => {
    simularServidor([arca, factura]);
    const { user, router } = renderPage('/clientes/tipos-documento?desactivados=1');
    await screen.findByRole('table');

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');
    await confirmar(user, 'Desactivar tipo');

    await esperarAviso('Se desactivó Constancia ARCA. Ya no se ofrece para requisitos nuevos.');
    const fila = screen.getByRole('row', { name: /^Constancia ARCA/ });
    await waitFor(() => expect(within(fila).getByText('Desactivado')).toBeInTheDocument());
    expect(router.state.location.search).toBe('?desactivados=1');
    expect(filtro()).toBeChecked();
  });

  it('Reactivar pide confirmación y, al confirmar, PATCH { activo: true } y aviso', async () => {
    simularServidor([arca, print]);
    const { user } = renderPage('/clientes/tipos-documento?desactivados=1');
    await screen.findByRole('table');

    await elegirAccion(user, 'Print', 'Reactivar');

    const dialogo = within(screen.getByRole('alertdialog'));
    expect(dialogo.getByText('¿Reactivar este tipo de documento?')).toBeInTheDocument();
    expect(
      dialogo.getByText(
        '«Print» volverá a estar disponible para configurar requisitos nuevos. Los requisitos existentes no se modificarán.',
      ),
    ).toBeInTheDocument();
    await confirmar(user, 'Reactivar tipo');

    await esperarAviso('Se reactivó Print. Ya está disponible para requisitos nuevos.');
    expect(cuerpoDe('PATCH')).toStrictEqual({ activo: true });
    const fila = screen.getByRole('row', { name: /^Print/ });
    await waitFor(() => expect(within(fila).getByText('Activo')).toBeInTheDocument());
  });

  it('el menú ofrece solo la acción que corresponde al estado', async () => {
    simularServidor([arca, print]);
    const { user } = renderPage('/clientes/tipos-documento?desactivados=1');
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Acciones de Print' }));
    const menu = within(await screen.findByRole('menu'));

    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Editar',
      'Reactivar',
    ]);
  });

  it('mientras procesa: "Desactivando…", sin cancelar ni repetir', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const seguir = enVuelo('PATCH');

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');
    await confirmar(user, 'Desactivar tipo');

    const dialogo = within(screen.getByRole('alertdialog'));
    const desactivando = dialogo.getByRole('button', { name: 'Desactivando…' });
    expect(desactivando).toHaveAttribute('aria-busy', 'true');
    expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.click(desactivando);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(confirmacion()).toBeInTheDocument();
    expect(pedidos('PATCH')).toHaveLength(1);

    seguir();

    await waitFor(() => expect(confirmacion()).not.toBeInTheDocument());
    expect(pedidos('PATCH')).toHaveLength(1);
  });

  it('si falla, el diálogo queda abierto con el error y se puede reintentar', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const servidor = fetchMock.getMockImplementation();
    const errorDelServidor = () => json({ error: { code: 'INTERNAL_ERROR' } }, 500);
    siempreResponde('PATCH', () => Promise.resolve(errorDelServidor()));

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');
    await confirmar(user, 'Desactivar tipo');

    const dialogo = within(screen.getByRole('alertdialog'));
    expect(await dialogo.findByRole('alert')).toHaveTextContent(
      'No pudimos desactivar el tipo de documento. Probá de nuevo en unos segundos.',
    );
    expect(avisosDePagina()).toHaveLength(0);

    if (servidor) fetchMock.mockImplementation(servidor);
    await confirmar(user, 'Desactivar tipo');
    await esperarAviso('Se desactivó Constancia ARCA. Ya no se ofrece para requisitos nuevos.');
  });

  it('si el tipo ya no existe, cierra el diálogo y lo avisa en la página, sin éxito', async () => {
    const datos = simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');

    await elegirAccion(user, 'Constancia ARCA', 'Desactivar');
    datos.splice(0, 1);
    await confirmar(user, 'Desactivar tipo');

    const aviso = await esperarAviso('Este tipo de documento ya no existe.');
    expect(aviso).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(confirmacion()).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Constancia ARCA' })).not.toBeInTheDocument(),
    );
  });
});

describe('TiposDocumentoListado: cambios de estado en curso', () => {
  const conFechas = (tipo: TipoJson) => ({
    ...tipo,
    creadoEn: new Date(tipo.creadoEn),
    actualizadoEn: new Date(tipo.actualizadoEn),
  });
  const tipos = [conFechas(arca), conFechas(factura)];
  const opcionDesactivar = async () =>
    within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Desactivar' });

  it('deshabilita Desactivar solo en el tipo con un cambio pendiente; los demás siguen disponibles', async () => {
    const user = userEvent.setup();
    render(
      <TiposDocumentoListado
        tipos={tipos}
        idsCambiandoEstado={[arca.id]}
        onEditar={vi.fn()}
        onDesactivar={vi.fn()}
        onReactivar={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Acciones de Constancia ARCA' }));
    expect(await opcionDesactivar()).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Acciones de Factura' }));
    expect(await opcionDesactivar()).not.toHaveAttribute('aria-disabled', 'true');
  });
});

// ─── Avisos ───────────────────────────────────────────────────────────────────

describe('TiposDocumentoPage: avisos', () => {
  it('un aviso nuevo reemplaza al anterior: nunca hay dos', async () => {
    simularServidor([arca, factura]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const alta = await abrirAlta(user);
    await user.type(alta.getByLabelText('Nombre'), 'OC');
    await user.click(alta.getByRole('button', { name: 'Crear tipo' }));
    await esperarAviso('Se creó el tipo OC. Ya está disponible para las matrices.');
    await waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());

    await elegirAccion(user, 'Factura', 'Desactivar');
    const dialogo = within(screen.getByRole('alertdialog'));
    await user.click(dialogo.getByRole('button', { name: 'Desactivar tipo' }));

    await esperarAviso('Se desactivó Factura. Ya no se ofrece para requisitos nuevos.');
    expect(avisosDePagina()).toHaveLength(1);
  });

  it('el éxito se anuncia como status; "Cerrar aviso" lo retira con su animación y el foco va al título', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const alta = await abrirAlta(user);
    await user.type(alta.getByLabelText('Nombre'), 'OC');
    await user.click(alta.getByRole('button', { name: 'Crear tipo' }));
    const aviso = await esperarAviso('Se creó el tipo OC. Ya está disponible para las matrices.');
    await waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());
    expect(aviso).toHaveAttribute('role', 'status');

    await user.click(within(aviso).getByRole('button', { name: 'Cerrar aviso' }));

    expect(aviso).toHaveAttribute('data-saliendo');
    expect(titulo()).toHaveFocus();
    fireEvent.animationEnd(aviso);
    expect(avisosDePagina()).toHaveLength(0);
  });

  it('abrir otra acción retira el aviso anterior', async () => {
    simularServidor([arca]);
    const { user } = renderPage();
    await screen.findByRole('table');
    const alta = await abrirAlta(user);
    await user.type(alta.getByLabelText('Nombre'), 'OC');
    await user.click(alta.getByRole('button', { name: 'Crear tipo' }));
    await esperarAviso('Se creó el tipo OC. Ya está disponible para las matrices.');
    await waitFor(() => expect(panelDeAlta()).not.toBeInTheDocument());

    await abrirEdicionDesdeElNombre(user, 'Constancia ARCA');

    expect(avisosDePagina()).toHaveLength(0);
  });
});
