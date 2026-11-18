// Unidad: la preparación compartida de las suites de integración (`conectarBaseDePrueba`), con
// `lib/prisma` y las conexiones FALSOS (ninguna base real). Comprueba el orden (guarda de la suite,
// `DATABASE_URL`, import, verificación) y que cualquier discrepancia rechace sin escribir, sin tocar
// la base equivocada y liberando lo que se abrió.

import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const singleton = vi.hoisted((): { actual: unknown; urlAlLeer: (string | undefined)[] } => ({
  /** El `prisma` que exporta `lib/prisma` en este test. */
  actual: undefined,
  /** `DATABASE_URL` en el momento en que la suite leyó `lib/prisma`. */
  urlAlLeer: [],
}));

vi.mock('../../../lib/prisma', () => ({
  get prisma() {
    singleton.urlAlLeer.push(process.env.DATABASE_URL);
    return singleton.actual;
  },
}));

import { conectarBaseDePrueba, verificarConexiones } from './baseVerificada';

const URL_DE_PRUEBA = 'postgresql://u:p@127.0.0.1:55439/realpolitik_test?schema=public';
const SERVIDOR = '2026-11-18 10:00:00+00@5432';
const PG16 = 'PostgreSQL 16.15 on x86_64-pc-linux-musl';

/** Una conexión falsa que responde su identidad y registra cualquier escritura. */
function falsa({
  base = 'realpolitik_test',
  servidor = SERVIDOR,
  version = PG16,
}: { base?: string; servidor?: string; version?: string } = {}) {
  const escrituras = {
    create: vi.fn(),
    deleteMany: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    $transaction: vi.fn(),
  };
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([{ base, servidor, db: base, version }]),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    $executeRaw: escrituras.$executeRaw,
    $executeRawUnsafe: escrituras.$executeRawUnsafe,
    $transaction: escrituras.$transaction,
    usuario: { create: escrituras.create, deleteMany: escrituras.deleteMany },
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

let urlAntes: string | undefined;
beforeEach(() => {
  urlAntes = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:5432/realpolitik_db';
  singleton.urlAlLeer = [];
});
afterEach(() => {
  if (urlAntes === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = urlAntes;
});

describe('conectarBaseDePrueba: preparación de una suite que usa lib/prisma', () => {
  it('todo coincide: fija DATABASE_URL antes de leer lib/prisma, verifica y lo devuelve abierto', async () => {
    const suite = falsa();
    const otra = falsa();
    const referencia = falsa();
    singleton.actual = suite.db;

    const prisma = await conectarBaseDePrueba(URL_DE_PRUEBA, {
      otras: [otra.db],
      abrir: () => referencia.db,
    });

    expect(prisma).toBe(suite.db);
    expect(singleton.urlAlLeer).toEqual([URL_DE_PRUEBA]);
    expect(suite.consultas).toHaveBeenCalledOnce(); // solo la identidad
    expect(otra.consultas).toHaveBeenCalledOnce();
    for (const db of [suite, otra, referencia]) db.sinEscrituras();
    expect(referencia.desconectar).toHaveBeenCalled();
    expect(suite.desconectar).not.toHaveBeenCalled();
    expect(otra.desconectar).not.toHaveBeenCalled();
  });

  it('lib/prisma ya estaba creado con otra base (singleton precargado): rechaza sin escribir y desconecta todo', async () => {
    const suite = falsa({ base: 'realpolitik_otra_test' });
    const otra = falsa();
    const referencia = falsa();
    singleton.actual = suite.db;

    await expect(
      conectarBaseDePrueba(URL_DE_PRUEBA, { otras: [otra.db], abrir: () => referencia.db }),
    ).rejects.toThrow(/apunta a "realpolitik_otra_test" y no a "realpolitik_test"/);
    for (const db of [suite, otra, referencia]) db.sinEscrituras();
    expect(suite.desconectar).toHaveBeenCalled();
    expect(otra.desconectar).toHaveBeenCalled();
  });

  it('misma base en otro servidor: rechaza', async () => {
    const suite = falsa({ servidor: '2026-01-01 00:00:00+00@5432' });
    singleton.actual = suite.db;

    await expect(conectarBaseDePrueba(URL_DE_PRUEBA, { abrir: () => falsa().db })).rejects.toThrow(
      /de ese servidor: no se ejecuta nada/,
    );
    suite.sinEscrituras();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('una conexión adicional de la suite está en otra base: rechaza aunque lib/prisma esté bien', async () => {
    const suite = falsa();
    const buena = falsa();
    const mala = falsa({ base: 'realpolitik_db' });
    singleton.actual = suite.db;

    await expect(
      conectarBaseDePrueba(URL_DE_PRUEBA, {
        otras: [buena.db, mala.db],
        abrir: () => falsa().db,
      }),
    ).rejects.toThrow(/apunta a "realpolitik_db"/);
    for (const db of [suite, buena, mala]) {
      db.sinEscrituras();
      expect(db.desconectar).toHaveBeenCalled();
    }
  });

  it('la guarda propia de la suite rechaza: no fija DATABASE_URL, no lee lib/prisma ni abre nada', async () => {
    const otra = falsa();
    const abrir = vi.fn(() => falsa().db);
    const exigir = vi.fn(() => {
      throw new Error('La suite solo puede utilizar realpolitik_test.');
    });

    await expect(
      conectarBaseDePrueba(URL_DE_PRUEBA, { exigir, otras: [otra.db], abrir }),
    ).rejects.toThrow('solo puede utilizar realpolitik_test');
    expect(exigir).toHaveBeenCalledWith(URL_DE_PRUEBA);
    expect(process.env.DATABASE_URL).toBe('postgresql://u:p@127.0.0.1:5432/realpolitik_db');
    expect(singleton.urlAlLeer).toEqual([]);
    expect(abrir).not.toHaveBeenCalled();
    expect(otra.consultas).not.toHaveBeenCalled();
    expect(otra.desconectar).toHaveBeenCalled();
  });

  it('versión exigida distinta: rechaza; sin versión exigida no hace esa consulta', async () => {
    const vieja = falsa({ version: 'PostgreSQL 15.8 on x86_64-pc-linux-gnu' });
    singleton.actual = vieja.db;
    await expect(
      conectarBaseDePrueba(URL_DE_PRUEBA, { versionMayor: 16, abrir: () => falsa().db }),
    ).rejects.toThrow(/no es PostgreSQL 16 sobre realpolitik_test \(PostgreSQL 15\.8\)/);
    vieja.sinEscrituras();
    expect(vieja.desconectar).toHaveBeenCalled();

    const otraVersion = falsa({ version: 'PostgreSQL 17.0' });
    singleton.actual = otraVersion.db;
    await expect(conectarBaseDePrueba(URL_DE_PRUEBA, { abrir: () => falsa().db })).resolves.toBe(
      otraVersion.db,
    );
    expect(otraVersion.consultas).toHaveBeenCalledOnce();
  });

  it('si la base no responde, rechaza con ese error y libera lib/prisma y la referencia', async () => {
    const suite = falsa();
    const referencia = falsa();
    referencia.consultas.mockRejectedValueOnce(new Error('sin conexión'));
    singleton.actual = suite.db;

    await expect(
      conectarBaseDePrueba(URL_DE_PRUEBA, { abrir: () => referencia.db }),
    ).rejects.toThrow('sin conexión');
    expect(referencia.desconectar).toHaveBeenCalled();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('si además falla la desconexión, el error informado es el del rechazo', async () => {
    const suite = falsa({ base: 'realpolitik_db' });
    suite.desconectar.mockRejectedValueOnce(new Error('falla al desconectar'));
    singleton.actual = suite.db;

    await expect(conectarBaseDePrueba(URL_DE_PRUEBA, { abrir: () => falsa().db })).rejects.toThrow(
      /apunta a "realpolitik_db"/,
    );
  });
});

describe('verificarConexiones: conexiones ya abiertas', () => {
  it('un nombre que no es descartable se rechaza antes de abrir la referencia', async () => {
    const db = falsa({ base: 'realpolitik_db' });
    const abrir = vi.fn(() => falsa().db);

    await expect(
      verificarConexiones('postgresql://u:p@127.0.0.1:5432/realpolitik_db', [db.db], { abrir }),
    ).rejects.toThrow(/no es una base descartable/);
    expect(abrir).not.toHaveBeenCalled();
    expect(db.consultas).not.toHaveBeenCalled();
    expect(db.desconectar).toHaveBeenCalled();
  });

  it('baseExacta: la conexión de la suite tiene que informar ese nombre', async () => {
    const db = falsa({ base: 'realpolitik_hu45_test' });
    await expect(
      verificarConexiones('postgresql://u:p@127.0.0.1:5432/realpolitik_hu45_test', [db.db], {
        baseExacta: 'realpolitik_test',
        abrir: () => falsa({ base: 'realpolitik_hu45_test' }).db,
      }),
    ).rejects.toThrow('La conexión no es realpolitik_test (base=realpolitik_hu45_test)');
    db.sinEscrituras();
  });
});
