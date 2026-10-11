// La edición de punta a punta contra la API y PostgreSQL REALES: formulario → PATCH → backend →
// base. Prueba lo que los mocks no pueden: que el pedido que arma el formulario lleva solo lo
// modificado y que, con dos editores, el que guarda sobre un dato viejo no pisa lo que cambió
// el otro.
//
// Opcional: sin `TEST_API_URL` se salta. Hace falta un backend levantado contra una base
// DESCARTABLE (nunca la de desarrollo) y la URL de esa MISMA base en `TEST_DATABASE_URL`:
//
//   # backend, en otra terminal
//   DATABASE_URL="postgresql://…/realpolitik_audit?schema=public" PORT=3999 \
//     CORS_ORIGINS=http://localhost:5173 pnpm --filter @realpolitik/backend exec tsx src/server.ts
//   # frontend
//   TEST_API_URL=http://localhost:3999 \
//   TEST_DATABASE_URL="postgresql://…/realpolitik_audit?schema=public" \
//     pnpm --filter @realpolitik/frontend exec vitest run api.test
//
// LIMPIEZA: la API no tiene un DELETE público, así que cada cliente que el test crea se registra
// por id y, al terminar (pase o falle), se borra con sus contactos directo en la base, con el
// script del backend `borrarClientesDeTest`. Ese script se niega a operar si la base no termina en
// `_audit` o `_test`. Si lo borrado no coincide con lo creado, el test falla: o la API apunta a
// otra base que `TEST_DATABASE_URL`, o algo no se limpió.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { ClienteSchema, validateCuit, type Cliente } from '@realpolitik/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { crearQueryClient } from '@/app/providers';
import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';

const API = import.meta.env.TEST_API_URL as string | undefined;
const MARCA = `TESTF${Date.now().toString(36).toUpperCase()}`;

/** Ids de TODO cliente que este archivo crea: es lo único que se borra al terminar. */
const clientesCreados: string[] = [];

// Vitest corre con la raíz del frontend como directorio de trabajo.
const BACKEND = resolve(process.cwd(), '../backend');

/**
 * Borra `ids` (y sus contactos) directo en la base descartable y devuelve cuántos clientes
 * borró. El script aplica la guarda de bases `*_audit` / `*_test`.
 */
function borrarClientes(ids: readonly string[]): number {
  const salida = execFileSync(
    process.execPath,
    ['--import', 'tsx', 'src/modules/clientes/__tests__/borrarClientesDeTest.ts', ...ids],
    { cwd: BACKEND, env: process.env, encoding: 'utf8' },
  );
  return Number(salida.trim());
}

/** CUIT válido (Módulo 11) para no chocar con otros clientes de la base. */
function cuitUnico(): string {
  for (;;) {
    const cuerpo = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    for (let verificador = 0; verificador <= 9; verificador++) {
      if (validateCuit(`27${cuerpo}${verificador}`)) return `27-${cuerpo}-${verificador}`;
    }
  }
}

// El `fetch` real, sin pasar por el espía, para preparar y verificar los datos.
const fetchReal = globalThis.fetch.bind(globalThis);

