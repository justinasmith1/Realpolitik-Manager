// Catálogo de tipos de documento de punta a punta: la página (jsdom, no un navegador) → HTTP →
// backend real → PostgreSQL. No mockea fetch.
//
// Opcional: sin `TEST_API_URL` se salta. El backend tiene que estar levantado contra la MISMA
// base descartable que `TEST_DATABASE_URL` (nombre `*_audit` o `*_test`), en un puerto que no
// sea el de desarrollo (3000). Localmente esa base es `realpolitik_test` en 127.0.0.1:5433 y
// el backend de prueba escucha en 3999. En CI el puerto de Postgres lo define el workflow.
//
//   TEST_API_URL=http://127.0.0.1:3999 TEST_DATABASE_URL="postgresql://…/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/frontend test:api
//
// LIMPIEZA: la API no tiene DELETE. Cada tipo que crea este archivo se registra por id y, al
// terminar (pase o falle), se borra con `borrarTiposDocumentoDeTest`. Ese script se niega a
// operar fuera de `*_audit` / `*_test` y solo borra los ids que recibe. La marca del nombre es
// exclusiva de esta ejecución, para no confundirlos con tipos ajenos.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { TipoDocumentoSchema, type TipoDocumento } from '@realpolitik/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { crearQueryClient } from '@/app/providers';
import { TiposDocumentoPage } from '@/modules/tipos-documento/pages/TiposDocumentoPage';

// La pausa de 500 ms se prueba en los tests de éxito. Acá el tema es la ida y vuelta real.
vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const API = import.meta.env.TEST_API_URL as string | undefined;
const MARCA = `HU21${Date.now().toString(36)}`;
const NOMBRE_EXISTENTE = `${MARCA} Visible`;
const NOMBRE_NUEVO = `${MARCA} Acta`;
const NOMBRE_EQUIVALENTE = `${MARCA.toLowerCase()}  acta`;
const DESCRIPCION = 'Nota de la prueba de HU2.1';
const DESCRIPCION_EDITADA = 'Nota editada por la prueba';

/** Ids creados por este archivo. Es lo único que se borra. */
const idsCreados: string[] = [];

const BACKEND = resolve(process.cwd(), '../backend');
const fetchReal = globalThis.fetch.bind(globalThis);

function borrarTipos(ids: readonly string[]): number {
  const salida = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/modules/tipos-documento/__tests__/borrarTiposDocumentoDeTest.ts',
      ...ids,
    ],
    { cwd: BACKEND, env: process.env, encoding: 'utf8' },
  );
  return Number(salida.trim());
}

function afirmarDestinoDescartable(): void {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error(
      'Con TEST_API_URL hace falta TEST_DATABASE_URL (la base descartable de esa API) para limpiar los tipos que el test crea.',
    );
  }
  const url = new URL(base);
  const nombre = url.pathname.replace(/^\//, '');
  if (nombre === 'realpolitik_db' || !/_(audit|test)$/.test(nombre)) {
    throw new Error(
      `TEST_DATABASE_URL apunta a "${nombre}": solo se permiten bases descartables (*_audit o *_test).`,
    );
  }
  if (API === undefined) return;
  const api = new URL(API);
  if (api.port === '3000') {
    throw new Error(
      'TEST_API_URL apunta al puerto 3000, el backend de desarrollo. No se escribe nada.',
    );
  }
}

