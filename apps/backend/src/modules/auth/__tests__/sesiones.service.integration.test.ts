// El servicio de sesiones contra PostgreSQL REAL: creación, validación, vencimientos, actividad,
// revocación, límite de sesiones y las carreras que el diseño dice resolver (creaciones simultáneas,
// revocaciones simultáneas, actividad concurrente y desactivación mientras se crea una sesión).
//
// Relojes controlados: cada operación recibe su `ahora`. La única espera real es la del escenario
// de desactivación, que necesita que una transacción mantenga un bloqueo mientras otra lo pide.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`) con las migraciones aplicadas.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { hashearContrasena } from '../contrasenas';
import type * as ServicioDeSesiones from '../sesiones.service';
import { generarTokenDeSesion } from '../tokenDeSesion';
import { DURACIONES_DE_SESION } from '../vigenciaDeSesion';

type Servicio = typeof ServicioDeSesiones;

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let servicio: Servicio;
let hashValido: string;

const MARCA = `tests${Date.now().toString(36)}`;
let secuencia = 0;

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const T0 = new Date('2026-11-11T12:00:00.000Z');
const en = (ms: number) => new Date(T0.getTime() + ms);
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  servicio = await import('../sesiones.service');
  hashValido = await hashearContrasena('contraseña ficticia del servicio de sesiones');
});

afterAll(async () => {
  if (url === undefined) return;
  // Las sesiones se borran en cascada con su usuario.
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } });
  await prisma.$disconnect();
});

async function crearUsuario(extra: { activo?: boolean } = {}) {
  secuencia += 1;
  return prisma.usuario.create({
    data: {
      email: `${MARCA}-${secuencia}@ejemplo.example`,
      nombre: `Persona ${secuencia}`,
      rol: 'ADMINISTRATIVO',
      passwordHash: hashValido,
      passwordActualizadaEn: T0,
      activo: extra.activo ?? true,
    },
  });
}

async function vigentes(usuarioId: string, ahora: Date) {
  const sesiones = await prisma.sesion.findMany({ where: { usuarioId } });
  return sesiones.filter(
    (s) =>
      s.revocadaEn === null &&
      s.expiraEn > ahora &&
      ahora.getTime() < s.ultimaActividadEn.getTime() + DURACIONES_DE_SESION.inactividadMs,
  );
}