async function api(ruta: string, init?: RequestInit): Promise<unknown> {
  const respuesta = await fetchReal(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!respuesta.ok) throw new Error(`${ruta}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

async function crearCliente(): Promise<Cliente> {
  const creado = await api('/clientes', {
    method: 'POST',
    body: JSON.stringify({
      razonSocial: `${MARCA} Original ${Math.random().toString(36).slice(2, 7)}`,
      denominacion: `${MARCA} original`,
      cuit: cuitUnico(),
      sector: 'PRIVADO',
      ivaCondicion: 'EXENTO',
      emailContacto: 'original@ejemplo.example',
    }),
  });
  // Se registra antes de validar la respuesta: si el parseo falla, igual se limpia.
  clientesCreados.push((creado as { id: string }).id);
  return ClienteSchema.parse(creado);
}

/** El cliente tal como está guardado ahora (la API no tiene GET por id: se busca por CUIT). */
async function guardado(cliente: Cliente): Promise<Cliente> {
  const lista = ClienteSchema.array().parse(
    await api(`/clientes?q=${encodeURIComponent(cliente.cuit)}`),
  );
  const encontrado = lista.find((c) => c.id === cliente.id);
  if (encontrado === undefined) throw new Error('No se encontró el cliente guardado');
  return encontrado;
}

/** Abre la edición con `cliente` (la copia que tiene esta persona), cambia el email y guarda. */
async function editarEmail(cliente: Cliente, email: string) {
  const onActualizado = vi.fn();
  render(
    <QueryClientProvider client={crearQueryClient()}>
      <EditarClienteSheet
        cliente={cliente}
        onClose={() => undefined}
        onActualizado={onActualizado}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Email de contacto'));
  await user.type(screen.getByLabelText('Email de contacto'), email);
  await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  await vi.waitFor(() => expect(onActualizado).toHaveBeenCalledTimes(1), { timeout: 5000 });
}

describe.skipIf(API === undefined)('EditarClienteSheet contra la API real', () => {
  const espia = vi.fn<typeof fetch>((...args) => fetchReal(...args));

  beforeAll(() => {
    // Antes de crear nada: sin una base descartable donde limpiar, el test no corre. Es la
    // misma guarda del script de limpieza, pero ese solo actuaría DESPUÉS de haber creado.
    const base = process.env.TEST_DATABASE_URL;
    if (!base) {
      throw new Error(
        'Con TEST_API_URL hace falta TEST_DATABASE_URL (la base descartable de esa API) para limpiar los clientes que el test crea.',
      );
    }
    const nombre = new URL(base).pathname.replace(/^\//, '');
    if (!/_(audit|test)$/.test(nombre)) {
      throw new Error(
        `TEST_DATABASE_URL apunta a "${nombre}": solo se permiten bases descartables (*_audit o *_test).`,
      );
    }
  });

  afterAll(() => {
    if (clientesCreados.length === 0) return;
    const borrados = borrarClientes(clientesCreados);
    expect(borrados).toBe(clientesCreados.length);
  });

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', API ?? '');
    vi.stubGlobal('fetch', espia);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    espia.mockClear();
  });

  const cuerpoDelPatch = () => {
    const patch = espia.mock.calls.find(([, init]) => init?.method === 'PATCH');
    return JSON.parse(patch?.[1]?.body as string) as unknown;
  };

  it('cambiar solo el email manda solo el email, y en la base el resto queda igual', async () => {
    const cliente = await crearCliente();

    await editarEmail(cliente, 'solo.email@ejemplo.example');

    expect(cuerpoDelPatch()).toEqual({ emailContacto: 'solo.email@ejemplo.example' });
    const enLaBase = await guardado(cliente);
    expect(enLaBase.emailContacto).toBe('solo.email@ejemplo.example');
    expect(enLaBase.razonSocial).toBe(cliente.razonSocial);
    expect(enLaBase.denominacion).toBe(cliente.denominacion);
    expect(enLaBase.cuit).toBe(cliente.cuit);
  });

  it('dos editores: A guarda el email sobre una copia vieja y la razón social que cambió B se conserva', async () => {
    const copiaDeA = await crearCliente();
    // Mientras A tiene el panel abierto, B cambia la razón social.
    const razonSocialDeB = `${MARCA} Cambiada por B`;
    await api(`/clientes/${copiaDeA.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ razonSocial: razonSocialDeB }),
    });

    await editarEmail(copiaDeA, 'de.a@ejemplo.example');

    expect(cuerpoDelPatch()).toEqual({ emailContacto: 'de.a@ejemplo.example' });
    const enLaBase = await guardado(copiaDeA);
    expect(enLaBase.razonSocial).toBe(razonSocialDeB);
    expect(enLaBase.emailContacto).toBe('de.a@ejemplo.example');
  });
});
