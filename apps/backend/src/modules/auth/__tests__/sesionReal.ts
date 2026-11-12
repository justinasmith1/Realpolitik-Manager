// Sesiones REALES para los tests de integración contra PostgreSQL (solo bases descartables).
//
// Crea una cuenta por identidad (cada rol y una con la contraseña temporal pendiente) y una sesión
// con el servicio de producción (`crearSesion`). Los pedidos llevan esa cookie y un `Origin`
// permitido, y pasan por la cadena completa: `validarSesion` contra la base, contraseña definitiva,
// solo lectura de CONSULTA y `autorizar`.
//
// Las cuentas no tienen contraseña: su hash cumple el formato argon2id que exige la base, pero no
// corresponde a ninguna contraseña, así que nadie puede iniciar sesión con ellas. Sus emails llevan
// una marca única por archivo y `limpiar()` las borra con sus sesiones (en cascada).
//
// Uso (en un test de integración):
//   const sesiones = sesionesDePrueba();
//   beforeAll: process.env.DATABASE_URL = url; await sesiones.preparar(); …
//   afterAll:  await sesiones.limpiar(); await prisma.$disconnect();
//   await sesiones.cliente(app).post('/clientes').send({ … });         // ADMINISTRATIVO
//   await sesiones.cliente(app, 'CONSULTA').get('/clientes');

import type { Express } from 'express';

import { NOMBRE_COOKIE_DE_SESION } from '../cookieDeSesion';

import {
  clienteConCabeceras,
  IDENTIDADES,
  ORIGEN_DE_PRUEBA,
  type IdentidadDePrueba,
} from './sesionSimulada';

/** Forma de argon2id (cumple `ck_usuario_password_hash_argon2id`), sin contraseña que lo produzca. */
export const HASH_SIN_CONTRASENA =
  '$argon2id$v=19$m=19456,t=2,p=1$c2luLWNvbnRyYXNlbmE$c2luLWNvbnRyYXNlbmEtcGFyYS1wcnVlYmFzLWRlLWludGVncmFjaW9u';

export function sesionesDePrueba() {
  const prefijo = `sesiones-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const tokens = new Map<IdentidadDePrueba, string>();

  return {
    prefijo,

    /** Crea las cuentas y sus sesiones. Va en `beforeAll`, después de fijar `DATABASE_URL`. */
    async preparar(): Promise<void> {
      const { prisma } = await import('../../../lib/prisma');
      const { crearSesion } = await import('../sesiones.service');
      for (const identidad of IDENTIDADES) {
        const usuario = await prisma.usuario.create({
          data: {
            email: `${prefijo}-${identidad.toLowerCase().replace('_', '-')}@pruebas.example`,
            nombre: `Prueba ${identidad}`,
            rol: identidad === 'CAMBIO_PENDIENTE' ? 'ADMINISTRATIVO' : identidad,
            passwordHash: HASH_SIN_CONTRASENA,
            passwordActualizadaEn: new Date(),
            debeCambiarPassword: identidad === 'CAMBIO_PENDIENTE',
          },
        });
        tokens.set(identidad, (await crearSesion(usuario.id, HASH_SIN_CONTRASENA)).token);
      }
    },

    /** Pedidos con la cookie de la identidad y un `Origin` permitido. */
    cliente(app: Express, identidad: IdentidadDePrueba = 'ADMINISTRATIVO') {
      const token = tokens.get(identidad);
      if (token === undefined) throw new Error('sesionesDePrueba: falta `await preparar()`.');
      return clienteConCabeceras(app, {
        Cookie: `${NOMBRE_COOKIE_DE_SESION}=${token}`,
        Origin: ORIGEN_DE_PRUEBA,
      });
    },

    /** Borra las cuentas de este archivo y, en cascada, sus sesiones. */
    async limpiar(): Promise<void> {
      if (tokens.size === 0) return;
      const { prisma } = await import('../../../lib/prisma');
      await prisma.usuario.deleteMany({ where: { email: { startsWith: prefijo } } });
    },
  };
}
