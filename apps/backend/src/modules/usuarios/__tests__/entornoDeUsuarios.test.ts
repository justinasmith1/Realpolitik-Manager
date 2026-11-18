// Unidad: la guarda de aislamiento de las suites de integración de usuarios, con conexiones FALSAS
// (ninguna base real, nunca `realpolitik_db`). Comprueba que una conexión que no está en la base
// descartable de la URL hace rechazar la preparación antes de cualquier escritura. También, los
// mensajes de `esperarEnEspera` cuando la espera de un bloqueo no se cumple.

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  type Consultable,
  cuentasDePrueba,
  esperarEnEspera,
  exigirBaseDePrueba,
} from './entornoDeUsuarios';

const URL_DE_PRUEBA = 'postgresql://u:p@127.0.0.1:5432/realpolitik_hu45_test?schema=public';
const SERVIDOR = '2026-11-15 10:00:00+00@5432';

/** Una conexión falsa que responde `base` y `servidor`, y registra cualquier escritura. */
function falsa(base: string, servidor = SERVIDOR) {
  const escrituras = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  };
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ base, servidor }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $executeRaw: escrituras.$executeRaw,
    $executeRawUnsafe: escrituras.$executeRawUnsafe,
    $transaction: escrituras.$transaction,
    usuario: {
      create: escrituras.create,
      deleteMany: escrituras.deleteMany,
      update: escrituras.update,
    },
  };
  return {
    db: db as unknown as PrismaClient,
    consultas: db.$queryRaw,
    desconectar: db.$disconnect,
    sinEscrituras: () => {
      for (const espia of Object.values(escrituras)) expect(espia).not.toHaveBeenCalled();
    },
  };
}

const preparar = (
  app: ReturnType<typeof falsa>,
  referencia: ReturnType<typeof falsa>,
  url = URL_DE_PRUEBA,
) =>
  cuentasDePrueba({
    url,
    prisma: app.db,
    marca: 'usuarios-prueba',
    hash: '$argon2id$v=19$m=19456,t=2,p=1$x$y',
    abrir: () => referencia.db,
  });

