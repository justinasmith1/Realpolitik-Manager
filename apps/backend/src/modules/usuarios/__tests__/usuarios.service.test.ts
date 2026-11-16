// Unidad: la transacción confirmada (reintentos, confirmación del COMMIT), las reglas que se
// deciden antes de tocar la base y el formato de los eventos. El comportamiento contra PostgreSQL
// real está en `usuarios.integration.test.ts` y `usuarios.concurrencia.integration.test.ts`.

import { Prisma, type PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseDeDatosNoDisponibleError } from '../../../lib/baseDeDatosNoDisponible';
import { registrarEventoAdministrativo } from '../../auth/registroDeEventos';
import {
  cambiarEstadoDeUsuario,
  ConflictoDeConcurrenciaError,
  crearUsuario,
  DatosDeUsuarioInvalidosError,
  enTransaccionConfirmada,
  esConflictoDeConcurrencia,
  INTENTOS,
  listarUsuarios,
  modificarUsuario,
  OperacionNoConfirmadaError,
  OperacionSobreCuentaPropiaError,
  restablecerContrasena,
  UsuarioInexistenteError,
} from '../usuarios.service';

// El servicio importa `lib/prisma` (vía sesiones). En esta unidad no se usa nunca: si algún camino
// lo usara, falla en lugar de conectarse a la base del `.env`.
vi.mock('../../../lib/prisma', () => ({
  prisma: new Proxy(
    {},
    {
      get() {
        throw new Error('lib/prisma no se usa en los tests unitarios del servicio de usuarios.');
      },
    },
  ),
}));

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';

const conocido = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    ...(meta === undefined ? {} : { meta }),
  });

const desconocido = (mensaje: string) =>
  new Prisma.PrismaClientUnknownRequestError(mensaje, {
    clientVersion: Prisma.prismaVersion.client,
  });

/**
 * Base simulada: `$transaction` ejecuta el trabajo con un `tx` cuyo `$queryRaw` devuelve un xid, o
 * rechaza con los errores de `fallos` (uno por intento). `$queryRaw` de la base informa el estado.
 */
function baseSimulada({
  fallos = [],
  estado = 'committed',
}: { fallos?: unknown[]; estado?: string | null } = {}) {
  const pendientes = [...fallos];
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ xid: '123' }]) };
  const db = {
    $transaction: vi.fn(async (trabajo: (t: typeof tx) => Promise<unknown>) => {
      const fallo = pendientes.shift();
      if (fallo !== undefined) throw fallo as Error;
      return trabajo(tx);
    }),
    $queryRaw: vi.fn().mockResolvedValue([{ estado }]),
  };
  return { db: db as unknown as PrismaClient, simulada: db };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('esConflictoDeConcurrencia', () => {
  it('reconoce 40001 y 40P01 en sus tres formas', () => {
    expect(esConflictoDeConcurrencia(conocido('P2034'))).toBe(true);
    expect(esConflictoDeConcurrencia(conocido('P2010', { code: '40001' }))).toBe(true);
    expect(esConflictoDeConcurrencia(conocido('P2010', { code: '40P01' }))).toBe(true);
    expect(
      esConflictoDeConcurrencia(
        desconocido('Error: PostgresError { code: "40001", message: "x" }'),
      ),
    ).toBe(true);
  });

  it('nada más: ni un duplicado, ni una conexión perdida, ni otro SQLSTATE', () => {
    expect(esConflictoDeConcurrencia(conocido('P2002'))).toBe(false);
    expect(esConflictoDeConcurrencia(conocido('P2010', { code: '57P01' }))).toBe(false);
    expect(esConflictoDeConcurrencia(conocido('P2010', { code: '23505' }))).toBe(false);
    expect(esConflictoDeConcurrencia(desconocido('PostgresError { code: "23514" }'))).toBe(false);
    expect(esConflictoDeConcurrencia(new Error('40001'))).toBe(false);
  });
});