describe.skipIf(url === undefined)('crearSesion', () => {
  it('crea la sesión, guarda solo el hash del token y registra el último acceso', async () => {
    const usuario = await crearUsuario();

    const creada = await servicio.crearSesion(usuario.id, hashValido, T0);

    expect(creada.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(creada.expiraEn).toEqual(en(7 * DIA));
    const fila = await prisma.sesion.findUniqueOrThrow({ where: { id: creada.sesionId } });
    expect(fila.tokenHash).toBe(sha256(creada.token));
    expect(Object.values(fila).map(String)).not.toContain(creada.token);
    expect(fila).toMatchObject({
      usuarioId: usuario.id,
      createdAt: T0,
      ultimaActividadEn: T0,
      revocadaEn: null,
    });
    expect(
      (await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).ultimoAccesoEn,
    ).toEqual(T0);
  });

  it('no crea sesiones para un usuario desactivado ni para uno inexistente', async () => {
    const inactivo = await crearUsuario({ activo: false });

    await expect(servicio.crearSesion(inactivo.id, hashValido, T0)).rejects.toBeInstanceOf(
      servicio.UsuarioNoHabilitadoError,
    );
    await expect(
      servicio.crearSesion('00000000-0000-4000-8000-00000000abcd', hashValido, T0),
    ).rejects.toBeInstanceOf(servicio.UsuarioNoHabilitadoError);
    expect(await prisma.sesion.count({ where: { usuarioId: inactivo.id } })).toBe(0);
  });

  it('borra las sesiones cerradas hace más de 7 días y conserva las recientes', async () => {
    const usuario = await crearUsuario();
    const vieja = await servicio.crearSesion(usuario.id, hashValido, T0);
    const reciente = await servicio.crearSesion(usuario.id, hashValido, en(9 * DIA));
    await servicio.revocarSesionPorToken(vieja.token, en(MINUTO));
    await servicio.revocarSesionPorToken(reciente.token, en(9 * DIA + MINUTO));

    await servicio.crearSesion(usuario.id, hashValido, en(10 * DIA));

    expect(await prisma.sesion.findUnique({ where: { id: vieja.sesionId } })).toBeNull();
    expect(await prisma.sesion.findUnique({ where: { id: reciente.sesionId } })).not.toBeNull();
  });

  it('no crea la sesión si la contraseña cambió después de verificarla (hash distinto)', async () => {
    const usuario = await crearUsuario();
    const otroHash = await hashearContrasena('la contraseña que la reemplazó');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { passwordHash: otroHash } });

    await expect(servicio.crearSesion(usuario.id, hashValido, T0)).rejects.toBeInstanceOf(
      servicio.CredencialesDesactualizadasError,
    );
    expect(await prisma.sesion.count({ where: { usuarioId: usuario.id } })).toBe(0);
    await expect(servicio.crearSesion(usuario.id, otroHash, T0)).resolves.toBeDefined();
  });

  it('reemplaza la sesión del token anterior en la misma transacción', async () => {
    const usuario = await crearUsuario();
    const anterior = await servicio.crearSesion(usuario.id, hashValido, T0);

    const nueva = await servicio.crearSesion(usuario.id, hashValido, en(MINUTO), {
      reemplazaA: anterior.token,
    });

    const vieja = await prisma.sesion.findUniqueOrThrow({ where: { id: anterior.sesionId } });
    expect(vieja.revocadaEn).toEqual(en(MINUTO));
    expect((await vigentes(usuario.id, en(MINUTO))).map((s) => s.id)).toEqual([nueva.sesionId]);
  });

  it('si la creación no ocurre, la sesión anterior NO se revoca', async () => {
    const usuario = await crearUsuario();
    const anterior = await servicio.crearSesion(usuario.id, hashValido, T0);
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { passwordHash: await hashearContrasena('otra') },
    });

    await expect(
      servicio.crearSesion(usuario.id, hashValido, en(MINUTO), { reemplazaA: anterior.token }),
    ).rejects.toBeInstanceOf(servicio.CredencialesDesactualizadasError);
    expect(
      (await prisma.sesion.findUniqueOrThrow({ where: { id: anterior.sesionId } })).revocadaEn,
    ).toBeNull();
  });

  it('ignora un token anterior mal formado o desconocido', async () => {
    const usuario = await crearUsuario();
    const propia = await servicio.crearSesion(usuario.id, hashValido, T0);

    for (const reemplazaA of ['basura', generarTokenDeSesion().token, undefined, 42]) {
      await expect(
        servicio.crearSesion(usuario.id, hashValido, en(MINUTO), { reemplazaA }),
      ).resolves.toBeDefined();
    }
    expect(
      (await prisma.sesion.findUniqueOrThrow({ where: { id: propia.sesionId } })).revocadaEn,
    ).toBeNull();
  });
});

