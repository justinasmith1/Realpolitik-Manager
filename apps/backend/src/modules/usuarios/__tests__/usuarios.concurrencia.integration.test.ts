// Último ADMINISTRADOR, carreras y fallas, contra PostgreSQL REAL y con conexiones independientes
// (un `PrismaClient` por "proceso"; nada de esto se simula con mocks).
//
// - La regla "siempre queda un ADMINISTRADOR activo" es global a la base: la suite necesita que no
//   haya NINGÚN administrador activo ajeno al empezar (como `primerAdministrador.integration`). Si lo
//   hay (por ejemplo, la cuenta de QA manual), falla con un mensaje y no lo toca. Conviene correrla
//   en una base descartable nueva.
// - Las carreras se ordenan con bloqueos reales: una tercera conexión retiene filas (`FOR UPDATE`) y
//   se espera, en `pg_stat_activity`, a que cada operación esté esperando su bloqueo antes de soltar.
// - Las fallas se fuerzan solo contra un PostgreSQL LOCAL: terminando conexiones
//   (`pg_terminate_backend`) y con triggers temporales sobre la fila de un usuario de prueba
//   (`rp_prueba_usuarios_<marca>`), que se borran al terminar cada test y otra vez en `afterAll`.

import { type PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { BaseDeDatosNoDisponibleError } from '../../../lib/baseDeDatosNoDisponible';
import type * as Autenticacion from '../../auth/autenticacion.service';
import { hashearContrasena, verificarContrasena } from '../../auth/contrasenas';
import { ProteccionDeLogin } from '../../auth/proteccionDeLogin';
import type * as Sesiones from '../../auth/sesiones.service';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
// Solo tipos: el servicio carga `lib/prisma`, que tiene que leer `DATABASE_URL` ya fijada.
import type * as Servicio from '../usuarios.service';

import {
  capturarEventos,
  conexion,
  CONSULTA,
  type Cuentas,
  cuentasDePrueba,
  enEspera,
  esperarEnEspera,
  nuevaMarca,
  PASSWORD,
  retenerFilas,
  soltarRetenidas,
} from './entornoDeUsuarios';

vi.setConfig({ testTimeout: 30_000 });

const url = urlDeBaseDescartable();
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]', 'db']);
if (url !== undefined && !HOSTS_LOCALES.has(new URL(url).hostname)) {
  throw new Error(
    'Estas pruebas terminan conexiones y crean triggers: solo contra una base local.',
  );
}

const MARCA = nuevaMarca('usuarios-conc');
/** Nombre de los triggers, funciones y secuencias temporales de esta corrida. */
const TEMPORAL = `rp_prueba_usuarios_${MARCA.replace(/[^a-z0-9]/gi, '_')}`;

let prisma: PrismaClient;
/** Dos "procesos" que administran y una conexión para retener bloqueos y forzar fallas. */
let adminA: PrismaClient;
let adminB: PrismaClient;
let tercera: PrismaClient;
let cuentas: Cuentas;
let auth: typeof Autenticacion;
let sesiones: typeof Sesiones;
let s: typeof Servicio;
/** La guarda pasó: solo entonces se limpia o se toca el esquema (triggers temporales). */
let verificada = false;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  auth = await import('../../auth/autenticacion.service');
  sesiones = await import('../../auth/sesiones.service');
  s = await import('../usuarios.service');
  adminA = conexion(url);
  adminB = conexion(url);
  tercera = conexion(url);
  // La guarda corre antes de cualquier escritura; si falla, la suite no arranca.
  cuentas = await cuentasDePrueba({
    url,
    prisma,
    otras: [adminA, adminB, tercera],
    marca: MARCA,
    hash: await hashearContrasena(PASSWORD),
  });
  verificada = true;
  const ajenos = await prisma.usuario.count({ where: { rol: 'ADMINISTRADOR', activo: true } });
  if (ajenos > 0) {
    throw new Error(
      `La base de pruebas tiene ${ajenos} administrador(es) activo(s) ajeno(s): esta suite no los toca y no puede probar el último administrador. Usá una base descartable sin administradores.`,
    );
  }
});

