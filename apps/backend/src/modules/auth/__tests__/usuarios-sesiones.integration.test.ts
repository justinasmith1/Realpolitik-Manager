// Usuarios y sesiones (migración `hu4_1_usuarios_sesiones`) contra la base REAL.
//
// Escriben DIRECTO con Prisma (y SQL donde Prisma valida antes de llegar a la base): prueban la
// última línea de defensa, la que protege de scripts, Prisma Studio o SQL manual. Cada fila
// inválida es rechazada por PostgreSQL y NO queda guardada. Los hashes son reales (argon2) y los
// tokens, generados como en producción.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`) con las migraciones aplicadas.

import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena } from '../contrasenas';
import { generarTokenDeSesion, hashDeTokenDeSesion } from '../tokenDeSesion';
import { evaluarSesion, fechasDeSesionNueva } from '../vigenciaDeSesion';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let hashValido: string;

const MARCA = `testu${Date.now().toString(36)}`;
let secuencia = 0;
const emailUnico = () => `${MARCA}-${(secuencia += 1)}@ejemplo.example`;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  hashValido = await hashearContrasena('contraseña ficticia de integración');
});

afterAll(async () => {
  if (url === undefined) return;
  // Las sesiones se borran en cascada con su usuario.
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
  await prisma.$disconnect();
});

/** Un usuario válido según TODOS los CHECK; cada test pisa lo que quiere romper. */
function usuario(extra: Partial<Prisma.UsuarioCreateInput> = {}): Prisma.UsuarioCreateInput {
  return {
    email: emailUnico(),
    nombre: 'Persona de prueba',
    rol: 'ADMINISTRATIVO',
    passwordHash: hashValido,
    passwordActualizadaEn: new Date(),
    ...extra,
  };
}

async function esperarRechazo(datos: Prisma.UsuarioCreateInput, constraint: string | RegExp) {
  await expect(prisma.usuario.create({ data: datos })).rejects.toThrow(
    typeof constraint === 'string' ? new RegExp(constraint) : constraint,
  );
  expect(await prisma.usuario.count({ where: { email: datos.email } })).toBe(0);
}

const HORA = 60 * 60 * 1000;

async function crearSesion(
  usuarioId: string,
  extra: Partial<Prisma.SesionUncheckedCreateInput> = {},
) {
  const inicio = new Date();
  return prisma.sesion.create({
    data: {
      usuarioId,
      tokenHash: generarTokenDeSesion().tokenHash,
      createdAt: inicio,
      ultimaActividadEn: inicio,
      expiraEn: new Date(inicio.getTime() + HORA),
      ...extra,
    },
  });
}

