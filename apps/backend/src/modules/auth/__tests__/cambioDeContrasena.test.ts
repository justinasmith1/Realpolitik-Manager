// Cambio de la propia contraseña (`cambiarContrasena` y `PUT /auth/password`) SIN PostgreSQL: la
// base es un doble que responde lo que necesita cada caso, y argon2 es el real. Comprueba las
// decisiones del servicio y su traducción a HTTP:
//   - el tipo de cambio (obligatorio / voluntario) lo decide la fila bloqueada, no la sesión ni el
//     pedido;
//   - el voluntario abre la sesión nueva DESPUÉS de revocar las demás, en la misma transacción;
//   - la cookie: obligatorio → se borra; voluntario → token nuevo; sesión revocada → no se toca;
//   - la política, la contraseña actual incorrecta, la protección de intentos y la base caída.
//
// Las garantías de atomicidad y de concurrencia se prueban contra PostgreSQL real en
// `cambioDeContrasena.integration.test.ts`.

import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { MENSAJE_CONTRASENA_PREVISIBLE } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { BaseDeDatosNoDisponibleError } from '../../../lib/baseDeDatosNoDisponible';
import {
  CambioNoConfirmadoError,
  cambiarContrasena,
  ContrasenaActualIncorrectaError,
  ContrasenaNuevaRechazadaError,
  IntentosLimitadosError,
  SesionNoVigenteError,
} from '../autenticacion.service';
import { hashearContrasena } from '../contrasenas';
import { NOMBRE_COOKIE_DE_SESION } from '../cookieDeSesion';
import { ProteccionDeLogin } from '../proteccionDeLogin';
import type { SesionValidada } from '../sesiones.service';
import { generarTokenDeSesion, tieneFormatoDeTokenDeSesion } from '../tokenDeSesion';

const db = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    usuario: { update: vi.fn() },
    sesion: { findUnique: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  };
  const prisma = {
    usuario: { findUnique: vi.fn() },
    sesion: { findUnique: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { tx, prisma };
});

vi.mock('../../../lib/prisma', () => ({ prisma: db.prisma }));

