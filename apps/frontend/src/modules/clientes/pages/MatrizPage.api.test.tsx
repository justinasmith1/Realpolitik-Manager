// Matriz de punta a punta: la página (jsdom) → HTTP → backend real → PostgreSQL.
// No mockea fetch ni escribe en realpolitik_db.
//
// Sin TEST_API_URL se salta. Con la variable, TEST_DATABASE_URL debe ser realpolitik_test en
// un entorno autorizado (127.0.0.1:5433 en local o localhost:5432 en GitHub Actions) y la API
// de prueba no puede estar en el puerto 3000.
//
//   TEST_API_URL=http://127.0.0.1:3999 \
//   TEST_DATABASE_URL="postgresql://…@127.0.0.1:5433/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/frontend test:api
//
// Limpia solo los clientes y tipos que crea. Borra clientes primero: los requisitos caen
// en cascada y el tipo tiene ON DELETE RESTRICT. No crea rendiciones ni corre el seed.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  ClienteSchema,
  TipoDocumentoSchema,
  validateCuit,
  type Cliente,
} from '@realpolitik/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { crearQueryClient } from '@/app/providers';
import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';
import { elegirOpcion } from '@/test/select';

import { exigirBaseDeEstaSuite } from '../../../../../backend/src/modules/clientes/__tests__/requisitosIntegrationEntorno';

vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const API = process.env.TEST_API_URL ?? (import.meta.env.TEST_API_URL as string | undefined);
const MARCA = `HU22${Date.now().toString(36)}`.toUpperCase();
const BACKEND = resolve(process.cwd(), '../backend');
const fetchReal = globalThis.fetch.bind(globalThis);
const ESPERA = { timeout: 15_000 };

const clientesCreados: string[] = [];
const tiposCreados: string[] = [];

function ejecutar(script: string, args: readonly string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: BACKEND,
    env: process.env,
    encoding: 'utf8',
  }).trim();
}

function borrarClientes(ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  return Number(ejecutar('src/modules/clientes/__tests__/borrarClientesDeTest.ts', ids));
}

function borrarTipos(ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  return Number(
    ejecutar('src/modules/tipos-documento/__tests__/borrarTiposDocumentoDeTest.ts', ids),
  );
}

function leerRequisito(id: string) {
  return JSON.parse(ejecutar('src/modules/clientes/__tests__/leerRequisitoDeTest.ts', [id])) as {
    isDeleted: boolean;
    deletedAt: string | null;
    matrizConfigurada: boolean;
  };
}

function exigirDestino(): void {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error('Con TEST_API_URL hace falta TEST_DATABASE_URL de realpolitik_test.');
  }
  exigirBaseDeEstaSuite(base);
  if (API === undefined) return;
  const api = new URL(API);
  if (api.port === '3000') {
    throw new Error('TEST_API_URL apunta al puerto 3000, el backend de desarrollo. No se escribe.');
  }
  const comprobacion = JSON.parse(
    ejecutar('src/modules/clientes/__tests__/leerRequisitoDeTest.ts', ['--comprobar']),
  ) as { db: string; version: string };
  if (comprobacion.db !== 'realpolitik_test' || !comprobacion.version.startsWith('PostgreSQL 16')) {
    throw new Error(
      `La base conectada no es PostgreSQL 16 sobre realpolitik_test (db=${comprobacion.db}).`,
    );
  }
}

function cuitUnico(): string {
  for (;;) {
    const cuerpo = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador += 1) {
      if (validateCuit(`27${cuerpo}${verificador}`)) return `27-${cuerpo}-${verificador}`;
    }
  }
}

