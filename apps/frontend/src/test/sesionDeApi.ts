// Sesión REAL para los tests contra la API (`*.api.test.tsx`). Desde HU4.1 toda la API exige una
// sesión, así que cada archivo:
//   1. crea una cuenta de prueba en la base descartable (script del backend, con su guarda de
//      bases `*_audit` / `*_test`), con una contraseña al azar que viaja por stdin;
//   2. inicia sesión por `POST /auth/login`, como cualquier persona;
//   3. manda la cookie recibida en cada pedido;
//   4. al terminar cierra la sesión y borra la cuenta (y sus sesiones).
//
// No saltea la autenticación ni la simula: el backend valida la cookie contra PostgreSQL en cada
// pedido. Lo único que este archivo hace por el navegador es lo que jsdom no hace: guardar la
// cookie y mandar `Cookie` y `Origin` (en el navegador van solos, por ser el mismo origen).
//
// Uso:
//   const sesion = sesionDeApi(API);
//   const fetchReal = sesion.fetch;            // en lugar de `globalThis.fetch`
//   beforeAll(async () => { await sesion.iniciar(); });
//   afterAll(async () => { await sesion.cerrar(); });

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { fetchDeRed } from './fetchDeRed';

const SCRIPT = 'src/modules/auth/__tests__/usuarioDeApiDeTest.ts';

/** Un origen que el backend de pruebas acepta (`CORS_ORIGINS`). Por defecto, el del CI. */
const ORIGEN = process.env.TEST_API_ORIGIN ?? 'http://localhost:5173';

export function sesionDeApi(api: string | undefined) {
  // El `fetch` real: `setup.ts` bloquea el global para que ningún otro test salga a la red.
  const fetchBase = fetchDeRed;
  // Vitest corre con la raíz del frontend como directorio de trabajo.
  const backend = resolve(process.cwd(), '../backend');
  let cookie: string | undefined;
  let email: string | undefined;

  const script = (args: string[], input?: string) =>
    execFileSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
      cwd: backend,
      env: process.env,
      encoding: 'utf8',
      input,
    }).trim();

  const conSesion: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', ORIGEN);
    if (cookie !== undefined) headers.set('Cookie', cookie);
    return fetchBase(input, { ...init, headers });
  };

  return {
    /** `fetch` con la cookie de la sesión y un `Origin` permitido. */
    fetch: conSesion,

    /** Crea la cuenta e inicia sesión. Va en `beforeAll`, después de comprobar el destino. */
    async iniciar(): Promise<void> {
      if (api === undefined) return;
      const password = `api ${randomBytes(18).toString('base64url')} prueba`;
      email = script(['crear'], `${password}\n`);

      const respuesta = await conSesion(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!respuesta.ok) {
        throw new Error(
          `No se pudo iniciar la sesión de prueba (HTTP ${respuesta.status}). Revisá que el backend de TEST_API_URL use la base de TEST_DATABASE_URL y acepte el origen ${ORIGEN}.`,
        );
      }
      const [recibida] = respuesta.headers.getSetCookie();
      cookie = recibida?.split(';', 1)[0];
      if (cookie === undefined || cookie === '') {
        throw new Error('El inicio de sesión de prueba no devolvió la cookie de sesión.');
      }
    },

    /** Cierra la sesión y borra la cuenta de prueba. Va en `afterAll`. */
    async cerrar(): Promise<void> {
      if (email === undefined) return;
      const cuenta = email;
      email = undefined;
      let logout: Error | undefined;
      try {
        if (cookie !== undefined && api !== undefined) {
          await conSesion(`${api}/auth/logout`, { method: 'POST' });
        }
      } catch (error) {
        logout = error instanceof Error ? error : new Error(String(error));
      }
      cookie = undefined;
      // La cuenta se borra aunque el logout haya fallado (sus sesiones se borran en cascada).
      const borradas = script(['borrar', cuenta]);
      if (borradas !== '1') {
        throw new Error(`Se esperaba borrar 1 cuenta de prueba y se borraron ${borradas}.`);
      }
      if (logout !== undefined) throw logout;
    },
  };
}