describe.skipIf(url === undefined)('validarSesion', () => {
  it('con el token correcto devuelve la sesión y los datos VIGENTES del usuario', async () => {
    const usuario = await crearUsuario();
    const { token, sesionId } = await servicio.crearSesion(usuario.id, hashValido, T0);

    await expect(servicio.validarSesion(token, en(MINUTO))).resolves.toEqual({
      valida: true,
      sesion: {
        sesionId,
        expiraEn: en(7 * DIA),
        usuario: {
          id: usuario.id,
          email: usuario.email,
          nombre: usuario.nombre,
          rol: 'ADMINISTRATIVO',
          debeCambiarPassword: true,
        },
      },
    });
  });

  it('un cambio de rol o de datos se ve en la validación siguiente (no hay caché)', async () => {
    const usuario = await crearUsuario();
    const { token } = await servicio.crearSesion(usuario.id, hashValido, T0);

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { rol: 'CONSULTA', debeCambiarPassword: false },
    });

    const resultado = await servicio.validarSesion(token, en(MINUTO));
    expect(resultado).toMatchObject({
      valida: true,
      sesion: { usuario: { rol: 'CONSULTA', debeCambiarPassword: false } },
    });
  });

  it.each([
    ['un token que no existe', () => generarTokenDeSesion().token, 'INEXISTENTE'],
    ['un token mal formado', () => 'no-es-un-token', 'TOKEN_MAL_FORMADO'],
    ['el hash guardado en lugar del token', () => 'a'.repeat(64), 'TOKEN_MAL_FORMADO'],
  ])('rechaza %s', async (_caso, token, motivo) => {
    await expect(servicio.validarSesion(token(), T0)).resolves.toEqual({ valida: false, motivo });
  });

  it('vence por duración absoluta a los 7 días exactos, aunque haya actividad', async () => {
    const usuario = await crearUsuario();
    const { token } = await servicio.crearSesion(usuario.id, hashValido, T0);
    // Actividad cada 20 h (menos que la inactividad de 24 h) durante toda la semana.
    for (let t = 20 * HORA; t < 7 * DIA; t += 20 * HORA) {
      expect(await servicio.validarSesion(token, en(t))).toMatchObject({ valida: true });
    }

    await expect(servicio.validarSesion(token, en(7 * DIA - 1))).resolves.toMatchObject({
      valida: true,
    });
    await expect(servicio.validarSesion(token, en(7 * DIA))).resolves.toEqual({
      valida: false,
      motivo: 'VENCIDA_POR_DURACION',
    });
  });

  it('vence por inactividad a las 24 h exactas y no revive', async () => {
    const usuario = await crearUsuario();
    const { token, sesionId } = await servicio.crearSesion(usuario.id, hashValido, T0);

    await expect(servicio.validarSesion(token, en(24 * HORA - 1))).resolves.toMatchObject({
      valida: true,
    });
    const tras = await prisma.sesion.findUniqueOrThrow({ where: { id: sesionId } });
    expect(tras.ultimaActividadEn).toEqual(en(24 * HORA - 1));

    await expect(servicio.validarSesion(token, en(48 * HORA - 1))).resolves.toEqual({
      valida: false,
      motivo: 'VENCIDA_POR_INACTIVIDAD',
    });
    // La actividad tardía (de un pedido validado justo antes) no puede revivirla.
    await expect(servicio.registrarActividad(sesionId, en(48 * HORA))).resolves.toBe(false);
    expect(
      (await prisma.sesion.findUniqueOrThrow({ where: { id: sesionId } })).ultimaActividadEn,
    ).toEqual(en(24 * HORA - 1));
  });

  it('con el usuario desactivado la sesión deja de valer', async () => {
    const usuario = await crearUsuario();
    const { token } = await servicio.crearSesion(usuario.id, hashValido, T0);

    await prisma.usuario.update({ where: { id: usuario.id }, data: { activo: false } });

    await expect(servicio.validarSesion(token, en(MINUTO))).resolves.toEqual({
      valida: false,
      motivo: 'USUARIO_INACTIVO',
    });
  });
});

describe.skipIf(url === undefined)('registro de actividad', () => {
  it('escribe como mucho una vez por minuto y nunca pisa una fecha más reciente', async () => {
    const usuario = await crearUsuario();
    const { token, sesionId } = await servicio.crearSesion(usuario.id, hashValido, T0);
    const ultima = async () =>
      (await prisma.sesion.findUniqueOrThrow({ where: { id: sesionId } })).ultimaActividadEn;

    await servicio.validarSesion(token, en(30 * SEGUNDO));
    expect(await ultima()).toEqual(T0);

    await servicio.validarSesion(token, en(2 * MINUTO));
    expect(await ultima()).toEqual(en(2 * MINUTO));

    // Un pedido más viejo que llega tarde no retrocede la fecha.
    await expect(servicio.registrarActividad(sesionId, en(90 * SEGUNDO))).resolves.toBe(false);
    expect(await ultima()).toEqual(en(2 * MINUTO));
  });

  it('con pedidos simultáneos, escribe uno solo', async () => {
    const usuario = await crearUsuario();
    const { sesionId } = await servicio.crearSesion(usuario.id, hashValido, T0);

    const escrituras = await Promise.all(
      Array.from({ length: 8 }, () => servicio.registrarActividad(sesionId, en(5 * MINUTO))),
    );

    expect(escrituras.filter(Boolean)).toHaveLength(1);
  });

  it('una sesión revocada no recupera actividad', async () => {
    const usuario = await crearUsuario();
    const { token, sesionId } = await servicio.crearSesion(usuario.id, hashValido, T0);
    await servicio.revocarSesionPorToken(token, en(MINUTO));

    await expect(servicio.registrarActividad(sesionId, en(10 * MINUTO))).resolves.toBe(false);
    await expect(servicio.validarSesion(token, en(10 * MINUTO))).resolves.toEqual({
      valida: false,
      motivo: 'REVOCADA',
    });
  });
});