describe('enTransaccionConfirmada', () => {
  it('devuelve el resultado de una transacción confirmada', async () => {
    const { db, simulada } = baseSimulada();
    await expect(enTransaccionConfirmada(db, () => Promise.resolve('hecho'))).resolves.toBe(
      'hecho',
    );
    expect(simulada.$transaction).toHaveBeenCalledTimes(1);
    expect(simulada.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it(`reintenta un conflicto hasta ${INTENTOS} intentos en total`, async () => {
    const { db, simulada } = baseSimulada({
      fallos: Array.from({ length: INTENTOS - 1 }, () => conocido('P2034')),
    });
    await expect(enTransaccionConfirmada(db, () => Promise.resolve('hecho'))).resolves.toBe(
      'hecho',
    );
    expect(simulada.$transaction).toHaveBeenCalledTimes(INTENTOS);
  });

  it('agotados los intentos: ConflictoDeConcurrenciaError, sin consultar la confirmación', async () => {
    const { db, simulada } = baseSimulada({
      fallos: Array.from({ length: INTENTOS }, () => conocido('P2010', { code: '40P01' })),
    });
    await expect(
      enTransaccionConfirmada(db, () => Promise.resolve('hecho')),
    ).rejects.toBeInstanceOf(ConflictoDeConcurrenciaError);
    expect(simulada.$transaction).toHaveBeenCalledTimes(INTENTOS);
    expect(simulada.$queryRaw).not.toHaveBeenCalled();
  });

  it('un error de negocio o desconocido no se reintenta', async () => {
    const negocio = new UsuarioInexistenteError();
    const { db, simulada } = baseSimulada({ fallos: [negocio] });
    await expect(enTransaccionConfirmada(db, () => Promise.resolve('hecho'))).rejects.toBe(negocio);
    expect(simulada.$transaction).toHaveBeenCalledTimes(1);

    const raro = conocido('P2002');
    const otra = baseSimulada({ fallos: [raro] });
    await expect(enTransaccionConfirmada(otra.db, () => Promise.resolve('hecho'))).rejects.toBe(
      raro,
    );
    expect(otra.simulada.$transaction).toHaveBeenCalledTimes(1);
  });

  it('la base caída es BaseDeDatosNoDisponibleError y no se reintenta', async () => {
    const { db, simulada } = baseSimulada({ fallos: [conocido('P1001')] });
    await expect(
      enTransaccionConfirmada(db, () => Promise.resolve('hecho')),
    ).rejects.toBeInstanceOf(BaseDeDatosNoDisponibleError);
    expect(simulada.$transaction).toHaveBeenCalledTimes(1);
  });

  it('si PostgreSQL no confirmó la transacción: OperacionNoConfirmadaError', async () => {
    for (const estado of ['aborted', 'in progress', null]) {
      const { db } = baseSimulada({ estado });
      await expect(
        enTransaccionConfirmada(db, () => Promise.resolve('hecho')),
      ).rejects.toBeInstanceOf(OperacionNoConfirmadaError);
    }
  });

  it('si la base cae al confirmar: BaseDeDatosNoDisponibleError (resultado sin confirmar)', async () => {
    const { db, simulada } = baseSimulada();
    simulada.$queryRaw.mockRejectedValueOnce(conocido('P1017'));
    await expect(
      enTransaccionConfirmada(db, () => Promise.resolve('hecho')),
    ).rejects.toBeInstanceOf(BaseDeDatosNoDisponibleError);
  });
});

describe('reglas que se deciden antes de tocar la base', () => {
  const { db, simulada } = baseSimulada();

  it('nadie se desactiva ni restablece su propia contraseña', async () => {
    await expect(
      cambiarEstadoDeUsuario(db, { actorId: ACTOR, usuarioId: ACTOR, activo: false }),
    ).rejects.toEqual(new OperacionSobreCuentaPropiaError('desactivar'));
    await expect(
      restablecerContrasena(db, { actorId: ACTOR, usuarioId: ACTOR.toUpperCase() }),
    ).rejects.toEqual(new OperacionSobreCuentaPropiaError('restablecer-password'));
    expect(simulada.$transaction).not.toHaveBeenCalled();
  });

  it('un id sin forma de UUID es un usuario inexistente', async () => {
    await expect(
      cambiarEstadoDeUsuario(db, { actorId: ACTOR, usuarioId: 'abc', activo: false }),
    ).rejects.toBeInstanceOf(UsuarioInexistenteError);
    await expect(
      modificarUsuario(db, { actorId: ACTOR, usuarioId: "1' OR 1=1", cambios: { nombre: 'X' } }),
    ).rejects.toBeInstanceOf(UsuarioInexistenteError);
    await expect(
      restablecerContrasena(db, { actorId: ACTOR, usuarioId: '' }),
    ).rejects.toBeInstanceOf(UsuarioInexistenteError);
  });

  it('datos inválidos: DatosDeUsuarioInvalidosError con los campos', async () => {
    const error = await crearUsuario(db, {
      actorId: ACTOR,
      datos: { nombre: '', email: 'no', rol: 'ROOT' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatosDeUsuarioInvalidosError);
    expect((error as DatosDeUsuarioInvalidosError).errores.map((e) => e.campo)).toEqual([
      'nombre',
      'email',
      'rol',
    ]);

    await expect(
      modificarUsuario(db, {
        actorId: ACTOR,
        usuarioId: OTRO,
        cambios: { email: 'otra@ejemplo.example' } as { nombre?: string },
      }),
    ).rejects.toBeInstanceOf(DatosDeUsuarioInvalidosError);
    await expect(
      cambiarEstadoDeUsuario(db, {
        actorId: ACTOR,
        usuarioId: OTRO,
        activo: 'false' as unknown as boolean,
      }),
    ).rejects.toBeInstanceOf(DatosDeUsuarioInvalidosError);
    await expect(listarUsuarios(db, { rol: 'ROOT' as 'CONSULTA' })).rejects.toBeInstanceOf(
      DatosDeUsuarioInvalidosError,
    );
    expect(simulada.$transaction).not.toHaveBeenCalled();
  });

  it('el actor tiene que ser un id de usuario (viene de la sesión)', async () => {
    await expect(
      cambiarEstadoDeUsuario(db, { actorId: '', usuarioId: OTRO, activo: true }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('registrarEventoAdministrativo', () => {
  it('una línea JSON con actor y usuario afectado como campos distintos', () => {
    const escritura = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    registrarEventoAdministrativo('usuarios.rol_cambiado', {
      actorId: ACTOR,
      usuarioId: OTRO,
      rolAnterior: 'ADMINISTRADOR',
      rol: 'CONSULTA',
      sesionesRevocadas: 2,
    });

    expect(escritura).toHaveBeenCalledTimes(1);
    const linea = String(escritura.mock.calls[0]?.[0]);
    expect(linea.endsWith('\n')).toBe(true);
    expect(JSON.parse(linea)).toEqual({
      fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      evento: 'usuarios.rol_cambiado',
      actorId: ACTOR,
      usuarioId: OTRO,
      rolAnterior: 'ADMINISTRADOR',
      rol: 'CONSULTA',
      sesionesRevocadas: 2,
    });
  });

  it('no acepta ni escribe datos fuera de los permitidos', () => {
    const escritura = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    registrarEventoAdministrativo('auth.password.restablecida', {
      actorId: ACTOR,
      usuarioId: OTRO,
      sesionesRevocadas: 0,
      // Un llamador descuidado no puede colar secretos: solo se copian los campos conocidos.
      ...({ contrasenaTemporal: 'secreta', passwordHash: '$argon2id$x', email: 'a@b.c' } as object),
    });
    const evento = JSON.parse(String(escritura.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(Object.keys(evento).sort()).toEqual(
      ['actorId', 'evento', 'fecha', 'sesionesRevocadas', 'usuarioId'].sort(),
    );
  });
});
