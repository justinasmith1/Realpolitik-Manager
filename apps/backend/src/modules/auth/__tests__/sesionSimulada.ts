// Sesiones para los tests de rutas que simulan la base (`vi.mock('../../../lib/prisma')`).
//
// No es un modo sin autenticación: la cadena completa corre igual que en producción (cookie,
// formato y hash del token, `validarSesion`, vencimientos, usuario activo, contraseña definitiva,
// solo lectura de CONSULTA y `autorizar`). Lo único simulado es la respuesta de la base a
// `sesion.findUnique`, como esos tests ya simulan las demás tablas. Las pruebas contra PostgreSQL
// real usan `sesionReal.ts`.
//
// Uso:
//   vi.mock('../../../lib/prisma', async () => {
//     const { conSesionesSimuladas } = await import('../../auth/__tests__/sesionSimulada');
//     return { prisma: conSesionesSimuladas(prismaMock) };
//   });
//   const api = clienteDePrueba(app);          // ADMINISTRATIVO
//   await api.get('/clientes');
//   await clienteDePrueba(app, 'CONSULTA').post('/clientes').send({});

import type { RolUsuario } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';

import { NOMBRE_COOKIE_DE_SESION } from '../cookieDeSesion';
import { generarTokenDeSesion } from '../tokenDeSesion';

export const ORIGEN_DE_PRUEBA = 'http://localhost:5173';

/** Cada rol y una cuenta con la contraseña temporal sin cambiar. */
export type IdentidadDePrueba = RolUsuario | 'CAMBIO_PENDIENTE';

export const IDENTIDADES: readonly IdentidadDePrueba[] = [
  'ADMINISTRADOR',
  'ADMINISTRATIVO',
  'CONSULTA',
  'CAMBIO_PENDIENTE',
];

interface CuentaSimulada {
  token: string;
  usuario: {
    id: string;
    email: string;
    nombre: string;
    rol: RolUsuario;
    activo: boolean;
    debeCambiarPassword: boolean;
  };
}

const UUIDS: Record<IdentidadDePrueba, string> = {
  ADMINISTRADOR: '0000a000-0000-4000-8000-000000000001',
  ADMINISTRATIVO: '0000a000-0000-4000-8000-000000000002',
  CONSULTA: '0000a000-0000-4000-8000-000000000003',
  CAMBIO_PENDIENTE: '0000a000-0000-4000-8000-000000000004',
};

const cuentas = new Map<string, CuentaSimulada>();
const porIdentidad = new Map<IdentidadDePrueba, CuentaSimulada>();
for (const identidad of IDENTIDADES) {
  const { token, tokenHash } = generarTokenDeSesion();
  const cuenta: CuentaSimulada = {
    token,
    usuario: {
      id: UUIDS[identidad],
      email: `${identidad.toLowerCase()}@prueba.example`,
      nombre: `Persona ${identidad}`,
      rol: identidad === 'CAMBIO_PENDIENTE' ? 'ADMINISTRATIVO' : identidad,
      activo: true,
      debeCambiarPassword: identidad === 'CAMBIO_PENDIENTE',
    },
  };
  cuentas.set(tokenHash, cuenta);
  porIdentidad.set(identidad, cuenta);
}

const DIA = 24 * 60 * 60 * 1000;

/**
 * La tabla `Sesion` simulada: solo conoce los tokens de arriba, vigentes y con actividad reciente
 * (así `validarSesion` no intenta registrar actividad). Funciones comunes, no `vi.fn`: los
 * `vi.resetAllMocks()` de los tests no las borran.
 */
export const tablaDeSesionesSimulada = {
  findUnique: ({ where }: { where: { tokenHash: string } }) => {
    const cuenta = cuentas.get(where.tokenHash);
    if (cuenta === undefined) return Promise.resolve(null);
    const ahora = Date.now();
    return Promise.resolve({
      id: `5e5a0000-0000-4000-8000-${cuenta.usuario.id.slice(-12)}`,
      createdAt: new Date(ahora - 60_000),
      ultimaActividadEn: new Date(ahora),
      expiraEn: new Date(ahora + DIA),
      revocadaEn: null,
      usuario: { ...cuenta.usuario },
    });
  },
  updateMany: () => Promise.resolve({ count: 0 }),
};

/** El cliente simulado del test, con la tabla de sesiones agregada (sin copiarlo: un Proxy). */
export function conSesionesSimuladas<T extends object>(prismaMock: T): T {
  return new Proxy(prismaMock, {
    get: (objetivo, clave, receptor) =>
      clave === 'sesion' ? tablaDeSesionesSimulada : Reflect.get(objetivo, clave, receptor),
  });
}

/** Valor de la cabecera `Cookie` de la identidad. */
export function cookieDe(identidad: IdentidadDePrueba = 'ADMINISTRATIVO'): string {
  const cuenta = porIdentidad.get(identidad);
  if (cuenta === undefined) throw new Error(`identidad desconocida: ${identidad}`);
  return `${NOMBRE_COOKIE_DE_SESION}=${cuenta.token}`;
}

export type ClienteDePrueba = ReturnType<typeof clienteConCabeceras>;

/** Pedidos con la cookie y un `Origin` permitido (lo exige toda escritura). */
export function clienteConCabeceras(app: Express, cabeceras: Record<string, string>) {
  const con = (pedido: request.Test) => pedido.set(cabeceras);
  return {
    get: (url: string) => con(request(app).get(url)),
    post: (url: string) => con(request(app).post(url)),
    put: (url: string) => con(request(app).put(url)),
    patch: (url: string) => con(request(app).patch(url)),
    delete: (url: string) => con(request(app).delete(url)),
    head: (url: string) => con(request(app).head(url)),
  };
}

export function clienteDePrueba(app: Express, identidad: IdentidadDePrueba = 'ADMINISTRATIVO') {
  return clienteConCabeceras(app, { Cookie: cookieDe(identidad), Origin: ORIGEN_DE_PRUEBA });
}