describe('guarda de aislamiento (exigirBaseDePrueba / cuentasDePrueba)', () => {
  it('URL válida, pero la conexión efectiva está en otra base: rechaza sin escribir nada', async () => {
    const referencia = falsa('realpolitik_hu45_test');
    // Como un `lib/prisma` cargado antes de fijar DATABASE_URL, que tomó la base del `.env`.
    const app = falsa('realpolitik_db');

    await expect(preparar(app, referencia)).rejects.toThrow(/apunta a "realpolitik_db"/);
    app.sinEscrituras();
    referencia.sinEscrituras();
    expect(referencia.desconectar).toHaveBeenCalled();
  });

  it('misma base por nombre pero en OTRO servidor: rechaza', async () => {
    const referencia = falsa('realpolitik_hu45_test');
    const app = falsa('realpolitik_hu45_test', '2026-01-01 00:00:00+00@5433');
    await expect(preparar(app, referencia)).rejects.toThrow(/no se ejecuta nada/);
    app.sinEscrituras();
  });

  it('URL con un nombre que no es descartable: rechaza sin abrir ni consultar ninguna conexión', async () => {
    const referencia = falsa('realpolitik_db');
    const app = falsa('realpolitik_db');
    const abrir = vi.fn(() => referencia.db);
    await expect(
      exigirBaseDePrueba('postgresql://u:p@127.0.0.1:5432/realpolitik_db', [app.db], { abrir }),
    ).rejects.toThrow(/no es una base descartable/);
    expect(abrir).not.toHaveBeenCalled();
    expect(app.consultas).not.toHaveBeenCalled();
    app.sinEscrituras();
  });

  it('la URL lleva a otra base que la de su nombre: rechaza', async () => {
    const referencia = falsa('otra_base_test');
    const app = falsa('otra_base_test');
    await expect(preparar(app, referencia)).rejects.toThrow(/La URL de prueba lleva a/);
    app.sinEscrituras();
  });

  it('una sola conexión equivocada entre varias alcanza para rechazar', async () => {
    const referencia = falsa('realpolitik_hu45_test');
    const buenas = [falsa('realpolitik_hu45_test'), falsa('realpolitik_hu45_test')];
    const mala = falsa('realpolitik_test');
    await expect(
      exigirBaseDePrueba(URL_DE_PRUEBA, [...buenas.map((b) => b.db), mala.db], {
        abrir: () => referencia.db,
      }),
    ).rejects.toThrow(/apunta a "realpolitik_test"/);
    for (const c of [...buenas, mala]) c.sinEscrituras();
  });

  it('si la referencia no responde: rechaza (y la desconecta)', async () => {
    const referencia = falsa('realpolitik_hu45_test');
    referencia.consultas.mockRejectedValueOnce(new Error('sin conexión'));
    const app = falsa('realpolitik_hu45_test');
    await expect(preparar(app, referencia)).rejects.toThrow('sin conexión');
    expect(referencia.desconectar).toHaveBeenCalled();
    app.sinEscrituras();
  });

  it('todo coincide: prepara las cuentas, y la limpieza solo borra las de la marca de la corrida', async () => {
    const referencia = falsa('realpolitik_hu45_test');
    const app = falsa('realpolitik_hu45_test');
    const cuentas = await preparar(app, referencia);
    app.sinEscrituras(); // preparar no escribe: solo verifica

    await cuentas.limpiar();
    const deleteMany = (app.db.usuario.deleteMany as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(deleteMany).toEqual([[{ where: { email: { startsWith: 'usuarios-prueba-' } } }]]);
    expect(cuentas.email('a')).toBe('usuarios-prueba-a@pruebas.example');
  });
});

/**
 * Una conexión falsa para `esperarEnEspera`: responde a la consulta de las esperas con `pids()` y a
 * la de la actividad con `actividad` (o falla, si es un `Error`).
 */
function base(pids: () => number[], actividad: unknown[] | Error = []) {
  const $queryRaw = vi.fn((partes: TemplateStringsArray) => {
    const sql = partes.join('?');
    if (sql.includes("wait_event_type = 'Lock'")) {
      return Promise.resolve(pids().map((pid) => ({ pid })));
    }
    return actividad instanceof Error ? Promise.reject(actividad) : Promise.resolve(actividad);
  });
  return { db: { $queryRaw } as unknown as Consultable, $queryRaw };
}

/** Como un error de Prisma: el texto del motor al final del mensaje y un `code`. */
function errorDePrisma(codigo: string, texto: string) {
  const error = new Error(`\nInvalid \`prisma.$transaction()\` invocation:\n\n\n${texto}`);
  error.name = 'PrismaClientKnownRequestError';
  return Object.assign(error, { code: codigo });
}

const nunca = () => new Promise<never>(() => undefined);

describe('esperarEnEspera: diagnóstico de una espera que no se cumple', () => {
  it('devuelve los PIDs en cuanto hay tantas conexiones esperando como se pidió', async () => {
    let vuelta = 0;
    const { db, $queryRaw } = base(() => (++vuelta >= 3 ? [41, 42] : [41]));
    await expect(esperarEnEspera(db, 'UPDATE "Sesion"', 2, { mientras: nunca() })).resolves.toEqual(
      [41, 42],
    );
    expect($queryRaw).toHaveBeenCalledTimes(3);
  });

  it('si la operación se rechaza antes de bloquearse, falla en el acto con su error (no espera el plazo)', async () => {
    const { db } = base(() => []);
    const operacion = Promise.reject(
      errorDePrisma(
        'P2028',
        'Transaction API error: Unable to start a transaction in the given time.',
      ),
    );
    const inicio = Date.now();

    const fallo = esperarEnEspera(db, 'UPDATE "Sesion"', 1, {
      plazoMs: 5_000,
      mientras: operacion,
    });

    await expect(fallo).rejects.toThrow(
      /una operación terminó antes de quedar esperando \(\d+ ms\): rechazó con PrismaClientKnownRequestError P2028: Transaction API error: Unable to start a transaction in the given time\.\nSe esperaban 1 conexión\(es\) esperando un bloqueo en: UPDATE "Sesion"; había 0\./,
    );
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it.each([
    [
      'una respuesta HTTP',
      { status: 500, body: { error: { code: 'INTERNAL_ERROR' } } },
      'respondió 500 INTERNAL_ERROR',
    ],
    [
      'un resultado fallido',
      { ok: false, error: new TypeError('x es undefined') },
      'falló con TypeError: x es undefined',
    ],
    ['un resultado exitoso', { ok: true, valor: 1 }, 'se completó'],
  ])('si la operación termina con %s, lo informa', async (_caso, valor, esperado) => {
    const { db } = base(() => []);
    await expect(
      esperarEnEspera(db, 'auth:crear-sesion', 1, { mientras: [nunca(), Promise.resolve(valor)] }),
    ).rejects.toThrow(`: ${esperado}\n`);
  });

  it('si se agota el plazo, dice cuánto esperó y qué hacía cada conexión, marcando las que coinciden', async () => {
    const { db } = base(
      () => [],
      [
        {
          pid: 7,
          estado: 'active',
          espera: 'Lock/transactionid',
          ms: 120,
          consulta: 'SELECT 1 /* otra cosa */',
        },
        {
          pid: 9,
          estado: 'active',
          espera: null,
          ms: 95,
          consulta: 'UPDATE "Sesion" SET "revocadaEn" = $1',
        },
      ],
    );
    const inicio = Date.now();

    const fallo = esperarEnEspera(db, 'UPDATE "Sesion"', 1, { plazoMs: 100, mientras: nunca() });

    await expect(fallo).rejects.toThrow(
      /^esperarEnEspera: a los \d+ ms \(\d+ consultas, plazo 100 ms\) había 0 de 1 conexión\(es\) esperando un bloqueo en: UPDATE "Sesion"\./,
    );
    const mensaje = await fallo.catch((error: Error) => error.message);
    expect(mensaje).toContain(
      '    pid 7 · active · Lock/transactionid · 120 ms · SELECT 1 /* otra cosa */',
    );
    expect(mensaje).toContain(
      '  * pid 9 · active · sin espera · 95 ms · UPDATE "Sesion" SET "revocadaEn" = $1',
    );
    expect(mensaje).toContain('Si falla una prueba de concurrencia');
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it('si no hay conexiones activas o no se puede leer la actividad, también lo dice', async () => {
    await expect(esperarEnEspera(base(() => []).db, 'x', 1, { plazoMs: 30 })).rejects.toThrow(
      '(ninguna conexión activa ni en transacción)',
    );
    await expect(
      esperarEnEspera(base(() => [], new Error('conexión cerrada')).db, 'x', 1, { plazoMs: 30 }),
    ).rejects.toThrow('(no se pudo leer pg_stat_activity: Error: conexión cerrada)');
  });

  it('el plazo es de tiempo, no de vueltas: con una base lenta no se estira', async () => {
    const lenta = vi.fn(
      () => new Promise<{ pid: number }[]>((resolve) => setTimeout(() => resolve([]), 40)),
    );
    const db = { $queryRaw: lenta } as unknown as Consultable;
    const inicio = Date.now();
    await expect(esperarEnEspera(db, 'x', 1, { plazoMs: 150 })).rejects.toThrow('plazo 150 ms');
    // Cada vuelta tarda ~60 ms (40 de consulta + 20 de pausa): el plazo corta a las ~3 vueltas.
    expect(Date.now() - inicio).toBeLessThan(600);
  });
});
