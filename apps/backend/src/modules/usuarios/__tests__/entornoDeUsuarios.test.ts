// Unidad: la guarda de aislamiento de las suites de integración de usuarios, con conexiones FALSAS
// (ninguna base real, nunca `realpolitik_db`). Comprueba que una conexión que no está en la base
// descartable de la URL hace rechazar la preparación antes de cualquier escritura.

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { cuentasDePrueba, exigirBaseDePrueba } from './entornoDeUsuarios';

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
