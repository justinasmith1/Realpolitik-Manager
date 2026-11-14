// CONSULTA contra la API real (HU4.3): una cuenta CONSULTA de verdad (creada con el script de
// cuentas de prueba, sesión por `POST /auth/login`) → backend → PostgreSQL. Sin mocks de fetch.
//
// Sin TEST_API_URL se salta. Con la variable, TEST_DATABASE_URL tiene que ser realpolitik_test,
// la API de prueba no puede estar en el puerto 3000 y el backend tiene que usar esa misma base:
//
//   TEST_API_URL=http://127.0.0.1:3999 \
//   TEST_DATABASE_URL="postgresql://…/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/frontend test:api
//
// Dos cuentas, cada una con su sesión y su cookie: una ADMINISTRATIVO que solo prepara el cliente
// de prueba, y la CONSULTA que se prueba. Ninguna es ADMINISTRADOR ni la cuenta de QA manual. Al
// terminar se borran las dos (con sus sesiones) y el cliente creado; nada más.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { validateCuit } from '@realpolitik/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { crearQueryClient } from '@/app/providers';
import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { sesionDeApi } from '@/test/sesionDeApi';

import { exigirBaseDeEstaSuite } from '../../../../../backend/src/modules/clientes/__tests__/requisitosIntegrationEntorno';

const API = process.env.TEST_API_URL ?? (import.meta.env.TEST_API_URL as string | undefined);
const BACKEND = resolve(process.cwd(), '../backend');
const MARCA = `HU43${Date.now().toString(36)}`.toUpperCase();
const UUID_AJENO = '0b0b0b0b-0000-4000-8000-000000000001';

const administrativo = sesionDeApi(API);
const consulta = sesionDeApi(API, { rol: 'CONSULTA' });
const clientesCreados: string[] = [];
let clienteId = '';

function ejecutar(script: string, args: readonly string[]): string {
  return execFileSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: BACKEND,
    env: process.env,
    encoding: 'utf8',
  }).trim();
}