let eventos: ReturnType<typeof capturarEventos>;
beforeAll(() => {
  eventos = capturarEventos();
});

afterEach(async () => {
  eventos?.soltar();
  eventos = capturarEventos();
  if (url === undefined || !verificada) return;
  await soltarRetenidas();
  await quitarTemporales();
  await cuentas.limpiar();
});

afterAll(async () => {
  eventos?.soltar();
  if (url === undefined) return;
  if (verificada) {
    await quitarTemporales();
    await cuentas.limpiar();
  }
  await Promise.all([prisma, adminA, adminB, tercera].map((db) => db?.$disconnect()));
});

const login = (email: string, password = PASSWORD) =>
  auth.iniciarSesion({ email, password, ip: '192.0.2.20' }, new ProteccionDeLogin());

/** El resultado de una promesa, sin que un rechazo quede sin manejar mientras se espera otra cosa. */
const resultado = <T>(promesa: Promise<T>) =>
  promesa.then(
    (valor) => ({ ok: true as const, valor }),
    (error: unknown) => ({ ok: false as const, error }),
  );

const fila = (id: string) => prisma.usuario.findUniqueOrThrow({ where: { id } });

const vigentes = (usuarioId: string) =>
  prisma.sesion.count({ where: { usuarioId, revocadaEn: null, expiraEn: { gt: new Date() } } });

const administradoresActivos = () =>
  prisma.usuario.count({ where: { ...cuentas.propias, rol: 'ADMINISTRADOR', activo: true } });

async function quitarTemporales() {
  await tercera.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${TEMPORAL}" ON "Usuario"`);
  await tercera.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${TEMPORAL}"()`);
  await tercera.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${TEMPORAL}"`);
}

const exigirUuid = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('id de usuario inesperado');
};

/**
 * Un trigger sobre la fila de `usuarioId` que hace fallar con 40001 (serialization_failure) las
 * primeras `veces` actualizaciones: un conflicto real de PostgreSQL, que revierte la transacción.
 * La secuencia (no transaccional) cuenta los intentos, también los revertidos.
 */
