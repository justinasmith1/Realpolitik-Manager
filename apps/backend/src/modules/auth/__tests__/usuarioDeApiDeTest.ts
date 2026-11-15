// Cuenta de prueba para los tests del frontend contra la API real (`*.api.test.tsx`). Desde HU4.1
// la API exige sesión: el test crea una cuenta acá, inicia sesión de verdad por `POST /auth/login`
// y la borra al terminar. No hay ningún atajo de autenticación: la sesión es real.
//
//   TEST_DATABASE_URL=… node --import tsx usuarioDeApiDeTest.ts crear [ROL]   (contraseña por stdin)
//   TEST_DATABASE_URL=… node --import tsx usuarioDeApiDeTest.ts borrar <email>
//
// `crear` imprime el email de la cuenta, con contraseña definitiva. El rol es ADMINISTRATIVO
// (por defecto) o CONSULTA (HU4.3, para probar la lectura con una sesión real); nunca
// ADMINISTRADOR ni otro valor: este script no crea administradores. La contraseña
// llega por la entrada estándar: no va en argumentos ni se imprime. `borrar` solo acepta emails
// con la marca de estas cuentas y borra también sus sesiones (en cascada); imprime cuántas borró.
// Se niega a operar si `TEST_DATABASE_URL` falta o la base no termina en `_audit` o `_test`.

import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena } from '../contrasenas';

const EMAIL_DE_PRUEBA = /^api-test-[0-9a-f]{16}@pruebas\.example$/;

/** Los únicos roles que crea: los de las pruebas. Nunca ADMINISTRADOR. */
const ROLES_DE_PRUEBA = ['ADMINISTRATIVO', 'CONSULTA'] as const;
type RolDePrueba = (typeof ROLES_DE_PRUEBA)[number];

function rolDePrueba(valor: string | undefined): RolDePrueba {
  const rol = valor ?? 'ADMINISTRATIVO';
  if (!(ROLES_DE_PRUEBA as readonly string[]).includes(rol)) {
    throw new Error('Las cuentas de prueba de la API son ADMINISTRATIVO o CONSULTA.');
  }
  return rol as RolDePrueba;
}

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
  const [accion, argumento] = process.argv.slice(2);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    if (accion === 'crear') {
      // Se valida antes de leer la contraseña: un rol no admitido no llega a la base.
      const rol = rolDePrueba(argumento);
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
          nombre: rol === 'CONSULTA' ? 'Prueba de la API (Consulta)' : 'Prueba de la API',
          rol,
          passwordHash: await hashearContrasena(password),
          passwordActualizadaEn: new Date(),
          debeCambiarPassword: false,
        },
      });
      process.stdout.write(nuevo);
    } else if (accion === 'borrar') {
      const email = argumento;
      if (email === undefined || !EMAIL_DE_PRUEBA.test(email)) {
        throw new Error('Solo se borran cuentas de prueba de la API (api-test-…@pruebas.example).');
      }
      const { count } = await prisma.usuario.deleteMany({ where: { email } });
      process.stdout.write(String(count));
    } else {
      throw new Error(
        'Uso: usuarioDeApiDeTest.ts crear [ADMINISTRATIVO|CONSULTA] | borrar <email>',
      );
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