function exigirDestino(): void {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('Con TEST_API_URL hace falta TEST_DATABASE_URL de realpolitik_test.');
  exigirBaseDeEstaSuite(base);
  if (API !== undefined && new URL(API).port === '3000') {
    throw new Error('TEST_API_URL apunta al puerto 3000, el backend de desarrollo. No se escribe.');
  }
  const { db } = JSON.parse(
    ejecutar('src/modules/clientes/__tests__/leerRequisitoDeTest.ts', ['--comprobar']),
  ) as { db: string };
  if (db !== 'realpolitik_test') {
    throw new Error(`La base conectada no es realpolitik_test (db=${db}).`);
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

/** Un pedido con la sesión de `quien`: devuelve el status y el cuerpo (o `null`). */
async function pedir(
  quien: ReturnType<typeof sesionDeApi>,
  ruta: string,
  init: RequestInit = {},
): Promise<{ status: number; cuerpo: unknown }> {
  const respuesta = await quien.fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const texto = await respuesta.text();
  let cuerpo: unknown = null;
  try {
    cuerpo = texto === '' ? null : JSON.parse(texto);
  } catch {
    cuerpo = texto;
  }
  return { status: respuesta.status, cuerpo };
}

const motivoDe = (cuerpo: unknown) =>
  (cuerpo as { error?: { details?: { motivo?: string } } } | null)?.error?.details?.motivo;

describe.skipIf(API === undefined)('CONSULTA contra la API real (HU4.3)', () => {
  beforeAll(async () => {
    exigirDestino();
    await administrativo.iniciar();
    await consulta.iniciar();
    const alta = await pedir(administrativo, '/clientes', {
      method: 'POST',
      body: JSON.stringify({
        razonSocial: `${MARCA} Cliente de consulta`,
        denominacion: `${MARCA} C`,
        cuit: cuitUnico(),
        sector: 'PRIVADO',
        ivaCondicion: 'EXENTO',
        emailContacto: 'hu43@ejemplo.example',
      }),
    });
    expect(alta.status).toBe(201);
    clienteId = (alta.cuerpo as { id: string }).id;
    clientesCreados.push(clienteId);
    const notas = await pedir(administrativo, `/clientes/${clienteId}/observaciones`, {
      method: 'PUT',
      body: JSON.stringify({ observaciones: `${MARCA} nota interna` }),
    });
    expect(notas.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    try {
      if (clientesCreados.length > 0) {
        const borrados = Number(
          ejecutar('src/modules/clientes/__tests__/borrarClientesDeTest.ts', clientesCreados),
        );
        expect(borrados).toBe(clientesCreados.length);
      }
    } finally {
      await consulta.cerrar();
      await administrativo.cerrar();
    }
  }, 60_000);

  it('GET /auth/sesion devuelve el rol CONSULTA, con contraseña definitiva', async () => {
    const { status, cuerpo } = await pedir(consulta, '/auth/sesion');

    expect(status).toBe(200);
    expect(cuerpo).toMatchObject({ usuario: { rol: 'CONSULTA', debeCambiarPassword: false } });
  });

  it('lee clientes, ficha, contactos, observaciones, requisitos, tipos y rendiciones (200)', async () => {
    const rutas = [
      '/clientes',
      `/clientes/${clienteId}`,
      `/clientes/${clienteId}/contactos`,
      `/clientes/${clienteId}/observaciones`,
      `/clientes/${clienteId}/requisitos`,
      `/clientes/${clienteId}/indicaciones-armado`,
      `/clientes/${clienteId}/rendiciones`,
      '/tipos-documento',
      '/rendiciones?anio=2026&mes=10',
      '/rendiciones/atrasadas',
    ];
    for (const ruta of rutas) {
      expect((await pedir(consulta, ruta)).status, ruta).toBe(200);
    }
    expect((await pedir(consulta, `/clientes/${clienteId}/observaciones`)).cuerpo).toEqual({
      observaciones: `${MARCA} nota interna`,
    });
  });

  it('toda escritura es 403 PERMISO_INSUFICIENTE, y PostgreSQL no cambia', async () => {
    const antes = await pedir(consulta, `/clientes/${clienteId}`);
    const intentos: [string, string, unknown][] = [
      ['POST', '/clientes', { razonSocial: `${MARCA} Intruso`, cuit: cuitUnico() }],
      ['PATCH', `/clientes/${clienteId}`, { telefono: '+54 11 0000-0000' }],
      ['PATCH', `/clientes/${clienteId}/estado`, { estado: 'INACTIVO' }],
      ['PUT', `/clientes/${clienteId}/observaciones`, { observaciones: 'no' }],
      ['PUT', `/clientes/${clienteId}/indicaciones-armado`, { indicacionesArmado: 'no' }],
      [
        'POST',
        `/clientes/${clienteId}/contactos`,
        { nombre: 'Intruso', area: 'X', email: 'x@x.example' },
      ],
      ['POST', `/clientes/${clienteId}/rendiciones`, { anio: 2026, mes: 10 }],
      ['POST', '/tipos-documento', { nombre: `${MARCA} Tipo` }],
    ];
    for (const [method, ruta, cuerpo] of intentos) {
      const res = await pedir(consulta, ruta, { method, body: JSON.stringify(cuerpo) });
      expect(res.status, `${method} ${ruta}`).toBe(403);
      expect(motivoDe(res.cuerpo), `${method} ${ruta}`).toBe('PERMISO_INSUFICIENTE');
    }

    expect((await pedir(consulta, `/clientes/${clienteId}`)).cuerpo).toEqual(antes.cuerpo);
    expect((await pedir(consulta, `/clientes/${clienteId}/observaciones`)).cuerpo).toEqual({
      observaciones: `${MARCA} nota interna`,
    });
    expect((await pedir(consulta, `/clientes/${clienteId}/contactos`)).cuerpo).toEqual([]);
    expect((await pedir(consulta, `/clientes/${clienteId}/rendiciones`)).cuerpo).toEqual([]);
    const tipos = (await pedir(consulta, '/tipos-documento?incluirInactivos=true')).cuerpo as {
      nombre: string;
    }[];
    expect(tipos.filter((t) => t.nombre.startsWith(MARCA))).toEqual([]);
    const clientes = (await pedir(consulta, '/clientes')).cuerpo as { razonSocial: string }[];
    expect(clientes.filter((c) => c.razonSocial === `${MARCA} Intruso`)).toEqual([]);
  });

  it('un rol enviado por cabecera, query o cuerpo no da privilegios', async () => {
    const res = await pedir(consulta, '/tipos-documento?rol=ADMINISTRADOR', {
      method: 'POST',
      headers: { 'X-Rol': 'ADMINISTRADOR' },
      body: JSON.stringify({ nombre: `${MARCA} Escalada`, rol: 'ADMINISTRADOR' }),
    });

    expect(res.status).toBe(403);
    expect(motivoDe(res.cuerpo)).toBe('PERMISO_INSUFICIENTE');
    expect((await pedir(consulta, '/auth/sesion')).cuerpo).toMatchObject({
      usuario: { rol: 'CONSULTA' },
    });
  });

  it('los GET de operación siguen prohibidos: sugerencia de OC y candidatos de un documento', async () => {
    const ultimaOc = await pedir(consulta, `/clientes/${clienteId}/ultima-oc`);
    expect(ultimaOc.status).toBe(403);
    expect(motivoDe(ultimaOc.cuerpo)).toBe('PERMISO_INSUFICIENTE');

    // Con los documentos sin montar (como en producción hasta HU4.4) es 404; montados, 403. Nunca 200.
    const candidatos = await pedir(consulta, `/documentos/${UUID_AJENO}/candidatos`);
    expect([403, 404]).toContain(candidatos.status);
    if (candidatos.status === 403) expect(motivoDe(candidatos.cuerpo)).toBe('PERMISO_INSUFICIENTE');
  });

  it('documentos: con el servicio habilitado lee el repositorio y la descarga está autorizada; sin él, 404', async () => {
    const repositorio = await pedir(consulta, '/documentos?anio=2026&mes=10');
    if (repositorio.status === 404) {
      // Este backend no monta /documentos (DOCUMENTOS_HABILITADOS): no hay nada que descargar.
      return;
    }
    expect(repositorio.status).toBe(200);
    // La descarga de un id cualquiera: la autorización pasa (ni 401 ni 403) y el resultado lo
    // decide el documento (aquí no existe: 404). El contenido de un documento real depende del
    // almacenamiento del backend de prueba, que este test no controla.
    const archivo = await pedir(consulta, `/documentos/${UUID_AJENO}/archivo`);
    expect([401, 403]).not.toContain(archivo.status);
    const [primero] = repositorio.cuerpo as { id: string }[];
    if (primero !== undefined) {
      expect((await pedir(consulta, `/documentos/${primero.id}`)).status).toBe(200);
    }
  });

  it('la pantalla Clientes, con la sesión real de CONSULTA, lee y no ofrece escribir', async () => {
    vi.stubGlobal('fetch', consulta.fetch);
    vi.stubEnv('VITE_API_URL', API ?? '');
    try {
      render(
        <QueryClientProvider client={crearQueryClient()}>
          <MemoryRouter initialEntries={[`/clientes?q=${MARCA}`]}>
            <ClientesPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(
        await screen.findByText(`${MARCA} Cliente de consulta`, {}, { timeout: 15_000 }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Nuevo cliente/ })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