const ORIGEN = 'http://localhost:5173';
const ACTUAL = 'la contraseña actual de prueba';
const NUEVA = 'una frase nueva para la cuenta';
const USUARIO = {
  id: '0000c000-0000-4000-8000-000000000001',
  email: 'persona@ejemplo.example',
  nombre: 'Persona de Prueba',
  rol: 'ADMINISTRATIVO' as const,
};
const SESION_ID = '5e5a0000-0000-4000-8000-000000000001';
const SESION_NUEVA_ID = '5e5a0000-0000-4000-8000-000000000002';
const COOKIE_BORRADA = `${NOMBRE_COOKIE_DE_SESION}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
const HORA = 60 * 60 * 1000;

let hashActual: string;

beforeAll(async () => {
  hashActual = await hashearContrasena(ACTUAL);
});

/** Tiempos de una sesión vigente, con actividad reciente (no se registra actividad). */
const sesionVigente = () => {
  const ahora = Date.now();
  return {
    createdAt: new Date(ahora - HORA),
    ultimaActividadEn: new Date(ahora),
    expiraEn: new Date(ahora + 24 * HORA),
    revocadaEn: null as Date | null,
  };
};

/**
 * Prepara la base simulada: la fila del usuario que se lee bajo el bloqueo (`debeCambiarPassword`
 * de la BASE) y la sesión del pedido. `delPedido` reemplaza la sesión que se encuentra en la
 * transacción (revocada, vencida…).
 *
 * El hash que escribe la transacción recién queda "guardado" (lo que devuelve la lectura de
 * confirmación) cuando `$transaction` termina. Con `commitPerdido`, `$transaction` resuelve igual
 * pero no guarda nada: lo que hace Prisma 5.22 cuando el COMMIT falla.
 */
function prepararBase({
  enLaBase = { debeCambiarPassword: false },
  delPedido = sesionVigente(),
  hashBajoBloqueo,
  commitPerdido = false,
}: {
  enLaBase?: { debeCambiarPassword: boolean; activo?: boolean };
  delPedido?: ReturnType<typeof sesionVigente>;
  hashBajoBloqueo?: string;
  commitPerdido?: boolean;
} = {}) {
  let hashGuardado = hashActual;
  let hashEscrito: string | undefined;
  db.prisma.usuario.findUnique.mockImplementation(({ select }: { select: { activo?: true } }) =>
    Promise.resolve(
      select.activo ? { activo: true, passwordHash: hashGuardado } : { passwordHash: hashGuardado },
    ),
  );
  db.prisma.$transaction.mockImplementation(
    async (operacion: (tx: typeof db.tx) => Promise<unknown>) => {
      const resultado = await operacion(db.tx);
      if (!commitPerdido && hashEscrito !== undefined) hashGuardado = hashEscrito;
      return resultado;
    },
  );
  db.tx.usuario.update.mockImplementation(({ data }: { data: { passwordHash: string } }) => {
    hashEscrito = data.passwordHash;
    return Promise.resolve({});
  });
  db.tx.$queryRaw.mockResolvedValue([
    {
      activo: enLaBase.activo ?? true,
      passwordHash: hashBajoBloqueo ?? hashActual,
      debeCambiarPassword: enLaBase.debeCambiarPassword,
    },
  ]);
  db.tx.sesion.findUnique.mockResolvedValue(delPedido);
  db.tx.$executeRaw.mockResolvedValue(3); // tres sesiones revocadas, la del pedido incluida
  db.tx.sesion.deleteMany.mockResolvedValue({ count: 0 });
  db.tx.sesion.findMany.mockResolvedValue([]);
  db.tx.sesion.create.mockImplementation(({ data }: { data: { expiraEn: Date } }) =>
    Promise.resolve({ id: SESION_NUEVA_ID, expiraEn: data.expiraEn }),
  );
}

const sesionDelPedido = (debeCambiarPassword = false): SesionValidada => ({
  sesionId: SESION_ID,
  expiraEn: new Date(Date.now() + 24 * HORA),
  usuario: { ...USUARIO, debeCambiarPassword },
});

const cambiar = (
  proteccion: ProteccionDeLogin,
  { actual = ACTUAL, nueva = NUEVA, sesion = sesionDelPedido() } = {},
) => cambiarContrasena({ sesion, actual, nueva, ip: '203.0.113.7' }, proteccion);

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cambiarContrasena: el tipo de cambio lo decide la fila bloqueada', () => {
  it('sin cambio pendiente en la base → voluntario: revoca todo y DESPUÉS abre una sesión nueva', async () => {
    prepararBase({ enLaBase: { debeCambiarPassword: false } });
    // La sesión del pedido dice lo contrario: no es la que decide.
    const resultado = await cambiar(new ProteccionDeLogin(), {
      sesion: sesionDelPedido(true),
    });

    expect(resultado.tipo).toBe('voluntario');
    if (resultado.tipo !== 'voluntario') return;
    expect(resultado.sesionesRevocadas).toBe(3);
    expect(tieneFormatoDeTokenDeSesion(resultado.sesion.token)).toBe(true);
    expect(resultado.sesion.sesionId).toBe(SESION_NUEVA_ID);

    // Orden: bloqueo → hash nuevo → revocación de todas → sesión nueva, todo en la transacción.
    const [bloqueo] = db.tx.$queryRaw.mock.invocationCallOrder;
    const [actualizacion] = db.tx.usuario.update.mock.invocationCallOrder;
    const [revocacion] = db.tx.$executeRaw.mock.invocationCallOrder;
    const [alta] = db.tx.sesion.create.mock.invocationCallOrder;
    expect(bloqueo).toBeLessThan(actualizacion ?? 0);
    expect(actualizacion).toBeLessThan(revocacion ?? 0);
    expect(revocacion).toBeLessThan(alta ?? 0);
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);

    // Solo el hash del token llega a la base; el token sale solo en el resultado.
    const { data } = db.tx.sesion.create.mock.calls[0]?.[0] as {
      data: { tokenHash: string; usuarioId: string; createdAt: Date; expiraEn: Date };
    };
    expect(data.usuarioId).toBe(USUARIO.id);
    expect(data.tokenHash).toBe(createHash('sha256').update(resultado.sesion.token).digest('hex'));
    // Duraciones nuevas: 7 días desde el cambio (reautenticación, NIST SP 800-63B-4 §5.2).
    expect(data.expiraEn.getTime() - data.createdAt.getTime()).toBe(7 * 24 * HORA);
    // La rotación no es un inicio de sesión: no toca el último acceso.
    expect(db.tx.usuario.update).toHaveBeenCalledTimes(1);
    expect(db.tx.usuario.update.mock.calls[0]?.[0]).toMatchObject({
      data: { debeCambiarPassword: false },
    });
  });

  it('con el cambio pendiente en la base → obligatorio: revoca todo y NO abre ninguna sesión', async () => {
    prepararBase({ enLaBase: { debeCambiarPassword: true } });
    // Aunque la sesión, validada antes, dijera que ya no estaba pendiente.
    const resultado = await cambiar(new ProteccionDeLogin(), {
      sesion: sesionDelPedido(false),
    });

    expect(resultado).toEqual({ tipo: 'obligatorio', sesionesRevocadas: 3 });
    expect(db.tx.sesion.create).not.toHaveBeenCalled();
    expect(db.tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('cambiarContrasena: rechazos sin cambios', () => {
  it('la política rechaza la nueva antes de reservar un intento o tocar la base', async () => {
    const proteccion = new ProteccionDeLogin();

    await expect(cambiar(proteccion, { nueva: 'qwertyuiopasdfgh' })).rejects.toEqual(
      new ContrasenaNuevaRechazadaError(MENSAJE_CONTRASENA_PREVISIBLE),
    );
    expect(db.prisma.usuario.findUnique).not.toHaveBeenCalled();
    expect(proteccion.tamanio).toEqual({ cuentas: 0, origenes: 0, enCurso: 0 });
  });

  it('contraseña actual incorrecta: cuenta como un fallo y no abre la transacción', async () => {
    prepararBase();
    const proteccion = new ProteccionDeLogin();

    await expect(cambiar(proteccion, { actual: 'no es la actual' })).rejects.toBeInstanceOf(
      ContrasenaActualIncorrectaError,
    );
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
    expect(proteccion.tamanio).toMatchObject({ cuentas: 1, enCurso: 0 });
  });

  it('cinco actuales incorrectas: el sexto intento espera (la misma demora que el login)', async () => {
    prepararBase();
    // Reloj fijo: la espera no depende de cuánto tarda argon2 en esta máquina.
    const proteccion = new ProteccionDeLogin({ ahora: () => 1_000_000 });
    for (let i = 0; i < 5; i += 1) {
      await expect(cambiar(proteccion, { actual: `incorrecta ${i}` })).rejects.toBeInstanceOf(
        ContrasenaActualIncorrectaError,
      );
    }

    await expect(cambiar(proteccion)).rejects.toMatchObject({
      constructor: IntentosLimitadosError,
      motivo: 'demora-cuenta',
      retryAfterMs: 30_000,
    });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['revocada (otro cambio o un logout)', { revocadaEn: new Date() }, 'REVOCADA'],
    [
      'vencida por inactividad',
      { ultimaActividadEn: new Date(Date.now() - 25 * HORA) },
      'VENCIDA_POR_INACTIVIDAD',
    ],
  ] as const)(
    'sesión del pedido %s bajo el bloqueo → SesionNoVigenteError, sin guardar ni rotar',
    async (_caso, cambio, motivo) => {
      prepararBase({ delPedido: { ...sesionVigente(), createdAt: new Date(0), ...cambio } });
      const proteccion = new ProteccionDeLogin();

      await expect(cambiar(proteccion)).rejects.toEqual(new SesionNoVigenteError(motivo));
      expect(db.tx.usuario.update).not.toHaveBeenCalled();
      expect(db.tx.sesion.create).not.toHaveBeenCalled();
      // No es culpa de la persona: no cuenta como fallo.
      expect(proteccion.tamanio).toMatchObject({ cuentas: 0, enCurso: 0 });
    },
  );

  it('cuenta desactivada bajo el bloqueo → SesionNoVigenteError USUARIO_INACTIVO', async () => {
    prepararBase({ enLaBase: { debeCambiarPassword: false, activo: false } });

    await expect(cambiar(new ProteccionDeLogin())).rejects.toEqual(
      new SesionNoVigenteError('USUARIO_INACTIVO'),
    );
    expect(db.tx.usuario.update).not.toHaveBeenCalled();
    expect(db.tx.sesion.create).not.toHaveBeenCalled();
  });

  it('la contraseña cambió mientras se calculaba argon2 → actual incorrecta, sin guardar', async () => {
    prepararBase({ hashBajoBloqueo: '$argon2id$v=19$m=19456,t=2,p=1$b3RyYQ$b3RybyBoYXNo' });

    await expect(cambiar(new ProteccionDeLogin())).rejects.toBeInstanceOf(
      ContrasenaActualIncorrectaError,
    );
    expect(db.tx.usuario.update).not.toHaveBeenCalled();
    expect(db.tx.sesion.create).not.toHaveBeenCalled();
  });

  it('la base se cae en la transacción → BaseDeDatosNoDisponibleError, sin contar un fallo', async () => {
    prepararBase();
    db.tx.sesion.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('conexión cerrada', {
        code: 'P1017',
        clientVersion: '5.22.0',
      }),
    );
    const proteccion = new ProteccionDeLogin();

    await expect(cambiar(proteccion)).rejects.toBeInstanceOf(BaseDeDatosNoDisponibleError);
    expect(proteccion.tamanio).toEqual({ cuentas: 0, origenes: 0, enCurso: 0 });
  });

  it('el COMMIT se pierde sin error (Prisma 5.22): la lectura de confirmación lo detecta → CambioNoConfirmadoError', async () => {
    prepararBase({ commitPerdido: true });
    const proteccion = new ProteccionDeLogin();

    await expect(cambiar(proteccion)).rejects.toBeInstanceOf(CambioNoConfirmadoError);
    // Una lectura antes de verificar y otra, aparte, después del COMMIT.
    expect(db.prisma.usuario.findUnique).toHaveBeenCalledTimes(2);
    expect(db.prisma.usuario.findUnique.mock.calls[1]?.[0]).toEqual({
      where: { id: USUARIO.id },
      select: { passwordHash: true },
    });
    expect(proteccion.tamanio).toEqual({ cuentas: 0, origenes: 0, enCurso: 0 });
  });

  it('la base se cae justo después del COMMIT: no se puede confirmar → BaseDeDatosNoDisponibleError, nunca un éxito', async () => {
    prepararBase();
    const leer = db.prisma.usuario.findUnique.getMockImplementation();
    if (leer === undefined) throw new Error('prepararBase no simuló la lectura del usuario');
    db.prisma.usuario.findUnique.mockImplementationOnce(leer).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('servidor inalcanzable', {
        code: 'P1001',
        clientVersion: '5.22.0',
      }),
    );

    await expect(cambiar(new ProteccionDeLogin())).rejects.toBeInstanceOf(
      BaseDeDatosNoDisponibleError,
    );
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /auth/password por HTTP (la cadena real, la base simulada)', () => {
  const { token, tokenHash } = generarTokenDeSesion();
  const app = createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: new ProteccionDeLogin() });

  /** La sesión de la cookie, como la lee `validarSesion` (con el usuario de la misma consulta). */
  function cookieValida(debeCambiarPassword = false, tiempos = sesionVigente(), activo = true) {
    db.prisma.sesion.findUnique.mockImplementation(({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(
        where.tokenHash === tokenHash
          ? {
              id: SESION_ID,
              ...tiempos,
              usuario: { ...USUARIO, activo, debeCambiarPassword },
            }
          : null,
      ),
    );
  }

  const put = (cuerpo: object = { actual: ACTUAL, nueva: NUEVA }) =>
    request(app)
      .put('/auth/password')
      .set('Origin', ORIGEN)
      .set('Cookie', `${NOMBRE_COOKIE_DE_SESION}=${token}`)
      .send(cuerpo);

  const setCookie = (res: request.Response): string[] => {
    const valor = res.headers['set-cookie'] as string[] | string | undefined;
    return valor === undefined ? [] : ([] as string[]).concat(valor);
  };

  function capturarRegistro() {
    const lineas: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((texto) => {
      lineas.push(String(texto));
      return true;
    });
    return lineas;
  }

  it('voluntario: 204 sin cuerpo y una cookie NUEVA con los atributos de siempre', async () => {
    cookieValida(false);
    prepararBase({ enLaBase: { debeCambiarPassword: false } });
    const registro = capturarRegistro();

    const res = await put();

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    const cookies = setCookie(res);
    expect(cookies).toHaveLength(1);
    const [cookie = ''] = cookies;
    expect(cookie).toMatch(
      new RegExp(
        `^${NOMBRE_COOKIE_DE_SESION}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; Secure; SameSite=Strict$`,
      ),
    );
    const nuevo = cookie.slice(NOMBRE_COOKIE_DE_SESION.length + 1).split(';')[0] ?? '';
    expect(nuevo).not.toBe(token);
    // Ni el token nuevo, ni el viejo, ni las contraseñas aparecen en el registro.
    const texto = registro.join('');
    for (const secreto of [nuevo, token, ACTUAL, NUEVA]) expect(texto).not.toContain(secreto);
    expect(texto).toContain('"evento":"auth.password.cambiada"');
    expect(texto).toContain('"cambio":"voluntario"');
  });

  it('obligatorio: 204 y la cookie se BORRA (hay que volver a entrar)', async () => {
    cookieValida(true);
    prepararBase({ enLaBase: { debeCambiarPassword: true } });
    const registro = capturarRegistro();

    const res = await put();

    expect(res.status).toBe(204);
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
    expect(registro.join('')).toContain('"cambio":"obligatorio"');
  });

  it('la sesión fue revocada mientras se calculaba: 401 SESION_REQUERIDA y la cookie NO se toca', async () => {
    cookieValida(false);
    prepararBase({ delPedido: { ...sesionVigente(), revocadaEn: new Date() } });

    const res = await put();

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { details: { motivo: 'SESION_REQUERIDA' } } });
    // Una respuesta atrasada no puede borrar la cookie rotada que el navegador ya recibió.
    expect(setCookie(res)).toEqual([]);
  });

  it('la sesión venció mientras se calculaba: 401 SESION_VENCIDA y la cookie se borra', async () => {
    cookieValida(false);
    prepararBase({
      delPedido: {
        ...sesionVigente(),
        createdAt: new Date(0),
        ultimaActividadEn: new Date(Date.now() - 25 * HORA),
      },
    });

    const res = await put();

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { details: { motivo: 'SESION_VENCIDA' } } });
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
  });

  it('la base se cae en la transacción: 503, ni cookie nueva ni cookie borrada', async () => {
    cookieValida(false);
    prepararBase();
    db.tx.usuario.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('servidor inalcanzable', {
        code: 'P1001',
        clientVersion: '5.22.0',
      }),
    );

    const res = await put();

    expect(res.status).toBe(503);
    expect(setCookie(res)).toEqual([]);
  });

  it('el COMMIT se pierde sin error: 500, ni cookie nueva ni borrada, y no se registra como cambiada', async () => {
    cookieValida(false);
    prepararBase({ commitPerdido: true });
    const registro = capturarRegistro();
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await put();

    expect(errores).toHaveBeenCalledWith('Error inesperado (CambioNoConfirmadoError) en PUT');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(setCookie(res)).toEqual([]);
    expect(registro.join('')).not.toContain('auth.password.cambiada');
  });

  it('actual incorrecta: 400 en `actual`, nunca 401, y la cookie sigue', async () => {
    cookieValida(false);
    prepararBase();

    const res = await put({ actual: 'otra cosa', nueva: NUEVA });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { details: [{ campo: 'actual', mensaje: 'La contraseña actual no es correcta.' }] },
    });
    expect(setCookie(res)).toEqual([]);
  });
});

describe('requerirSesion: qué 401 borran la cookie', () => {
  const { token, tokenHash } = generarTokenDeSesion();
  const app = createApp({ corsOrigins: [ORIGEN] });

  const consultar = () =>
    request(app).get('/auth/sesion').set('Cookie', `${NOMBRE_COOKIE_DE_SESION}=${token}`);

  function enLaBase(tiempos: ReturnType<typeof sesionVigente>, activo = true) {
    db.prisma.sesion.findUnique.mockImplementation(({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(
        where.tokenHash === tokenHash
          ? {
              id: SESION_ID,
              ...tiempos,
              usuario: { ...USUARIO, activo, debeCambiarPassword: false },
            }
          : null,
      ),
    );
  }

  it('revocada → 401 SESION_REQUERIDA SIN Set-Cookie (puede ser un pedido viejo tras una rotación)', async () => {
    enLaBase({ ...sesionVigente(), revocadaEn: new Date() });

    const res = await consultar();

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { details: { motivo: 'SESION_REQUERIDA' } } });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    [
      'vencida',
      () => ({ ...sesionVigente(), createdAt: new Date(0), expiraEn: new Date(Date.now() - 1) }),
      true,
      'SESION_VENCIDA',
    ],
    ['de una cuenta desactivada', () => sesionVigente(), false, 'SESION_REQUERIDA'],
  ] as const)('%s → 401 %s y la borra', async (_caso, tiempos, activo, motivo) => {
    enLaBase(tiempos(), activo);

    const res = await consultar();

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { details: { motivo } } });
    expect(res.headers['set-cookie']).toEqual([COOKIE_BORRADA]);
  });

  it('desconocida → 401 y la borra', async () => {
    db.prisma.sesion.findUnique.mockResolvedValue(null);

    const res = await consultar();

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toEqual([COOKIE_BORRADA]);
  });
});
