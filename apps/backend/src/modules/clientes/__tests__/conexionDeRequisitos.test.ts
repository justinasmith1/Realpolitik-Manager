// Unidad: el preflight de las suites de requisitos, con conexiones FALSAS (ninguna base real).
// Comprueba que rechaza antes de escribir cuando el nombre, la base efectiva, el servidor o la
// versión no son los esperados, y que libera la conexión de la suite al rechazar.

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { verificarConexionDeRequisitos } from './conexionDeRequisitos';

const URL_VALIDA = 'postgresql://u:p@127.0.0.1:55434/realpolitik_test?schema=public';
const SERVIDOR = '2026-11-17 10:00:00+00@5432';
const PG16 = 'PostgreSQL 16.4 on x86_64-pc-linux-musl, compiled by gcc';

/**
 * Una conexión falsa: a la consulta de identidad de `exigirBaseDePrueba` y a la del preflight
 * responde la misma fila (`base`/`servidor` y `db`/`version`). Registra cualquier escritura.
 */
function falsa({
  base = 'realpolitik_test',
  servidor = SERVIDOR,
  version = PG16,
}: { base?: string; servidor?: string; version?: string } = {}) {
  const escrituras = {
    create: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
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
    usuario: {
      create: escrituras.create,
      createMany: escrituras.createMany,
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

/** Simula el `beforeAll` de la suite: verifica y, solo si pasa, escribe (`preparar`). */
function beforeAllDeLaSuite(
  url: string,
  suite: ReturnType<typeof falsa>,
  referencia: ReturnType<typeof falsa>,
  versionMayor?: number,
) {
  const preparar = vi.fn();
  const resultado = verificarConexionDeRequisitos(url, suite.db, {
    abrir: () => referencia.db,
    ...(versionMayor === undefined ? {} : { versionMayor }),
  }).then(preparar);
  return { resultado, preparar };
}

describe('verificarConexionDeRequisitos (preflight de las suites de requisitos)', () => {
  it('base válida y bien conectada: pasa, sin escribir nada, y recién después se prepara', async () => {
    const referencia = falsa();
    const suite = falsa();
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia, 16);

    await expect(resultado).resolves.toBeUndefined();
    expect(preparar).toHaveBeenCalledOnce();
    suite.sinEscrituras();
    referencia.sinEscrituras();
    // La referencia se cierra siempre; la conexión de la suite queda abierta para los tests.
    expect(referencia.desconectar).toHaveBeenCalled();
    expect(suite.desconectar).not.toHaveBeenCalled();
    // La conexión de la suite se consultó dos veces: identidad (servidor) y base + versión.
    expect(suite.consultas).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['la base de desarrollo', 'realpolitik_db'],
    ['otra base descartable de las suites de Usuarios', 'realpolitik_hu45_test'],
    ['una base *_audit', 'realpolitik_audit'],
    ['un nombre parecido', 'realpolitik_test_2'],
  ])(
    'nombre no autorizado (%s): rechaza sin abrir ni consultar nada, y libera la conexión',
    async (_caso, base) => {
      const referencia = falsa({ base });
      const suite = falsa({ base });
      const abrir = vi.fn(() => referencia.db);
      const preparar = vi.fn();

      await expect(
        verificarConexionDeRequisitos(`postgresql://u:p@127.0.0.1:5432/${base}`, suite.db, {
          abrir,
        }).then(preparar),
      ).rejects.toThrow(/solo puede utilizar realpolitik_test/);
      expect(abrir).not.toHaveBeenCalled();
      expect(suite.consultas).not.toHaveBeenCalled();
      expect(preparar).not.toHaveBeenCalled();
      suite.sinEscrituras();
      expect(suite.desconectar).toHaveBeenCalled();
    },
  );

  it('conexión efectiva distinta de la declarada (lib/prisma cargado antes con el .env): rechaza antes de escribir', async () => {
    const referencia = falsa();
    const suite = falsa({ base: 'realpolitik_db' });
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia, 16);

    await expect(resultado).rejects.toThrow(/apunta a "realpolitik_db"/);
    expect(preparar).not.toHaveBeenCalled();
    suite.sinEscrituras();
    referencia.sinEscrituras();
    expect(referencia.desconectar).toHaveBeenCalled();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('servidor equivocado aunque la base se llame realpolitik_test (p. ej., lib/prisma conectado a otra instancia): rechaza', async () => {
    const referencia = falsa();
    const suite = falsa({ servidor: '2026-01-01 00:00:00+00@5432' });
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia);

    await expect(resultado).rejects.toThrow(/de ese servidor: no se ejecuta nada/);
    expect(preparar).not.toHaveBeenCalled();
    suite.sinEscrituras();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('la URL lleva a otra base que la de su nombre: rechaza', async () => {
    const referencia = falsa({ base: 'otra_base_test' });
    const suite = falsa({ base: 'otra_base_test' });
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia);

    await expect(resultado).rejects.toThrow(/La URL de prueba lleva a "otra_base_test"/);
    expect(preparar).not.toHaveBeenCalled();
    suite.sinEscrituras();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it.each([
    ['PostgreSQL 15', 'PostgreSQL 15.8 on x86_64-pc-linux-gnu'],
    ['PostgreSQL 160 (prefijo engañoso)', 'PostgreSQL 160.1 on x86_64-pc-linux-gnu'],
  ])('versión distinta de la exigida (%s): rechaza', async (_caso, version) => {
    const referencia = falsa({ version });
    const suite = falsa({ version });
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia, 16);

    await expect(resultado).rejects.toThrow(/no es PostgreSQL 16 sobre realpolitik_test/);
    expect(preparar).not.toHaveBeenCalled();
    suite.sinEscrituras();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('sin versión exigida (requisitos.masivo), otra versión pasa igual que antes', async () => {
    const referencia = falsa({ version: 'PostgreSQL 17.0' });
    const suite = falsa({ version: 'PostgreSQL 17.0' });
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia);

    await expect(resultado).resolves.toBeUndefined();
    expect(preparar).toHaveBeenCalledOnce();
  });

  it('la base efectiva no informa su nombre: rechaza', async () => {
    const referencia = falsa();
    const suite = falsa();
    // Identidad correcta (exigirBaseDePrueba), pero la consulta del preflight no devuelve filas.
    suite.consultas
      .mockResolvedValueOnce([{ base: 'realpolitik_test', servidor: SERVIDOR }])
      .mockResolvedValueOnce([]);
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia);

    await expect(resultado).rejects.toThrow(/base=sin fila/);
    expect(preparar).not.toHaveBeenCalled();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('si la base no responde: rechaza con ese error y libera las dos conexiones', async () => {
    const referencia = falsa();
    referencia.consultas.mockRejectedValueOnce(new Error('sin conexión'));
    const suite = falsa();
    const { resultado, preparar } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia);

    await expect(resultado).rejects.toThrow('sin conexión');
    expect(preparar).not.toHaveBeenCalled();
    expect(referencia.desconectar).toHaveBeenCalled();
    expect(suite.desconectar).toHaveBeenCalled();
  });

  it('si además falla la desconexión, se informa el motivo original del rechazo', async () => {
    const referencia = falsa();
    const suite = falsa({ base: 'realpolitik_db' });
    suite.desconectar.mockRejectedValueOnce(new Error('falla al desconectar'));
    const { resultado } = beforeAllDeLaSuite(URL_VALIDA, suite, referencia);

    await expect(resultado).rejects.toThrow(/apunta a "realpolitik_db"/);
  });
});