describe.skipIf(url === undefined)('revocación', () => {
  it('por token: persistente e idempotente, sin revelar nada para tokens ajenos o inválidos', async () => {
    const usuario = await crearUsuario();
    const { token, sesionId } = await servicio.crearSesion(usuario.id, hashValido, T0);

    await expect(servicio.revocarSesionPorToken(token, en(MINUTO))).resolves.toBe(true);
    await expect(servicio.revocarSesionPorToken(token, en(2 * MINUTO))).resolves.toBe(false);
    await expect(
      servicio.revocarSesionPorToken(generarTokenDeSesion().token, en(MINUTO)),
    ).resolves.toBe(false);
    await expect(servicio.revocarSesionPorToken('basura', en(MINUTO))).resolves.toBe(false);

    const fila = await prisma.sesion.findUniqueOrThrow({ where: { id: sesionId } });
    expect(fila.revocadaEn).toEqual(en(MINUTO)); // la segunda revocación no reescribió la fecha
    await expect(servicio.validarSesion(token, en(3 * MINUTO))).resolves.toEqual({
      valida: false,
      motivo: 'REVOCADA',
    });
  });

  it('dos revocaciones simultáneas de la misma sesión: escribe una sola', async () => {
    const usuario = await crearUsuario();
    const { token } = await servicio.crearSesion(usuario.id, hashValido, T0);

    const resultados = await Promise.all(
      Array.from({ length: 6 }, () => servicio.revocarSesionPorToken(token, en(MINUTO))),
    );

    expect(resultados.filter(Boolean)).toHaveLength(1);
  });

  it('una sesión específica solo se revoca si es de ese usuario', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    const deAna = await servicio.crearSesion(ana.id, hashValido, T0);

    await expect(
      servicio.revocarSesionDeUsuario(beto.id, deAna.sesionId, en(MINUTO)),
    ).resolves.toBe(false);
    await expect(servicio.validarSesion(deAna.token, en(MINUTO))).resolves.toMatchObject({
      valida: true,
    });

    await expect(servicio.revocarSesionDeUsuario(ana.id, deAna.sesionId, en(MINUTO))).resolves.toBe(
      true,
    );
  });

  it('revocar todas las de un usuario no toca las de otro', async () => {
    const ana = await crearUsuario();
    const beto = await crearUsuario();
    await servicio.crearSesion(ana.id, hashValido, T0);
    await servicio.crearSesion(ana.id, hashValido, T0);
    const deBeto = await servicio.crearSesion(beto.id, hashValido, T0);

    await expect(servicio.revocarSesionesDeUsuario(ana.id, { ahora: en(MINUTO) })).resolves.toBe(2);
    await expect(servicio.revocarSesionesDeUsuario(ana.id, { ahora: en(MINUTO) })).resolves.toBe(0);

    expect(await vigentes(ana.id, en(MINUTO))).toHaveLength(0);
    await expect(servicio.validarSesion(deBeto.token, en(MINUTO))).resolves.toMatchObject({
      valida: true,
    });
  });

  it('dentro de una transacción del llamador que falla, no revoca nada (rollback)', async () => {
    const usuario = await crearUsuario();
    const { token } = await servicio.crearSesion(usuario.id, hashValido, T0);

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.usuario.update({ where: { id: usuario.id }, data: { activo: false } });
        await servicio.revocarSesionesDeUsuario(usuario.id, { ahora: en(MINUTO), tx });
        throw new Error('falla posterior simulada');
      }),
    ).rejects.toThrow('falla posterior simulada');

    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).activo).toBe(
      true,
    );
    await expect(servicio.validarSesion(token, en(2 * MINUTO))).resolves.toMatchObject({
      valida: true,
    });
  });

  it('con un reloj que retrocede, la revocación no viola el CHECK: usa el inicio de la sesión', async () => {
    const usuario = await crearUsuario();
    const { sesionId } = await servicio.crearSesion(usuario.id, hashValido, en(HORA));

    await expect(servicio.revocarSesionDeUsuario(usuario.id, sesionId, T0)).resolves.toBe(true);

    expect((await prisma.sesion.findUniqueOrThrow({ where: { id: sesionId } })).revocadaEn).toEqual(
      en(HORA),
    );
  });
});