async function crearConflictos(usuarioId: string, veces: number) {
  exigirUuid(usuarioId);
  await tercera.$executeRawUnsafe(`CREATE SEQUENCE "${TEMPORAL}"`);
  await tercera.$executeRawUnsafe(`
    CREATE FUNCTION "${TEMPORAL}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('"${TEMPORAL}"') <= ${Number(veces)} THEN
        RAISE EXCEPTION 'conflicto simulado' USING ERRCODE = 'serialization_failure';
      END IF;
      RETURN NEW;
    END $$`);
  await tercera.$executeRawUnsafe(`
    CREATE TRIGGER "${TEMPORAL}" BEFORE UPDATE ON "Usuario" FOR EACH ROW
    WHEN (NEW."id" = '${usuarioId}'::uuid) EXECUTE FUNCTION "${TEMPORAL}"()`);
  return {
    async intentos(): Promise<number> {
      const [fila] = await tercera.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT last_value AS n FROM "${TEMPORAL}"`,
      );
      return Number(fila?.n ?? 0);
    },
  };
}

/** Un trigger DIFERIDO sobre la fila de `usuarioId`: corre al confirmar y hace fallar el COMMIT. */
async function crearFallaAlConfirmar(usuarioId: string) {
  exigirUuid(usuarioId);
  await tercera.$executeRawUnsafe(`
    CREATE FUNCTION "${TEMPORAL}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falla simulada al confirmar'; END $$`);
  await tercera.$executeRawUnsafe(`
    CREATE CONSTRAINT TRIGGER "${TEMPORAL}" AFTER UPDATE ON "Usuario"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW."id" = '${usuarioId}'::uuid) EXECUTE FUNCTION "${TEMPORAL}"()`);
}

/**
 * Un trigger DIFERIDO sobre las altas con un email que empieza con `prefijo` (de esta corrida):
 * hace fallar el COMMIT de la inserción.
 */
async function crearFallaAlConfirmarAltas(prefijo: string) {
  if (!/^[a-z0-9-]+$/.test(prefijo)) throw new Error('prefijo inesperado');
  await tercera.$executeRawUnsafe(`
    CREATE FUNCTION "${TEMPORAL}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'falla simulada al confirmar'; END $$`);
  await tercera.$executeRawUnsafe(`
    CREATE CONSTRAINT TRIGGER "${TEMPORAL}" AFTER INSERT ON "Usuario"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (NEW."email" LIKE '${prefijo}-%') EXECUTE FUNCTION "${TEMPORAL}"()`);
}

/** La fila del usuario o el bloqueo de aviso: los dos bloqueos que puede esperar una operación. */
const BLOQUEOS_ADMINISTRATIVOS = [
  CONSULTA.bloqueoAdministrativo,
  CONSULTA.bloqueoDeAdministradores,
];

/** Un ADMINISTRATIVO que representa un pedido ya autorizado de alguien que dejó de administrar. */
const actorEnVuelo = () => cuentas.crear({ rol: 'ADMINISTRATIVO', alias: 'actor-en-vuelo' });

describe.skipIf(url === undefined)('último ADMINISTRADOR activo', () => {
  it('el único no puede ser desactivado ni perder su rol; sí cambiar el nombre', async () => {
    const unico = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const actor = await actorEnVuelo();
    const { sesion } = await login(unico.email);

    await expect(
      s.cambiarEstadoDeUsuario(adminA, { actorId: actor.id, usuarioId: unico.id, activo: false }),
    ).rejects.toEqual(new s.UltimoAdministradorError('desactivar'));
    for (const rol of ['ADMINISTRATIVO', 'CONSULTA']) {
      await expect(
        s.modificarUsuario(adminA, {
          actorId: actor.id,
          usuarioId: unico.id,
          cambios: { nombre: 'No se guarda', rol },
        }),
      ).rejects.toEqual(new s.UltimoAdministradorError('cambiar-rol'));
    }
    expect(await fila(unico.id)).toMatchObject({
      rol: 'ADMINISTRADOR',
      activo: true,
      nombre: unico.nombre,
    });
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([]);

    const renombrado = await s.modificarUsuario(adminA, {
      actorId: actor.id,
      usuarioId: unico.id,
      cambios: { nombre: 'Sigue Administrando' },
    });
    expect(renombrado.modificados).toEqual(['nombre']);
  });

  it('con dos, se puede desactivar o degradar a uno; al que queda, no', async () => {
    const a = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'a' });
    const b = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'b' });

    await s.cambiarEstadoDeUsuario(adminA, { actorId: a.id, usuarioId: b.id, activo: false });
    // El pedido de b ya había pasado la autorización: termina, pero la regla lo frena.
    await expect(
      s.cambiarEstadoDeUsuario(adminB, { actorId: b.id, usuarioId: a.id, activo: false }),
    ).rejects.toBeInstanceOf(s.UltimoAdministradorError);

    await s.cambiarEstadoDeUsuario(adminA, { actorId: a.id, usuarioId: b.id, activo: true });
    await s.modificarUsuario(adminA, {
      actorId: a.id,
      usuarioId: b.id,
      cambios: { rol: 'CONSULTA' },
    });
    await expect(
      s.modificarUsuario(adminB, { actorId: b.id, usuarioId: a.id, cambios: { rol: 'CONSULTA' } }),
    ).rejects.toBeInstanceOf(s.UltimoAdministradorError);
    expect(await administradoresActivos()).toBe(1);
    expect(await fila(a.id)).toMatchObject({ rol: 'ADMINISTRADOR', activo: true });
  });

  it('un ADMINISTRADOR desactivado no cuenta: degradarlo no toca al único activo', async () => {
    const a = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const b = await cuentas.crear({ rol: 'ADMINISTRADOR', activo: false });
    await s.modificarUsuario(adminA, {
      actorId: a.id,
      usuarioId: b.id,
      cambios: { rol: 'CONSULTA' },
    });
    expect(await fila(b.id)).toMatchObject({ rol: 'CONSULTA', activo: false });
    expect(await administradoresActivos()).toBe(1);
  });

  const cruces: [string, (yo: string, otro: string, db: PrismaClient) => Promise<unknown>][] = [
    [
      'dos desactivaciones cruzadas',
      (yo, otro, db) =>
        s.cambiarEstadoDeUsuario(db, { actorId: yo, usuarioId: otro, activo: false }),
    ],
    [
      'dos cambios de rol cruzados',
      (yo, otro, db) =>
        s.modificarUsuario(db, {
          actorId: yo,
          usuarioId: otro,
          cambios: { rol: 'ADMINISTRATIVO' },
        }),
    ],
  ];

  for (const [nombre, operacion] of cruces) {
    it(`${nombre}, a la vez y con los bloqueos en disputa: una se confirma, la otra se rechaza`, async () => {
      const a = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'a' });
      const b = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'b' });
      await login(a.email);
      await login(b.email);

      // Las dos filas retenidas: la primera operación toma el bloqueo de aviso y espera su fila; la
      // segunda espera el bloqueo de aviso. Sin ese bloqueo, las dos contarían al otro como activo.
      const retenidas = await retenerFilas(tercera, 'Usuario', [a.id, b.id]);
      const unoA = resultado(operacion(a.id, b.id, adminA));
      await esperarEnEspera(tercera, BLOQUEOS_ADMINISTRATIVOS, 1);
      const unoB = resultado(operacion(b.id, a.id, adminB));
      // Las dos bloqueadas, en el bloqueo que sea: con el de aviso, una espera la fila y la otra el
      // aviso; sin él, cada una esperaría su fila y las dos contarían a la otra como activa.
      await esperarEnEspera(tercera, BLOQUEOS_ADMINISTRATIVOS, 2);
      await retenidas.soltar();
      const salidas = await Promise.all([unoA, unoB]);

      expect(salidas.map((x) => x.ok).sort()).toEqual([false, true]);
      const rechazo = salidas.find((x) => !x.ok);
      expect(rechazo && !rechazo.ok && rechazo.error).toBeInstanceOf(s.UltimoAdministradorError);
      expect(await administradoresActivos()).toBe(1);
      const perdedor =
        (await fila(a.id)).rol === 'ADMINISTRADOR' && (await fila(a.id)).activo ? b : a;
      expect(await vigentes(perdedor.id)).toBe(0);
      expect(eventos.administrativos()).toHaveLength(1);
    });
  }

  it('mecanismo: la segunda operación que puede reducir administradores espera el bloqueo de aviso, no su fila', async () => {
    const a = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'a' });
    const b = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'b' });
    const retenidas = await retenerFilas(tercera, 'Usuario', [a.id, b.id]);
    const primera = resultado(
      s.cambiarEstadoDeUsuario(adminA, { actorId: a.id, usuarioId: b.id, activo: false }),
    );
    expect(await esperarEnEspera(tercera, CONSULTA.bloqueoAdministrativo)).toHaveLength(1);
    const segunda = resultado(
      s.modificarUsuario(adminB, { actorId: b.id, usuarioId: a.id, cambios: { rol: 'CONSULTA' } }),
    );
    expect(await esperarEnEspera(tercera, CONSULTA.bloqueoDeAdministradores)).toHaveLength(1);
    // La segunda NO llegó a pedir la fila de `a` (que también está retenida).
    expect(await enEspera(tercera, CONSULTA.bloqueoAdministrativo)).toHaveLength(1);
    await retenidas.soltar();
    await Promise.all([primera, segunda]);
  });

  it('una desactivación y un cambio de rol cruzados, a la vez: nunca quedan cero', async () => {
    const a = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'a' });
    const b = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'b' });
    const retenidas = await retenerFilas(tercera, 'Usuario', [a.id, b.id]);
    const desactivar = resultado(
      s.cambiarEstadoDeUsuario(adminA, { actorId: a.id, usuarioId: b.id, activo: false }),
    );
    await esperarEnEspera(tercera, BLOQUEOS_ADMINISTRATIVOS, 1);
    const degradar = resultado(
      s.modificarUsuario(adminB, { actorId: b.id, usuarioId: a.id, cambios: { rol: 'CONSULTA' } }),
    );
    await esperarEnEspera(tercera, BLOQUEOS_ADMINISTRATIVOS, 2);
    await retenidas.soltar();

    const salidas = await Promise.all([desactivar, degradar]);
    expect(salidas.filter((x) => x.ok)).toHaveLength(1);
    expect(await administradoresActivos()).toBe(1);
  });

  it('sin orden forzado, en ronda: tres administradores que se quitan unos a otros a la vez dejan exactamente uno', async () => {
    const conexiones = [adminA, adminB, tercera];
    for (let ronda = 0; ronda < 8; ronda += 1) {
      const admins = await Promise.all(
        [0, 1, 2].map((i) => cuentas.crear({ rol: 'ADMINISTRADOR', alias: `r${ronda}-${i}` })),
      );
      const salidas = await Promise.all(
        admins.map((yo, i) => {
          const otro = admins[(i + 1) % admins.length];
          if (otro === undefined) throw new Error('sin otro administrador');
          const db = conexiones[i] ?? adminA;
          return resultado<unknown>(
            (ronda + i) % 2 === 0
              ? s.cambiarEstadoDeUsuario(db, { actorId: yo.id, usuarioId: otro.id, activo: false })
              : s.modificarUsuario(db, {
                  actorId: yo.id,
                  usuarioId: otro.id,
                  cambios: { rol: 'CONSULTA' },
                }),
          );
        }),
      );
      expect(await administradoresActivos()).toBe(1);
      expect(salidas.filter((x) => x.ok)).toHaveLength(2);
      for (const salida of salidas) {
        if (!salida.ok) expect(salida.error).toBeInstanceOf(s.UltimoAdministradorError);
      }
      await cuentas.limpiar();
    }
  });

  it('dos desactivaciones simultáneas de la MISMA cuenta: una cambia, la otra no hace nada (un evento)', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear();
    await login(cuenta.email);
    const [x, y] = await Promise.all([
      s.cambiarEstadoDeUsuario(adminA, { actorId: actor.id, usuarioId: cuenta.id, activo: false }),
      s.cambiarEstadoDeUsuario(adminB, { actorId: actor.id, usuarioId: cuenta.id, activo: false }),
    ]);
    expect([x.cambio, y.cambio].sort()).toEqual([false, true]);
    expect(x.sesionesRevocadas + y.sesionesRevocadas).toBe(1);
    expect(eventos.administrativos().map((e) => e.evento)).toEqual(['usuarios.desactivado']);
    expect(await vigentes(cuenta.id)).toBe(0);
  });

  it('un cambio de rol y una desactivación simultáneos de la misma cuenta: se aplican los dos, en fila', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear({ rol: 'ADMINISTRATIVO' });
    await login(cuenta.email);
    await Promise.all([
      s.modificarUsuario(adminA, {
        actorId: actor.id,
        usuarioId: cuenta.id,
        cambios: { rol: 'CONSULTA' },
      }),
      s.cambiarEstadoDeUsuario(adminB, { actorId: actor.id, usuarioId: cuenta.id, activo: false }),
    ]);
    expect(await fila(cuenta.id)).toMatchObject({ rol: 'CONSULTA', activo: false });
    expect(await vigentes(cuenta.id)).toBe(0);
  });
});