async function api(ruta: string, init?: RequestInit): Promise<unknown> {
  const respuesta = await fetchReal(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!respuesta.ok) throw new Error(`${ruta}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

async function listarTodos(): Promise<TipoDocumento[]> {
  return TipoDocumentoSchema.array().parse(await api('/tipos-documento?incluirInactivos=true'));
}

function registrar(id: string): void {
  if (!idsCreados.includes(id)) idsCreados.push(id);
}

async function porNombre(nombre: string): Promise<TipoDocumento> {
  const encontrado = (await listarTodos()).find((tipo) => tipo.nombre === nombre);
  if (encontrado === undefined) throw new Error(`No está en la base: ${nombre}`);
  registrar(encontrado.id);
  return encontrado;
}

/** La confirmación de éxito espera 500 ms y después hay un ida y vuelta real. */
const ESPERA_RED = { timeout: 8_000 };

function renderPagina() {
  const router = createMemoryRouter([{ path: '/documentos', element: <TiposDocumentoPage /> }], {
    initialEntries: ['/documentos'],
  });
  render(
    <QueryClientProvider client={crearQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup({ delay: null });
}

const filaDe = (nombre: string) =>
  screen.findByRole('row', { name: new RegExp(escapar(nombre)) }, ESPERA_RED);

/** Aviso de la página, no el de un panel. El párrafo «Actualizando…» también es `status`. */
async function avisoDe(fragmento: string): Promise<HTMLElement> {
  let encontrado: HTMLElement | undefined;
  await vi.waitFor(() => {
    const avisos = Array.from(document.querySelectorAll('[data-slot="alert"]')).filter(
      (aviso) => aviso.closest('[role="dialog"], [role="alertdialog"]') === null,
    );
    encontrado = avisos.find((aviso) => aviso.textContent?.includes(fragmento)) as
      HTMLElement | undefined;
    expect(encontrado).toBeTruthy();
  }, ESPERA_RED);
  if (encontrado === undefined) throw new Error(`No apareció el aviso: ${fragmento}`);
  return encontrado;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Red real + jsdom. El default de 5 s se queda corto en esta máquina sin ser un cuelgue. */
const caso = (nombre: string, cuerpo: () => Promise<void>) => it(nombre, cuerpo, 20_000);

describe.skipIf(API === undefined)('TiposDocumentoPage contra la API real', () => {
  const espia = vi.fn<typeof fetch>((...args) => fetchReal(...args));

  beforeAll(async () => {
    afirmarDestinoDescartable();
    const crudo = (await api('/tipos-documento', {
      method: 'POST',
      body: JSON.stringify({ nombre: NOMBRE_EXISTENTE, descripcion: null }),
    })) as { id: string };
    registrar(crudo.id);
    TipoDocumentoSchema.parse(crudo);
  });

  afterAll(async () => {
    // También los que la interfaz creó si el test se cortó antes de anotar el id.
    for (const tipo of await listarTodos()) {
      if (tipo.nombre.toLowerCase().includes(MARCA.toLowerCase())) registrar(tipo.id);
    }
    if (idsCreados.length === 0) return;
    const borrados = borrarTipos(idsCreados);
    expect(borrados).toBe(idsCreados.length);
  });

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', API ?? '');
    vi.stubGlobal('fetch', espia);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    espia.mockClear();
  });

  caso('muestra un tipo que ya está en la base, con su nombre y estado', async () => {
    renderPagina();

    const fila = await filaDe(NOMBRE_EXISTENTE);
    expect(within(fila).getByRole('button', { name: NOMBRE_EXISTENTE })).toBeInTheDocument();
    expect(within(fila).getByText('Activo')).toBeInTheDocument();
  });

  caso('crea un tipo desde el formulario y queda persistido', async () => {
    const user = renderPagina();
    await screen.findByRole('button', { name: NOMBRE_EXISTENTE });

    await user.click(screen.getByRole('button', { name: 'Nuevo tipo' }));
    const panel = within(screen.getByRole('dialog', { name: 'Nuevo tipo de documento' }));
    await user.type(panel.getByLabelText('Nombre'), NOMBRE_NUEVO);
    await user.type(panel.getByLabelText('Descripción'), DESCRIPCION);
    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    expect(await avisoDe(`Se creó el tipo ${NOMBRE_NUEVO}`)).toBeInTheDocument();
    const guardado = await porNombre(NOMBRE_NUEVO);
    expect(guardado.descripcion).toBe(DESCRIPCION);
    expect(guardado.activo).toBe(true);
    expect(espia.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    expect(within(await filaDe(NOMBRE_NUEVO)).getByText('Activo')).toBeInTheDocument();
  });

  caso('edita solo la descripción y conserva el nombre y el id', async () => {
    const idAntes = (await porNombre(NOMBRE_NUEVO)).id;
    const user = renderPagina();
    await user.click(await screen.findByRole('button', { name: NOMBRE_NUEVO }));
    const panel = within(screen.getByRole('dialog', { name: 'Editar tipo de documento' }));
    const descripcion = panel.getByLabelText('Descripción');
    await user.clear(descripcion);
    await user.type(descripcion, DESCRIPCION_EDITADA);
    await user.click(panel.getByRole('button', { name: 'Guardar cambios' }));

    expect(await avisoDe(`Se guardaron los cambios del tipo ${NOMBRE_NUEVO}`)).toBeInTheDocument();
    const guardado = await porNombre(NOMBRE_NUEVO);
    expect(guardado.id).toBe(idAntes);
    expect(guardado.nombre).toBe(NOMBRE_NUEVO);
    expect(guardado.descripcion).toBe(DESCRIPCION_EDITADA);
  });

  caso('un nombre equivalente muestra el conflicto y no duplica el registro', async () => {
    const user = renderPagina();
    await screen.findByRole('button', { name: NOMBRE_NUEVO });
    const antes = (await listarTodos()).filter((tipo) => tipo.nombre === NOMBRE_NUEVO).length;

    await user.click(screen.getByRole('button', { name: 'Nuevo tipo' }));
    const panel = within(screen.getByRole('dialog', { name: 'Nuevo tipo de documento' }));
    await user.type(panel.getByLabelText('Nombre'), NOMBRE_EQUIVALENTE);
    await user.click(panel.getByRole('button', { name: 'Crear tipo' }));

    expect(
      await panel.findByText(`Ya existe «${NOMBRE_NUEVO}» en el catálogo.`),
    ).toBeInTheDocument();
    const despues = (await listarTodos()).filter((tipo) => tipo.nombre === NOMBRE_NUEVO);
    expect(despues).toHaveLength(antes);
    expect(despues).toHaveLength(1);
  });

  caso('desactiva el tipo creado y la base y el listado de activos lo reflejan', async () => {
    const user = renderPagina();
    await user.click(await screen.findByRole('button', { name: `Acciones de ${NOMBRE_NUEVO}` }));
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Desactivar' }),
    );
    const dialogo = within(screen.getByRole('alertdialog'));
    await user.click(dialogo.getByRole('button', { name: 'Desactivar tipo' }));

    expect(await avisoDe(`Se desactivó ${NOMBRE_NUEVO}`)).toBeInTheDocument();
    await vi.waitFor(
      () => expect(screen.queryByRole('button', { name: NOMBRE_NUEVO })).not.toBeInTheDocument(),
      ESPERA_RED,
    );
    const guardado = await porNombre(NOMBRE_NUEVO);
    expect(guardado.activo).toBe(false);
    expect(guardado.descripcion).toBe(DESCRIPCION_EDITADA);
  });

  caso('con el filtro de desactivados, reactivar lo vuelve a mostrar como activo', async () => {
    const user = renderPagina();
    await user.click(screen.getByRole('checkbox', { name: 'Incluir desactivados' }));

    const filaInactiva = await filaDe(NOMBRE_NUEVO);
    expect(within(filaInactiva).getByText('Desactivado')).toBeInTheDocument();

    await user.click(
      within(filaInactiva).getByRole('button', { name: `Acciones de ${NOMBRE_NUEVO}` }),
    );
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Reactivar' }),
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reactivar tipo' }),
    );

    expect(await avisoDe(`Se reactivó ${NOMBRE_NUEVO}`)).toBeInTheDocument();
    expect(within(await filaDe(NOMBRE_NUEVO)).getByText('Activo')).toBeInTheDocument();
    const guardado = await porNombre(NOMBRE_NUEVO);
    expect(guardado.activo).toBe(true);
    expect(guardado.nombre).toBe(NOMBRE_NUEVO);
    expect(guardado.descripcion).toBe(DESCRIPCION_EDITADA);
  });
});
