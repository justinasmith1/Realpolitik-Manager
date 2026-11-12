// `/auth` por HTTP en lo que no necesita la base: origen (CSRF), caché, cookies y contrato de errores.
// La cadena es la real (createApp → sinCache → verificarOrigen → json → validate → controlador →
// errorHandler); ningún caso de este archivo llega a PostgreSQL.

import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { mensajeDeEspera } from '../auth.controller';
import { leerTokenDeSesion, NOMBRE_COOKIE_DE_SESION } from '../cookieDeSesion';
import { limiteDeHash } from '../limiteDeHash';
import { ProteccionDeLogin, type ResultadoDeReserva } from '../proteccionDeLogin';
import { truncarIp } from '../registroDeEventos';

const ORIGEN = 'http://localhost:5173';
const app = createApp({ corsOrigins: [ORIGEN] });

const COOKIE_BORRADA = `${NOMBRE_COOKIE_DE_SESION}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
const CREDENCIALES = { email: 'persona@ejemplo.example', password: 'una contraseña cualquiera' };

afterEach(() => {
  vi.restoreAllMocks();
});

type CuerpoDeError = { error: { code: string; message: string; details?: unknown } };
const errorDe = (res: request.Response) => (res.body as CuerpoDeError).error;

const setCookie = (res: request.Response): string[] => {
  const valor = res.headers['set-cookie'] as string[] | string | undefined;
  return valor === undefined ? [] : ([] as string[]).concat(valor);
};

describe('verificación de Origin (CSRF) en /auth', () => {
  it.each([
    ['sin Origin', undefined],
    ['Origin: null', 'null'],
    ['otro sitio', 'https://sitio-ajeno.example'],
    ['un sufijo que lo contiene', 'http://localhost:5173.ajeno.example'],
    ['un subdominio', 'http://evil.localhost:5173'],
    ['otro puerto', 'http://localhost:5174'],
    ['otro esquema', 'https://localhost:5173'],
    ['con barra final', 'http://localhost:5173/'],
    ['en mayúsculas', 'HTTP://LOCALHOST:5173'],
  ])(
    'POST /auth/login con %s → 403 ORIGEN_NO_PERMITIDO, sin leer el pedido ni emitir cookie',
    async (_caso, origen) => {
      const pedido = request(app).post('/auth/login');
      if (origen !== undefined) pedido.set('Origin', origen);

      const res = await pedido.send(CREDENCIALES);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Origen no permitido.',
          details: { motivo: 'ORIGEN_NO_PERMITIDO' },
        },
      });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(setCookie(res)).toEqual([]);
    },
  );

  it('rechaza el origen propio si el navegador informa Sec-Fetch-Site: cross-site', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Origin', ORIGEN)
      .set('Sec-Fetch-Site', 'cross-site')
      .send(CREDENCIALES);

    expect(res.status).toBe(403);
  });

  it.each(['same-origin', 'same-site'])(
    'acepta Sec-Fetch-Site: %s con el origen permitido',
    async (sitio) => {
      const res = await request(app)
        .post('/auth/login')
        .set('Origin', ORIGEN)
        .set('Sec-Fetch-Site', sitio)
        .send({});

      expect(res.status).toBe(400); // pasó el origen; falla la validación del cuerpo
    },
  );

  it('también protege el cierre de sesión', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', 'https://sitio-ajeno.example');

    expect(res.status).toBe(403);
    expect(setCookie(res)).toEqual([]);
  });

  it('un origen ajeno se rechaza antes de leer el cuerpo (aunque sea JSON inválido)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Origin', 'https://sitio-ajeno.example')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(403);
  });

  it('GET /auth/sesion no exige Origin (no modifica nada)', async () => {
    const res = await request(app).get('/auth/sesion');

    expect(res.status).toBe(401);
  });

  it('registra el rechazo sin datos del pedido', async () => {
    const escritura = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await request(app)
      .post('/auth/login')
      .set('Origin', 'https://sitio-ajeno.example')
      .send(CREDENCIALES);

    const lineas = escritura.mock.calls.map(([texto]) => String(texto));
    const evento = lineas.find((linea) => linea.includes('auth.origen_rechazado'));
    expect(evento).toBeDefined();
    expect(evento).not.toContain(CREDENCIALES.email);
    expect(evento).not.toContain(CREDENCIALES.password);
  });

  it('rige también en la API de negocio (etapa 3): sin Origin, 403 antes de la sesión', async () => {
    const res = await request(app).post('/clientes').send({});

    expect(res.status).toBe(403);
    expect(errorDe(res).details).toEqual({ motivo: 'ORIGEN_NO_PERMITIDO' });
  });
});

describe('Cache-Control: no-store en todas las respuestas de /auth', () => {
  it.each([
    ['un 401 sin sesión', () => request(app).get('/auth/sesion')],
    [
      'un 400 de validación',
      () => request(app).post('/auth/login').set('Origin', ORIGEN).send({ email: 'x' }),
    ],
    [
      'un 400 de JSON mal formado',
      () =>
        request(app)
          .post('/auth/login')
          .set('Origin', ORIGEN)
          .set('Content-Type', 'application/json')
          .send('{"x": '),
    ],
    ['un 204 de cierre de sesión', () => request(app).post('/auth/logout').set('Origin', ORIGEN)],
    ['un 401 de una ruta inexistente (anónimo)', () => request(app).get('/auth/inexistente')],
  ])('%s', async (_caso, pedido) => {
    const res = await pedido();

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rige también en el resto de la API (etapa 3), incluido /health', async () => {
    for (const ruta of ['/health', '/clientes', '/no-existe']) {
      expect((await request(app).get(ruta)).headers['cache-control']).toBe('no-store');
    }
  });
});

describe('POST /auth/login: contrato del pedido', () => {
  it.each([
    ['sin email', { password: 'x' }, 'email'],
    ['con un email inválido', { email: 'no-es-un-email', password: 'x' }, 'email'],
    ['sin contraseña', { email: 'a@ejemplo.example' }, 'password'],
    ['con la contraseña vacía', { email: 'a@ejemplo.example', password: '' }, 'password'],
    [
      'con una contraseña de más de 128 caracteres',
      { email: 'a@ejemplo.example', password: 'x'.repeat(129) },
      'password',
    ],
  ])('%s → 400 VALIDATION_ERROR', async (_caso, cuerpo, campo) => {
    const res = await request(app).post('/auth/login').set('Origin', ORIGEN).send(cuerpo);

    expect(res.status).toBe(400);
    expect(errorDe(res).code).toBe('VALIDATION_ERROR');
    expect(errorDe(res).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo })]),
    );
    expect(JSON.stringify(res.body)).not.toContain('x'.repeat(129));
  });
});

describe('GET /auth/sesion sin una sesión utilizable', () => {
  it('sin cookie → 401 SESION_REQUERIDA, sin tocar la cookie', async () => {
    const res = await request(app).get('/auth/sesion');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Iniciá sesión para continuar.',
        details: { motivo: 'SESION_REQUERIDA' },
      },
    });
    expect(setCookie(res)).toEqual([]);
  });

  it('con una cookie mal formada → 401 SESION_REQUERIDA y la borra (sin consultar la base)', async () => {
    const res = await request(app)
      .get('/auth/sesion')
      .set('Cookie', `${NOMBRE_COOKIE_DE_SESION}=basura`);

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
  });
});

describe('PUT /auth/password sin una sesión utilizable', () => {
  it('sin cookie → 401 SESION_REQUERIDA antes de validar el cuerpo (primero 401, después 400)', async () => {
    const res = await request(app).put('/auth/password').set('Origin', ORIGEN).send({ nueva: 'x' });

    expect(res.status).toBe(401);
    expect(errorDe(res).details).toEqual({ motivo: 'SESION_REQUERIDA' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(setCookie(res)).toEqual([]);
  });

  it('con una cookie mal formada → 401 y la borra (sin consultar la base)', async () => {
    const res = await request(app)
      .put('/auth/password')
      .set('Origin', ORIGEN)
      .set('Cookie', `${NOMBRE_COOKIE_DE_SESION}=basura`)
      .send({ actual: 'a', nueva: 'una frase nueva y larga' });

    expect(res.status).toBe(401);
    expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
  });

  it('sin Origin → 403 (CSRF), antes que la sesión', async () => {
    const res = await request(app)
      .put('/auth/password')
      .set('Cookie', `${NOMBRE_COOKIE_DE_SESION}=basura`)
      .send({});

    expect(res.status).toBe(403);
    expect(errorDe(res).details).toEqual({ motivo: 'ORIGEN_NO_PERMITIDO' });
  });
});

describe('429: código, mensaje y Retry-After coherentes', () => {
  it.each([
    [1, 'Demasiados intentos. Probá de nuevo en 1 segundo.'],
    [30, 'Demasiados intentos. Probá de nuevo en 30 segundos.'],
    [59, 'Demasiados intentos. Probá de nuevo en 59 segundos.'],
    [60, 'Demasiados intentos. Probá de nuevo en un minuto.'],
    [61, 'Demasiados intentos. Probá de nuevo en 2 minutos.'],
    [120, 'Demasiados intentos. Probá de nuevo en 2 minutos.'],
    [900, 'Demasiados intentos. Probá de nuevo en 15 minutos.'],
  ])('Retry-After %i s → "%s"', (segundos, mensaje) => {
    expect(mensajeDeEspera(segundos)).toBe(mensaje);
  });

  class ProteccionQueRechaza extends ProteccionDeLogin {
    constructor(private readonly rechazo: Extract<ResultadoDeReserva, { permitido: false }>) {
      super();
    }
    override reservar(): ResultadoDeReserva {
      return this.rechazo;
    }
  }

  const loginCon = (rechazo: Extract<ResultadoDeReserva, { permitido: false }>) => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    return request(
      createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: new ProteccionQueRechaza(rechazo) }),
    )
      .post('/auth/login')
      .set('Origin', ORIGEN)
      .send(CREDENCIALES);
  };

  it('otro intento de la misma cuenta en curso: 429 INTENTO_EN_CURSO, Retry-After 1, sin "demasiados intentos"', async () => {
    const res = await loginCon({ permitido: false, motivo: 'concurrencia', retryAfterMs: 1000 });

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message:
          'Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo.',
        details: { motivo: 'INTENTO_EN_CURSO' },
      },
    });
  });

  it('contadores llenos: una cuenta nueva recibe 429 DEMASIADOS_INTENTOS sin llegar a la base ni a argon2', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const hash = vi.spyOn(limiteDeHash, 'ejecutar');
    const reloj = { ahora: 1_000_000 };
    const proteccion = new ProteccionDeLogin({
      ahora: () => reloj.ahora,
      maximoDeClaves: 1,
      limitePorOrigen: false,
    });
    const ocupa = proteccion.reservar('ocupa@ejemplo.example', '10.0.0.1');
    if (!ocupa.permitido) throw new Error('debía permitir');
    ocupa.intento.fallo();

    const res = await request(createApp({ corsOrigins: [ORIGEN], proteccionDeLogin: proteccion }))
      .post('/auth/login')
      .set('Origin', ORIGEN)
      .send(CREDENCIALES);

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('3600');
    expect(errorDe(res)).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Demasiados intentos. Probá de nuevo en 60 minutos.',
      details: { motivo: 'DEMASIADOS_INTENTOS' },
    });
    expect(hash).not.toHaveBeenCalled();
  });

  it('la espera se redondea hacia arriba igual en el mensaje y en Retry-After', async () => {
    const res = await loginCon({ permitido: false, motivo: 'demora-cuenta', retryAfterMs: 29_001 });

    expect(res.headers['retry-after']).toBe('30');
    expect(errorDe(res)).toMatchObject({
      message: 'Demasiados intentos. Probá de nuevo en 30 segundos.',
      details: { motivo: 'DEMASIADOS_INTENTOS' },
    });
  });
});

describe('POST /auth/logout sin una sesión utilizable', () => {
  it('sin cookie: 204 y borra la cookie con los mismos atributos con que se crea; repetido, igual', async () => {
    for (let i = 0; i < 2; i += 1) {
      const res = await request(app).post('/auth/logout').set('Origin', ORIGEN);

      expect(res.status).toBe(204);
      expect(setCookie(res)).toEqual([COOKIE_BORRADA]);
    }
  });

  it('con una cookie mal formada: 204 sin consultar la base', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Origin', ORIGEN)
      .set('Cookie', `${NOMBRE_COOKIE_DE_SESION}=basura`);

    expect(res.status).toBe(204);
  });
});

describe('IP del cliente para el límite por origen (trust proxy)', () => {
  // Protección que anota la IP que recibe y rechaza: el login termina en 429 sin tocar la base.
  class ProteccionQueAnota extends ProteccionDeLogin {
    ips: (string | undefined)[] = [];
    override reservar(_email: string, ip: string | undefined): ResultadoDeReserva {
      this.ips.push(ip);
      return { permitido: false, motivo: 'limite-origen', retryAfterMs: 60_000 };
    }
  }

  const ipVista = async (saltos: number | undefined, xff?: string) => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const proteccionDeLogin = new ProteccionQueAnota();
    const pedido = request(
      createApp({
        corsOrigins: [ORIGEN],
        proteccionDeLogin,
        ...(saltos === undefined ? {} : { saltosDeProxyConfiables: saltos }),
      }),
    )
      .post('/auth/login')
      .set('Origin', ORIGEN);
    if (xff !== undefined) pedido.set('X-Forwarded-For', xff);
    const res = await pedido.send(CREDENCIALES);
    expect(res.status).toBe(429);
    return proteccionDeLogin.ips[0];
  };

  it('por defecto (0 saltos) usa la IP del socket e ignora un X-Forwarded-For del cliente', async () => {
    const ip = await ipVista(undefined, '203.0.113.9');
    expect(ip).not.toBe('203.0.113.9');
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('con 1 salto confía solo en la última dirección agregada, no en las que inventa el cliente', async () => {
    expect(await ipVista(1, '203.0.113.9')).toBe('203.0.113.9');
    expect(await ipVista(1, '198.51.100.1, 203.0.113.9')).toBe('203.0.113.9');
  });
});

describe('leerTokenDeSesion', () => {
  const conCookie = (cookie: string | undefined) =>
    leerTokenDeSesion({ headers: cookie === undefined ? {} : { cookie } } as Parameters<
      typeof leerTokenDeSesion
    >[0]);

  it.each([
    ['sin cabecera', undefined, undefined],
    ['otra cookie', 'otra=1', undefined],
    ['la de sesión entre otras', `a=1; ${NOMBRE_COOKIE_DE_SESION}=abc; b=2`, 'abc'],
    ['un nombre parecido sin el prefijo', 'rp_sesion=abc', undefined],
    [
      'dos veces: usa la primera',
      `${NOMBRE_COOKIE_DE_SESION}=uno; ${NOMBRE_COOKIE_DE_SESION}=dos`,
      'uno',
    ],
    ['codificación inválida', `${NOMBRE_COOKIE_DE_SESION}=%E0%A4%A`, undefined],
  ])('%s', (_caso, cookie, esperado) => {
    expect(conCookie(cookie)).toBe(esperado);
  });
});

describe('truncarIp (registro de eventos)', () => {
  it.each([
    ['203.0.113.57', '203.0.113.0/24'],
    ['::ffff:198.51.100.23', '198.51.100.0/24'],
    ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3::/48'],
    ['2001:db8::1', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
  ])('%s → %s', (ip, esperado) => {
    expect(truncarIp(ip)).toBe(esperado);
  });
});