describe.skipIf(url === undefined)('carreras con el inicio de sesión', () => {
  /**
   * Ordena una operación administrativa y un login sobre la fila de `usuarioId`: la tercera conexión
   * la retiene, se lanza `primero` y se espera a que espere el bloqueo, después `segundo`, y se
   * suelta. PostgreSQL da la fila en el orden de llegada.
   */
  async function enOrden<A, B>(
    usuarioId: string,
    primero: { lanzar: () => Promise<A>; espera: string },
    segundo: { lanzar: () => Promise<B>; espera: string },
  ) {
    const retenida = await retenerFilas(tercera, 'Usuario', [usuarioId]);
    const uno = resultado(primero.lanzar());
    await esperarEnEspera(tercera, primero.espera);
    const dos = resultado(segundo.lanzar());
    await esperarEnEspera(tercera, segundo.espera);
    await retenida.soltar();
    return Promise.all([uno, dos]);
  }

  it('desactivación antes que un login en curso: el login no crea ninguna sesión', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear();
    const [baja, entrada] = await enOrden(
      cuenta.id,
      {
        lanzar: () =>
          s.cambiarEstadoDeUsuario(adminA, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            activo: false,
          }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
    );
    expect(baja.ok).toBe(true);
    expect(entrada.ok).toBe(false);
    expect(!entrada.ok && entrada.error).toMatchObject({ motivoInterno: 'inactiva' });
    expect(await prisma.sesion.count({ where: { usuarioId: cuenta.id } })).toBe(0);
  });

  it('login antes que la desactivación: la sesión recién creada queda revocada', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear();
    const [entrada, baja] = await enOrden(
      cuenta.id,
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
      {
        lanzar: () =>
          s.cambiarEstadoDeUsuario(adminA, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            activo: false,
          }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
    );
    expect(entrada.ok && baja.ok).toBe(true);
    expect(baja.ok && baja.valor.sesionesRevocadas).toBe(1);
    if (entrada.ok)
      expect((await sesiones.validarSesion(entrada.valor.sesion.token)).valida).toBe(false);
    expect(await vigentes(cuenta.id)).toBe(0);
  });

  it('cambio de rol antes que un login en curso: la sesión nace después y ya tiene el rol nuevo', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear({ rol: 'ADMINISTRATIVO' });
    const [cambio, entrada] = await enOrden(
      cuenta.id,
      {
        lanzar: () =>
          s.modificarUsuario(adminA, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            cambios: { rol: 'CONSULTA' },
          }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
    );
    expect(cambio.ok && entrada.ok).toBe(true);
    if (!entrada.ok) return;
    const validada = await sesiones.validarSesion(entrada.valor.sesion.token);
    expect(validada.valida && validada.sesion.usuario.rol).toBe('CONSULTA');
    // El login leyó la cuenta antes del cambio, pero responde lo confirmado bajo el bloqueo con
    // el que creó la sesión: el rol del cuerpo es el de la sesión, no el leído al principio.
    expect(entrada.valor.usuario.rol).toBe('CONSULTA');
  });

  it('cambio de nombre antes que un login en curso: el cuerpo trae el nombre nuevo', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear();
    const [cambio, entrada] = await enOrden(
      cuenta.id,
      {
        lanzar: () =>
          s.modificarUsuario(adminA, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            cambios: { nombre: `${cuenta.nombre} renombrada` },
          }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
    );
    expect(cambio.ok && entrada.ok).toBe(true);
    expect(entrada.ok && entrada.valor.usuario.nombre).toBe(`${cuenta.nombre} renombrada`);
  });

  it('login antes que el cambio de rol: la sesión con el rol anterior queda revocada', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear({ rol: 'ADMINISTRATIVO' });
    const [entrada, cambio] = await enOrden(
      cuenta.id,
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
      {
        lanzar: () =>
          s.modificarUsuario(adminA, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            cambios: { rol: 'CONSULTA' },
          }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
    );
    expect(cambio.ok && cambio.valor.sesionesRevocadas).toBe(1);
    if (entrada.ok)
      expect((await sesiones.validarSesion(entrada.valor.sesion.token)).valida).toBe(false);
    expect(await vigentes(cuenta.id)).toBe(0);
  });

  it('restablecimiento antes que un login con la contraseña anterior: el login no crea la sesión', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear();
    const [restablecida, entrada] = await enOrden(
      cuenta.id,
      {
        lanzar: () => s.restablecerContrasena(adminA, { actorId: actor.id, usuarioId: cuenta.id }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
    );
    expect(restablecida.ok).toBe(true);
    expect(!entrada.ok && entrada.error).toMatchObject({ motivoInterno: 'credenciales' });
    expect(await prisma.sesion.count({ where: { usuarioId: cuenta.id } })).toBe(0);
    if (restablecida.ok) {
      await expect(
        login(cuenta.email, restablecida.valor.contrasenaTemporal),
      ).resolves.toBeDefined();
    }
  });

  it('login antes que el restablecimiento: esa sesión queda revocada y la contraseña anterior ya no sirve', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const cuenta = await cuentas.crear();
    const [entrada, restablecida] = await enOrden(
      cuenta.id,
      { lanzar: () => login(cuenta.email), espera: CONSULTA.bloqueoDelLogin },
      {
        lanzar: () => s.restablecerContrasena(adminA, { actorId: actor.id, usuarioId: cuenta.id }),
        espera: CONSULTA.bloqueoAdministrativo,
      },
    );
    expect(restablecida.ok && restablecida.valor.sesionesRevocadas).toBe(1);
    if (entrada.ok)
      expect((await sesiones.validarSesion(entrada.valor.sesion.token)).valida).toBe(false);
    expect(await vigentes(cuenta.id)).toBe(0);
    await expect(login(cuenta.email)).rejects.toMatchObject({ motivoInterno: 'credenciales' });
  });
});