describe.skipIf(url === undefined)('límite de sesiones vigentes', () => {
  it('es 10 (propuesta del ADR)', () => {
    expect(servicio.LIMITE_DE_SESIONES_VIGENTES).toBe(10);
  });

  it('la sesión número 11 revoca la de actividad más vieja', async () => {
    const usuario = await crearUsuario();
    const creadas = [];
    for (let i = 0; i < 10; i += 1)
      creadas.push(await servicio.crearSesion(usuario.id, hashValido, en(i * MINUTO)));
    // La primera tiene actividad reciente: deja de ser la "más vieja".
    await servicio.validarSesion(creadas[0]?.token, en(20 * MINUTO));

    const undecima = await servicio.crearSesion(usuario.id, hashValido, en(21 * MINUTO));

    const ahora = en(22 * MINUTO);
    const ids = (await vigentes(usuario.id, ahora)).map((s) => s.id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain(undecima.sesionId);
    expect(ids).toContain(creadas[0]?.sesionId);
    expect(ids).not.toContain(creadas[1]?.sesionId); // la de actividad más vieja
    await expect(servicio.validarSesion(creadas[1]?.token, ahora)).resolves.toEqual({
      valida: false,
      motivo: 'REVOCADA',
    });
  });

  it('las revocadas y las vencidas no cuentan para el límite', async () => {
    const usuario = await crearUsuario();
    const creadas = [];
    for (let i = 0; i < 10; i += 1)
      creadas.push(await servicio.crearSesion(usuario.id, hashValido, T0));
    for (const sesion of creadas.slice(0, 3))
      await servicio.revocarSesionPorToken(sesion.token, en(MINUTO));

    for (let i = 0; i < 3; i += 1)
      await servicio.crearSesion(usuario.id, hashValido, en(2 * MINUTO));

    expect(await vigentes(usuario.id, en(3 * MINUTO))).toHaveLength(10);
    for (const sesion of creadas.slice(3)) {
      await expect(servicio.validarSesion(sesion.token, en(3 * MINUTO))).resolves.toMatchObject({
        valida: true,
      });
    }

    // Pasadas 24 h sin actividad, ninguna está vigente: una creación nueva no revoca nada.
    const despues = en(2 * DIA);
    await servicio.crearSesion(usuario.id, hashValido, despues);
    expect(
      await prisma.sesion.count({ where: { usuarioId: usuario.id, revocadaEn: despues } }),
    ).toBe(0);
  });

  it('con creaciones simultáneas no se supera el límite (bloqueo de la fila del usuario)', async () => {
    for (let ronda = 0; ronda < 3; ronda += 1) {
      const usuario = await crearUsuario();
      for (let i = 0; i < 9; i += 1) await servicio.crearSesion(usuario.id, hashValido, T0);

      const resultados = await Promise.allSettled(
        Array.from({ length: 8 }, () => servicio.crearSesion(usuario.id, hashValido, en(MINUTO))),
      );

      expect(resultados.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await vigentes(usuario.id, en(2 * MINUTO))).toHaveLength(10);
    }
  });

  it('veinte inicios de sesión simultáneos desde cero dejan exactamente 10 vigentes, sin errores', async () => {
    const usuario = await crearUsuario();

    const resultados = await Promise.allSettled(
      Array.from({ length: 20 }, () => servicio.crearSesion(usuario.id, hashValido, T0)),
    );

    expect(resultados.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await vigentes(usuario.id, en(MINUTO))).toHaveLength(10);
    expect(await prisma.sesion.count({ where: { usuarioId: usuario.id } })).toBe(20);
  });
});

describe.skipIf(url === undefined)('desactivación mientras se crea una sesión', () => {
  it('la creación espera a la desactivación y no deja una sesión utilizable', async () => {
    const usuario = await crearUsuario();
    let marcarBloqueado!: () => void;
    const bloqueado = new Promise<void>((resolve) => (marcarBloqueado = resolve));

    // Como hará HU4.5: actualiza primero la fila del usuario y después revoca, en una transacción.
    const desactivacion = prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: usuario.id }, data: { activo: false } });
      marcarBloqueado();
      await new Promise((resolve) => setTimeout(resolve, 300)); // mantiene el bloqueo de la fila
      await servicio.revocarSesionesDeUsuario(usuario.id, { ahora: en(MINUTO), tx });
    });
    await bloqueado;
    const creacion = servicio.crearSesion(usuario.id, hashValido, en(MINUTO));

    await desactivacion;
    await expect(creacion).rejects.toBeInstanceOf(servicio.UsuarioNoHabilitadoError);
    expect(await vigentes(usuario.id, en(2 * MINUTO))).toHaveLength(0);
  });
});