async function api(ruta: string, init?: RequestInit): Promise<unknown> {
  const respuesta = await fetchReal(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!respuesta.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${ruta}: HTTP ${respuesta.status} ${await respuesta.text()}`,
    );
  }
  if (respuesta.status === 204) return undefined;
  return respuesta.json();
}

async function crearCliente(): Promise<Cliente> {
  const creado = await api('/clientes', {
    method: 'POST',
    body: JSON.stringify({
      razonSocial: `${MARCA} Razon ${Math.random().toString(36).slice(2, 6)}`,
      denominacion: `${MARCA} M`,
      cuit: cuitUnico(),
      sector: 'PRIVADO',
      ivaCondicion: 'EXENTO',
      emailContacto: 'hu22@ejemplo.example',
    }),
  });
  const id = (creado as { id: string }).id;
  clientesCreados.push(id);
  return ClienteSchema.parse(creado);
}

async function crearTipo(nombre: string): Promise<{ id: string; nombre: string }> {
  const creado = await api('/tipos-documento', {
    method: 'POST',
    body: JSON.stringify({ nombre }),
  });
  const tipo = TipoDocumentoSchema.parse(creado);
  tiposCreados.push(tipo.id);
  return tipo;
}

function renderMatriz(clienteId: string) {
  const router = createMemoryRouter([{ path: '/clientes/:id/matriz', element: <MatrizPage /> }], {
    initialEntries: [`/clientes/${clienteId}/matriz`],
  });
  render(
    <QueryClientProvider client={crearQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return userEvent.setup({ delay: null });
}

async function panel(nombre: string) {
  const titulo = await screen.findByRole('heading', { name: nombre }, ESPERA);
  const dialogo = titulo.closest('[role="dialog"]');
  if (!(dialogo instanceof HTMLElement)) throw new Error(`No está el panel ${nombre}`);
  return dialogo;
}

describe.skipIf(API === undefined)('MatrizPage contra la API real', () => {
  const espia = vi.fn<typeof fetch>((...args) => fetchReal(...args));

  beforeAll(() => {
    exigirDestino();
  });

  afterAll(() => {
    const clientes = borrarClientes(clientesCreados);
    const tipos = borrarTipos(tiposCreados);
    expect(clientes).toBe(clientesCreados.length);
    expect(tipos).toBe(tiposCreados.length);
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

  it('crea, edita días ordenados, da de baja y actualiza la matriz en PostgreSQL', async () => {
    const cliente = await crearCliente();
    const tipo = await crearTipo(`${MARCA} Acta`);
    const user = renderMatriz(cliente.id);

    expect(
      await screen.findByRole('heading', { level: 1, name: cliente.denominacion }, ESPERA),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin requisitos configurados')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }, ESPERA));
    const alta = await panel('Agregar requisito');
    const selector = await within(alta).findByRole(
      'combobox',
      { name: 'Tipo de documento' },
      ESPERA,
    );
    await elegirOpcion(user, selector, tipo.nombre);
    const cantidad = within(alta).getByLabelText('Cantidad requerida');
    await user.clear(cantidad);
    await user.type(cantidad, '2');
    await user.click(within(alta).getByRole('button', { name: 'Indicar días aproximados' }));
    await user.type(within(alta).getByLabelText('Día 1'), '20');
    await user.type(within(alta).getByLabelText('Día 2'), '5');
    await user.click(within(alta).getByRole('button', { name: 'Agregar requisito' }));

    expect(
      await screen.findByText(`Se agregó ${tipo.nombre} a la matriz.`, {}, ESPERA),
    ).toBeInTheDocument();
    expect(await screen.findByText('5, 20', {}, ESPERA)).toBeInTheDocument();
    expect(screen.getByText('Con requisitos')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Acciones de ${tipo.nombre}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const edicion = await panel('Editar requisito');
    const dia1 = within(edicion).getByLabelText('Día 1');
    const dia2 = within(edicion).getByLabelText('Día 2');
    await user.clear(dia1);
    await user.type(dia1, '9');
    await user.clear(dia2);
    await user.type(dia2, '3');
    await user.click(within(edicion).getByRole('button', { name: 'Guardar cambios' }));

    expect(
      await screen.findByText(`Se guardaron los cambios de ${tipo.nombre}.`, {}, ESPERA),
    ).toBeInTheDocument();
    expect(await screen.findByText('3, 9', {}, ESPERA)).toBeInTheDocument();

    const guardado = (await api(`/clientes/${cliente.id}/requisitos`)) as { id: string }[];
    const requisitoId = guardado[0]?.id;
    if (requisitoId === undefined) throw new Error('El requisito no quedó en la API.');
    expect(leerRequisito(requisitoId)).toMatchObject({ isDeleted: false, matrizConfigurada: true });

    await user.click(screen.getByRole('button', { name: `Acciones de ${tipo.nombre}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de la matriz' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: /Quitar este requisito/ })).getByRole(
        'button',
        {
          name: 'Quitar de la matriz',
        },
      ),
    );

    expect(
      await screen.findByRole(
        'heading',
        { name: 'Esta matriz todavía no tiene requisitos' },
        ESPERA,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Sin requisitos configurados')).toBeInTheDocument();
    const baja = leerRequisito(requisitoId);
    expect(baja.isDeleted).toBe(true);
    expect(baja.deletedAt).not.toBeNull();
    expect(baja.matrizConfigurada).toBe(false);
  }, 30_000);

  it('un duplicado con el formulario abierto no cierra el panel', async () => {
    const cliente = await crearCliente();
    const tipo = await crearTipo(`${MARCA} Factura`);
    const user = renderMatriz(cliente.id);
    await user.click(await screen.findByRole('button', { name: 'Agregar requisito' }, ESPERA));
    const alta = await panel('Agregar requisito');
    const selector = await within(alta).findByRole(
      'combobox',
      { name: 'Tipo de documento' },
      ESPERA,
    );
    await elegirOpcion(user, selector, tipo.nombre);

    await api(`/clientes/${cliente.id}/requisitos`, {
      method: 'POST',
      body: JSON.stringify({ tipoDocumentoId: tipo.id, cantidad: 4 }),
    });
    await user.click(within(alta).getByRole('button', { name: 'Agregar requisito' }));

    expect(
      await within(alta).findByText(
        /ya tiene un requisito activo para ese tipo \(cantidad 4\)/,
        {},
        ESPERA,
      ),
    ).toBeInTheDocument();
    expect(alta).toBeInTheDocument();
  }, 20_000);

  it('un cliente inactivo se lee y no ofrece alta, edición ni baja', async () => {
    const cliente = await crearCliente();
    const tipo = await crearTipo(`${MARCA} Print`);
    await api(`/clientes/${cliente.id}/requisitos`, {
      method: 'POST',
      body: JSON.stringify({ tipoDocumentoId: tipo.id }),
    });
    await api(`/clientes/${cliente.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: 'INACTIVO' }),
    });

    renderMatriz(cliente.id);

    expect(await screen.findByText(tipo.nombre, {}, ESPERA)).toBeInTheDocument();
    expect(
      screen.getByText('Este cliente debe estar activo para modificar su matriz.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /agregar|quitar|editar requisito/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Acciones de ${tipo.nombre}` }),
    ).not.toBeInTheDocument();
  }, 20_000);
});