describe.skipIf(url === undefined)('Usuario', () => {
  it('se guarda con los valores por defecto: activo y obligado a cambiar la contraseña', async () => {
    const creado = await prisma.usuario.create({ data: usuario() });

    expect(creado).toMatchObject({ activo: true, debeCambiarPassword: true, ultimoAccesoEn: null });
    expect(creado.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it.each(['ADMINISTRADOR', 'ADMINISTRATIVO', 'CONSULTA'] as const)(
    'acepta el rol %s',
    async (rol) => {
      await expect(prisma.usuario.create({ data: usuario({ rol }) })).resolves.toMatchObject({
        rol,
      });
    },
  );

  it('la base rechaza un rol que no existe (aunque se escriba por SQL)', async () => {
    const email = emailUnico();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "Usuario" ("id", "email", "nombre", "rol", "passwordHash", "passwordActualizadaEn", "updatedAt")
        VALUES (gen_random_uuid(), ${email}, 'X', 'SUPERUSUARIO'::"RolUsuario", ${hashValido}, now(), now())`,
    ).rejects.toThrow(/invalid input value for enum|RolUsuario/i);
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
  });

  it('el email es único', async () => {
    const email = emailUnico();
    await prisma.usuario.create({ data: usuario({ email }) });

    await expect(prisma.usuario.create({ data: usuario({ email }) })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  describe('ck_usuario_email_normalizado', () => {
    it.each([
      ['con mayúsculas', (e: string) => e.toUpperCase()],
      ['con espacios en los bordes', (e: string) => ` ${e} `],
      ['sin @', () => `${MARCA}-sin-arroba.example`],
      ['con espacio interno', () => `${MARCA} x@ejemplo.example`],
    ])('rechaza un email %s', async (_caso, transformar) => {
      await esperarRechazo(
        usuario({ email: transformar(emailUnico()) }),
        'ck_usuario_email_normalizado',
      );
    });
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
  ])('ck_usuario_nombre_no_vacio rechaza un nombre %s', async (_caso, nombre) => {
    await esperarRechazo(usuario({ nombre }), 'ck_usuario_nombre_no_vacio');
  });

  describe('ck_usuario_password_hash_argon2id', () => {
    it.each([
      ['una contraseña en claro', 'contraseña ficticia de integración'],
      ['un hash bcrypt', '$2b$10$abcdefghijklmnopqrstuuJxzZb2mC6t6yQWm8XoUeW9oWJm6Gx1y'],
      ['un hash argon2i', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
    ])('rechaza %s', async (_caso, passwordHash) => {
      await esperarRechazo(usuario({ passwordHash }), 'ck_usuario_password_hash_argon2id');
    });
  });
});

describe.skipIf(url === undefined)('Sesion', () => {
  let usuarioId: string;

  beforeAll(async () => {
    ({ id: usuarioId } = await prisma.usuario.create({ data: usuario() }));
  });

  it('guarda el hash del token, nunca el token', async () => {
    const { token, tokenHash } = generarTokenDeSesion();

    const sesion = await crearSesion(usuarioId, { tokenHash });

    expect(sesion.tokenHash).toBe(hashDeTokenDeSesion(token));
    expect(Object.values(sesion).map(String)).not.toContain(token);
    // Con el token de la cookie se encuentra la sesión por igualdad del hash.
    await expect(
      prisma.sesion.findUnique({ where: { tokenHash: hashDeTokenDeSesion(token) } }),
    ).resolves.toMatchObject({ id: sesion.id });
  });

  it('el hash del token es único', async () => {
    const { tokenHash } = generarTokenDeSesion();
    await crearSesion(usuarioId, { tokenHash });

    await expect(crearSesion(usuarioId, { tokenHash })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('pertenece a un usuario existente', async () => {
    await expect(crearSesion('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  it.each([
    ['en mayúsculas', () => generarTokenDeSesion().tokenHash.toUpperCase()],
    ['con otro largo', () => 'a'.repeat(63)],
    ['el token en claro', () => generarTokenDeSesion().token.padEnd(64, 'x')],
  ])('ck_sesion_token_hash_formato rechaza un hash %s', async (_caso, tokenHash) => {
    const valor = tokenHash();

    await expect(crearSesion(usuarioId, { tokenHash: valor })).rejects.toThrow(
      /ck_sesion_token_hash_formato/,
    );
    expect(await prisma.sesion.count({ where: { tokenHash: valor } })).toBe(0);
  });

  describe('ck_sesion_fechas_coherentes', () => {
    const inicio = new Date('2026-11-11T12:00:00.000Z');

    it.each([
      ['vence al empezar', { expiraEn: inicio }],
      ['vence antes de empezar', { expiraEn: new Date(inicio.getTime() - 1) }],
      ['actividad antes de empezar', { ultimaActividadEn: new Date(inicio.getTime() - 1) }],
      ['revocada antes de empezar', { revocadaEn: new Date(inicio.getTime() - 1) }],
    ])('rechaza una sesión que %s', async (_caso, extra) => {
      const { tokenHash } = generarTokenDeSesion();

      await expect(
        crearSesion(usuarioId, {
          tokenHash,
          createdAt: inicio,
          ultimaActividadEn: inicio,
          expiraEn: new Date(inicio.getTime() + HORA),
          ...extra,
        }),
      ).rejects.toThrow(/ck_sesion_fechas_coherentes/);
      expect(await prisma.sesion.count({ where: { tokenHash } })).toBe(0);
    });
  });

  it('se revoca y deja de encontrarse entre las vigentes', async () => {
    const sesion = await crearSesion(usuarioId);
    const vigentes = () =>
      prisma.sesion.count({
        where: { id: sesion.id, revocadaEn: null, expiraEn: { gt: new Date() } },
      });
    expect(await vigentes()).toBe(1);

    // Como el logout del ADR: condicional e idempotente.
    const revocar = () =>
      prisma.sesion.updateMany({
        where: { id: sesion.id, revocadaEn: null },
        data: { revocadaEn: new Date() },
      });
    await expect(revocar()).resolves.toEqual({ count: 1 });
    await expect(revocar()).resolves.toEqual({ count: 0 });

    expect(await vigentes()).toBe(0);
  });

  it('revocar todas las sesiones de un usuario no toca las de otro', async () => {
    const otro = await prisma.usuario.create({ data: usuario() });
    const deOtro = await crearSesion(otro.id);
    await crearSesion(usuarioId);

    await prisma.sesion.updateMany({
      where: { usuarioId, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });

    expect(await prisma.sesion.count({ where: { usuarioId, revocadaEn: null } })).toBe(0);
    await expect(
      prisma.sesion.findUniqueOrThrow({ where: { id: deOtro.id } }),
    ).resolves.toMatchObject({
      revocadaEn: null,
    });
  });

  it('se borra en cascada con su usuario', async () => {
    const efimero = await prisma.usuario.create({ data: usuario() });
    const sesion = await crearSesion(efimero.id);

    await prisma.usuario.delete({ where: { id: efimero.id } });

    await expect(prisma.sesion.findUnique({ where: { id: sesion.id } })).resolves.toBeNull();
  });

  it('acepta las fechas que produce fechasDeSesionNueva (Backend 2A) y las conserva al milisegundo', async () => {
    const ahora = new Date('2026-11-11T21:15:30.123Z');
    const fechas = fechasDeSesionNueva(ahora);

    const sesion = await prisma.sesion.create({
      data: { usuarioId, tokenHash: generarTokenDeSesion().tokenHash, ...fechas },
    });

    expect({
      createdAt: sesion.createdAt.toISOString(),
      ultimaActividadEn: sesion.ultimaActividadEn.toISOString(),
      expiraEn: sesion.expiraEn.toISOString(),
    }).toEqual({
      createdAt: '2026-11-11T21:15:30.123Z',
      ultimaActividadEn: '2026-11-11T21:15:30.123Z',
      expiraEn: '2026-11-18T21:15:30.123Z',
    });
    expect(evaluarSesion({ ...sesion }, ahora)).toBe('VIGENTE');
  });

  it('una transacción que falla no deja nada guardado (ni el usuario ni sus sesiones)', async () => {
    const email = emailUnico();

    await expect(
      prisma.$transaction(async (tx) => {
        const creado = await tx.usuario.create({ data: usuario({ email }) });
        await tx.sesion.create({
          data: {
            usuarioId: creado.id,
            tokenHash: generarTokenDeSesion().tokenHash,
            ...fechasDeSesionNueva(new Date()),
          },
        });
        // La segunda sesión viola ck_sesion_token_hash_formato: toda la transacción se deshace.
        await tx.sesion.create({
          data: {
            usuarioId: creado.id,
            tokenHash: 'no-es-un-sha256',
            ...fechasDeSesionNueva(new Date()),
          },
        });
      }),
    ).rejects.toThrow(/ck_sesion_token_hash_formato/);

    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
    expect(await prisma.sesion.count({ where: { usuario: { email } } })).toBe(0);
  });
});
