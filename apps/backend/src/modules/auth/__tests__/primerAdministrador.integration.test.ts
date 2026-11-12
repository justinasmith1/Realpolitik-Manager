// Primer administrador contra PostgreSQL REAL: alta, hash, cambio obligatorio, repetición, cuentas
// existentes (activas y desactivadas), concurrencia y el comando de terminal de punta a punta.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`). La regla "no hay ningún administrador activo"
// es global a la base: la suite necesita que no haya ninguno al empezar (las demás suites borran
// los suyos) y, si lo hay, falla con un mensaje claro en vez de tocarlo.

import { spawn } from 'node:child_process';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { verificarContrasena } from '../contrasenas';
import { crearPrimerAdministrador } from '../primerAdministrador';

import { HASH_SIN_CONTRASENA } from './sesionReal';

const url = urlDeBaseDescartable();

const MARCA = `primer-admin-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = (alias: string) => `${MARCA}-${alias}@pruebas.example`;
const PASSWORD = 'tranvía ámbar sobre el puente 47';
const datos = (alias = 'dora') => ({
  email: email(alias),
  nombre: 'Dora Dirección',
  password: PASSWORD,
});

let prisma: PrismaClient;
let otra: PrismaClient;

const propios = { email: { startsWith: MARCA } };
const limpiar = () => prisma.usuario.deleteMany({ where: propios });

beforeAll(async () => {
  if (url === undefined) return;
  prisma = new PrismaClient({ datasourceUrl: url, log: [] });
  otra = new PrismaClient({ datasourceUrl: url, log: [] });
  const ajenos = await prisma.usuario.count({ where: { rol: 'ADMINISTRADOR', activo: true } });
  if (ajenos > 0) {
    throw new Error(
      `La base de pruebas tiene ${ajenos} administrador(es) activo(s) de otra corrida: esta suite no los toca y no puede probar el primer alta. Limpiá esas cuentas de prueba.`,
    );
  }
});

afterEach(async () => {
  if (url !== undefined) await limpiar();
});

afterAll(async () => {
  if (url === undefined) return;
  await limpiar();
  await prisma.$disconnect();
  await otra.$disconnect();
});

describe.skipIf(url === undefined)('primer administrador (PostgreSQL real)', () => {
  it('sin administradores: crea la cuenta ADMINISTRADOR, activa, con cambio de contraseña obligatorio', async () => {
    const ahora = new Date('2026-11-12T10:00:00.000Z');
    const salida = await crearPrimerAdministrador(
      prisma,
      { ...datos(), email: `  ${email('dora').toUpperCase()} ` },
      ahora,
    );

    expect(salida).toMatchObject({
      resultado: 'creado',
      usuario: { email: email('dora'), nombre: 'Dora Dirección' },
    });
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email: email('dora') } });
    expect(usuario).toMatchObject({
      rol: 'ADMINISTRADOR',
      activo: true,
      debeCambiarPassword: true,
      ultimoAccesoEn: null,
    });
    expect(usuario.passwordActualizadaEn).toEqual(ahora);
  });

  it('guarda un hash Argon2id que verifica la contraseña, nunca la contraseña', async () => {
    const salida = await crearPrimerAdministrador(prisma, datos());

    const { passwordHash } = await prisma.usuario.findUniqueOrThrow({
      where: { email: email('dora') },
    });
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(PASSWORD);
    await expect(verificarContrasena(passwordHash, PASSWORD)).resolves.toBe(true);
    await expect(verificarContrasena(passwordHash, `${PASSWORD}x`)).resolves.toBe(false);
    // El resultado no lleva ni la contraseña ni el hash.
    expect(JSON.stringify(salida)).not.toContain(PASSWORD);
    expect(JSON.stringify(salida)).not.toContain('argon2');
  });

  it('no crea ninguna sesión', async () => {
    await crearPrimerAdministrador(prisma, datos());
    expect(await prisma.sesion.count({ where: { usuario: propios } })).toBe(0);
  });

  it('segunda ejecución con los mismos datos: no duplica ni modifica la cuenta', async () => {
    await crearPrimerAdministrador(prisma, datos());
    const antes = await prisma.usuario.findUniqueOrThrow({ where: { email: email('dora') } });

    const segunda = await crearPrimerAdministrador(prisma, {
      ...datos(),
      password: 'otra contraseña distinta y larga 88',
    });

    expect(segunda).toEqual({ resultado: 'ya-existe-administrador' });
    expect(await prisma.usuario.count({ where: propios })).toBe(1);
    expect(await prisma.usuario.findUniqueOrThrow({ where: { email: email('dora') } })).toEqual(
      antes,
    );
  });

  it('con un administrador activo: no crea otro, aunque el email sea distinto', async () => {
    await crearPrimerAdministrador(prisma, datos());

    expect(await crearPrimerAdministrador(prisma, datos('segundo'))).toEqual({
      resultado: 'ya-existe-administrador',
    });
    expect(await prisma.usuario.count({ where: propios })).toBe(1);
  });

  it('cuenta desactivada con ese email: no la reactiva ni le cambia la contraseña o el rol', async () => {
    const desactivada = await prisma.usuario.create({
      data: {
        email: email('dora'),
        nombre: 'Cuenta Desactivada',
        rol: 'ADMINISTRADOR',
        activo: false,
        debeCambiarPassword: false,
        passwordHash: HASH_SIN_CONTRASENA,
        passwordActualizadaEn: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    expect(await crearPrimerAdministrador(prisma, datos())).toEqual({
      resultado: 'email-en-uso',
      activo: false,
      esAdministrador: true,
    });
    expect(await prisma.usuario.findUniqueOrThrow({ where: { email: email('dora') } })).toEqual(
      desactivada,
    );
    expect(await prisma.usuario.count({ where: propios })).toBe(1);
  });

  it('cuenta activa de otro rol con ese email: no la promueve a administrador', async () => {
    const administrativa = await prisma.usuario.create({
      data: {
        email: email('dora'),
        nombre: 'Ana Administrativa',
        rol: 'ADMINISTRATIVO',
        passwordHash: HASH_SIN_CONTRASENA,
        passwordActualizadaEn: new Date(),
        debeCambiarPassword: false,
      },
    });

    expect(await crearPrimerAdministrador(prisma, datos())).toEqual({
      resultado: 'email-en-uso',
      activo: true,
      esAdministrador: false,
    });
    expect(await prisma.usuario.findUniqueOrThrow({ where: { email: email('dora') } })).toEqual(
      administrativa,
    );
  });

  it('un administrador desactivado (con otro email) no cuenta: se crea el primero activo', async () => {
    await prisma.usuario.create({
      data: {
        email: email('viejo'),
        nombre: 'Administrador Anterior',
        rol: 'ADMINISTRADOR',
        activo: false,
        passwordHash: HASH_SIN_CONTRASENA,
        passwordActualizadaEn: new Date(),
      },
    });

    expect(await crearPrimerAdministrador(prisma, datos())).toMatchObject({ resultado: 'creado' });
    expect(
      await prisma.usuario.findUniqueOrThrow({ where: { email: email('viejo') } }),
    ).toMatchObject({ activo: false });
  });

  it('datos inválidos o contraseña rechazada por la política: no se crea nada', async () => {
    for (const cambio of [
      { email: 'no-es-un-email' },
      { nombre: '  ' },
      { password: 'corta' },
      { password: 'password1234567' },
    ]) {
      const salida = await crearPrimerAdministrador(prisma, { ...datos(), ...cambio });
      expect(salida.resultado).toBe('datos-invalidos');
    }
    expect(await prisma.usuario.count({ where: propios })).toBe(0);
  });

  it('concurrencia, emails distintos: de varias ejecuciones simultáneas se crea un solo administrador', async () => {
    const salidas = await Promise.all([
      crearPrimerAdministrador(prisma, datos('a')),
      crearPrimerAdministrador(otra, datos('b')),
      crearPrimerAdministrador(prisma, datos('c')),
      crearPrimerAdministrador(otra, datos('d')),
    ]);

    expect(salidas.filter((s) => s.resultado === 'creado')).toHaveLength(1);
    expect(salidas.filter((s) => s.resultado === 'ya-existe-administrador')).toHaveLength(3);
    expect(await prisma.usuario.count({ where: { rol: 'ADMINISTRADOR', activo: true } })).toBe(1);
  });

  it('concurrencia, mismo email: una sola cuenta y ningún error', async () => {
    const salidas = await Promise.all([
      crearPrimerAdministrador(prisma, datos()),
      crearPrimerAdministrador(otra, datos()),
    ]);

    expect(salidas.map((s) => s.resultado).sort()).toEqual(['creado', 'ya-existe-administrador']);
    expect(await prisma.usuario.count({ where: propios })).toBe(1);
  });
});

// El comando real, como proceso aparte: datos por variables, contraseña por la entrada estándar.
function ejecutarComando(
  entorno: Record<string, string>,
  entrada: string,
  argumentos: string[] = [],
): Promise<{ codigo: number | null; salida: string }> {
  const { VITEST: _vitest, ...heredado } = process.env;
  return new Promise((resolve, reject) => {
    const hijo = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join('src', 'scripts', 'crear-primer-administrador.ts'),
        ...argumentos,
      ],
      { cwd: process.cwd(), env: { ...heredado, ...entorno }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let salida = '';
    hijo.stdout.on('data', (trozo: Buffer) => (salida += trozo.toString()));
    hijo.stderr.on('data', (trozo: Buffer) => (salida += trozo.toString()));
    hijo.on('error', reject);
    hijo.on('close', (codigo) => resolve({ codigo, salida }));
    // Si el comando termina antes de leer la entrada (destino sin confirmar, argumentos), escribir
    // da EPIPE: es esperable y, sin este manejador, el error tiraría el proceso de Vitest.
    hijo.stdin.on('error', () => undefined);
    hijo.stdin.end(entrada);
  });
}

describe.skipIf(url === undefined)('comando crear-primer-administrador', () => {
  const entorno = () => ({
    DATABASE_URL: url ?? '',
    ADMIN_EMAIL: email('comando'),
    ADMIN_NOMBRE: 'Carla Comando',
    ADMIN_CONFIRMAR_BASE: new URL(url ?? 'x:').pathname.slice(1),
  });

  it('crea la cuenta, sale con 0 y no muestra la contraseña ni las credenciales de la base', async () => {
    const { codigo, salida } = await ejecutarComando(entorno(), `${PASSWORD}\n`);

    expect(salida).toContain('Listo');
    expect(codigo).toBe(0);
    expect(salida).not.toContain(PASSWORD);
    expect(salida).not.toContain('argon2');
    const credenciales = new URL(url ?? 'x:').password;
    if (credenciales !== '') expect(salida).not.toContain(credenciales);
    expect(
      await prisma.usuario.findUniqueOrThrow({ where: { email: email('comando') } }),
    ).toMatchObject({ rol: 'ADMINISTRADOR', activo: true, debeCambiarPassword: true });

    // Repetirlo no duplica: sale con 2 y lo dice.
    const repetido = await ejecutarComando(entorno(), `${PASSWORD}\n`);
    expect(repetido.codigo).toBe(2);
    expect(repetido.salida).toContain('Ya existe un administrador activo');
    expect(await prisma.usuario.count({ where: propios })).toBe(1);
  }, 60_000);

  it('sin confirmar el nombre de la base no escribe nada', async () => {
    const { codigo, salida } = await ejecutarComando(
      { ...entorno(), ADMIN_CONFIRMAR_BASE: 'otra_base' },
      `${PASSWORD}\n`,
    );
    expect(codigo).toBe(1);
    expect(salida).toContain('ADMIN_CONFIRMAR_BASE');
    expect(await prisma.usuario.count({ where: propios })).toBe(0);
  }, 30_000);

  it('rechaza argumentos (una contraseña en la línea de comandos) y no la repite', async () => {
    const { codigo, salida } = await ejecutarComando(entorno(), '', [PASSWORD]);
    expect(codigo).toBe(1);
    expect(salida).toContain('no recibe argumentos');
    expect(salida).not.toContain(PASSWORD);
    expect(await prisma.usuario.count({ where: propios })).toBe(0);
  }, 30_000);

  it('contraseña rechazada por la política: sale con 1, explica el motivo y no crea nada', async () => {
    const { codigo, salida } = await ejecutarComando(entorno(), 'corta\n');
    expect(codigo).toBe(1);
    expect(salida).toContain('password');
    expect(await prisma.usuario.count({ where: propios })).toBe(0);
  }, 30_000);
});