describe.skipIf(url === undefined)('fallas de PostgreSQL', () => {
  async function preparar() {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const otroAdmin = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const { sesion } = await login(otroAdmin.email);
    return { actor, cuenta: otroAdmin, token: sesion.token, antes: await fila(otroAdmin.id) };
  }

  it(`un conflicto de serialización real se reintenta: con ${'INTENTOS'} − 1 conflictos, se confirma al último intento`, async () => {
    const { actor, cuenta, token } = await preparar();
    const conflictos = await crearConflictos(cuenta.id, s.INTENTOS - 1);

    const salida = await s.cambiarEstadoDeUsuario(adminA, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      activo: false,
    });

    expect(await conflictos.intentos()).toBe(s.INTENTOS);
    expect(salida).toMatchObject({ cambio: true, sesionesRevocadas: 1 });
    expect(await fila(cuenta.id)).toMatchObject({ activo: false });
    expect((await sesiones.validarSesion(token)).valida).toBe(false);
    expect(eventos.administrativos()).toHaveLength(1);
  });

  it('agotados los reintentos: ConflictoDeConcurrenciaError, sin escrituras parciales ni eventos', async () => {
    const { actor, cuenta, token, antes } = await preparar();
    const conflictos = await crearConflictos(cuenta.id, 1000);

    for (const operacion of [
      () =>
        s.cambiarEstadoDeUsuario(adminA, {
          actorId: actor.id,
          usuarioId: cuenta.id,
          activo: false,
        }),
      () =>
        s.modificarUsuario(adminA, {
          actorId: actor.id,
          usuarioId: cuenta.id,
          cambios: { rol: 'CONSULTA' },
        }),
      () => s.restablecerContrasena(adminA, { actorId: actor.id, usuarioId: cuenta.id }),
    ]) {
      await expect(operacion()).rejects.toBeInstanceOf(s.ConflictoDeConcurrenciaError);
    }

    expect(await conflictos.intentos()).toBe(3 * s.INTENTOS);
    expect(await fila(cuenta.id)).toEqual(antes);
    expect((await sesiones.validarSesion(token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([]);
    await quitarTemporales();
    await expect(login(cuenta.email)).resolves.toBeDefined();
  });

  it('alta: si falla el COMMIT de la inserción, no devuelve contraseña, no queda la cuenta ni se registra', async () => {
    const actor = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    await crearFallaAlConfirmarAltas(MARCA);
    const email = cuentas.email('alta-sin-commit');

    const salida = await resultado(
      s.crearUsuario(adminA, {
        actorId: actor.id,
        datos: { nombre: 'Sin Commit', email, rol: 'CONSULTA' },
      }),
    );

    expect(salida.ok).toBe(false);
    expect(await prisma.usuario.count({ where: { email } })).toBe(0);
    expect(eventos.administrativos()).toEqual([]);
  });

  it('si falla el COMMIT: no se informa éxito, no se devuelve contraseña, nada persiste ni se registra', async () => {
    const { actor, cuenta, token, antes } = await preparar();
    await crearFallaAlConfirmar(cuenta.id);

    for (const operacion of [
      () =>
        s.cambiarEstadoDeUsuario(adminA, {
          actorId: actor.id,
          usuarioId: cuenta.id,
          activo: false,
        }),
      () =>
        s.modificarUsuario(adminA, {
          actorId: actor.id,
          usuarioId: cuenta.id,
          cambios: { nombre: 'X' },
        }),
      () => s.restablecerContrasena(adminA, { actorId: actor.id, usuarioId: cuenta.id }),
    ]) {
      const error = await operacion().catch((e: unknown) => e);
      // Prisma 5.22 resuelve `$transaction` aunque el COMMIT falle: lo detecta `pg_xact_status`.
      expect(error).toBeInstanceOf(s.OperacionNoConfirmadaError);
      expect(JSON.stringify(error)).not.toMatch(/argon2/);
    }

    expect(await fila(cuenta.id)).toEqual(antes);
    expect((await sesiones.validarSesion(token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([]);
    await quitarTemporales();
    expect(await verificarContrasena((await fila(cuenta.id)).passwordHash, PASSWORD)).toBe(true);
  });

  it('si PostgreSQL corta la transacción a mitad (después de escribir la fila): BaseDeDatosNoDisponibleError y nada persiste', async () => {
    const { actor, cuenta, token, antes } = await preparar();
    const sesionId = (await sesiones.validarSesion(token)).valida
      ? (await prisma.sesion.findFirstOrThrow({ where: { usuarioId: cuenta.id } })).id
      : '';
    // La revocación (último paso, después de actualizar la fila) queda esperando esta sesión.
    const retenida = await retenerFilas(tercera, 'Sesion', [sesionId]);
    const baja = resultado(
      s.cambiarEstadoDeUsuario(adminA, { actorId: actor.id, usuarioId: cuenta.id, activo: false }),
    );
    const [pid] = await esperarEnEspera(tercera, CONSULTA.revocacion);
    await tercera.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
    const salida = await baja;
    await retenida.soltar();

    expect(!salida.ok && salida.error).toBeInstanceOf(BaseDeDatosNoDisponibleError);
    expect(await fila(cuenta.id)).toEqual(antes);
    expect((await sesiones.validarSesion(token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([]);

    // Se puede volver a intentar.
    await expect(
      s.cambiarEstadoDeUsuario(adminA, { actorId: actor.id, usuarioId: cuenta.id, activo: false }),
    ).resolves.toMatchObject({ cambio: true, sesionesRevocadas: 1 });
  });
});
