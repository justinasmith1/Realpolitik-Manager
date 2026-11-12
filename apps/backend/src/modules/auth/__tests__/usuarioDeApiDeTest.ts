// Cuenta de prueba para los tests del frontend contra la API real (`*.api.test.tsx`). Desde HU4.1
// la API exige sesión: el test crea una cuenta acá, inicia sesión de verdad por `POST /auth/login`
// y la borra al terminar. No hay ningún atajo de autenticación: la sesión es real.
//
//   TEST_DATABASE_URL=… node --import tsx usuarioDeApiDeTest.ts crear     (contraseña por stdin)
//   TEST_DATABASE_URL=… node --import tsx usuarioDeApiDeTest.ts borrar <email>
//
// `crear` imprime el email de la cuenta (ADMINISTRATIVO, con contraseña definitiva). La contraseña
// llega por la entrada estándar: no va en argumentos ni se imprime. `borrar` solo acepta emails
// con la marca de estas cuentas y borra también sus sesiones (en cascada); imprime cuántas borró.
// Se niega a operar si `TEST_DATABASE_URL` falta o la base no termina en `_audit` o `_test`.

import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena } from '../contrasenas';

const EMAIL_DE_PRUEBA = /^api-test-[0-9a-f]{16}@pruebas\.example$/;

async function leerEntrada(): Promise<string> {
  let todo = '';
  process.stdin.setEncoding('utf8');
  for await (const trozo of process.stdin) todo += String(trozo);
  return todo.split(/\r?\n/, 1)[0] ?? '';
}

async function main(): Promise<void> {
  const url = urlDeBaseDescartable();
  if (url === undefined) {
    throw new Error('Falta TEST_DATABASE_URL: no se crea ni se borra nada.');
  }
  const [accion, email] = process.argv.slice(2);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (accion === 'crear') {
      const password = await leerEntrada();
      if (password.length < 20) {
        throw new Error(
          'La contraseña de la cuenta de prueba llega por stdin (20 caracteres o más).',
        );
      }
      const nuevo = `api-test-${randomBytes(8).toString('hex')}@pruebas.example`;
      await prisma.usuario.create({
        data: {
          email: nuevo,
          nombre: 'Prueba de la API',
          rol: 'ADMINISTRATIVO',
          passwordHash: await hashearContrasena(password),
          passwordActualizadaEn: new Date(),
          debeCambiarPassword: false,
        },
      });
      process.stdout.write(nuevo);
    } else if (accion === 'borrar') {
      if (email === undefined || !EMAIL_DE_PRUEBA.test(email)) {
        throw new Error('Solo se borran cuentas de prueba de la API (api-test-…@pruebas.example).');
      }
      const { count } = await prisma.usuario.deleteMany({ where: { email } });
      process.stdout.write(String(count));
    } else {
      throw new Error('Uso: usuarioDeApiDeTest.ts crear | borrar <email>');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Solo mensajes propios: un error de Prisma puede citar datos de conexión.
  const propio = error instanceof Error && error.constructor === Error;
  process.stderr.write(
    `${propio ? error.message : 'No se pudo operar sobre la base de pruebas.'}\n`,
  );
  process.exit(1);
});
