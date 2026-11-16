// `/usuarios` por HTTP con la cadena real: createApp → origen → sesión → contraseña definitiva →
// solo lectura de CONSULTA → autorizar → validate → controlador → errorHandler. La base está
// simulada (sesiones de `sesionSimulada.ts`; cualquier otra tabla queda registrada) y las cinco
// funciones del servicio son espías: acá se prueba la traducción a HTTP. Las reglas del dominio
// contra PostgreSQL real están en `usuarios.integration.test.ts` y el recorrido HTTP completo, con
// el servicio real, en `usuarios.http.integration.test.ts`.

import { MENSAJE_DATO_NO_PERMITIDO, UsuarioAdministradoSchema } from '@realpolitik/shared';
import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { BaseDeDatosNoDisponibleError } from '../../../lib/baseDeDatosNoDisponible';
import { CapacidadAgotadaError } from '../../../lib/limitadorDeConcurrencia';
import {
  clienteConCabeceras,
  clienteDePrueba,
  cookieDe,
  idDe,
  ORIGEN_DE_PRUEBA,
} from '../../auth/__tests__/sesionSimulada';
import {
  ConflictoDeConcurrenciaError,
  DatosDeUsuarioInvalidosError,
  EmailEnUsoError,
  OperacionNoConfirmadaError,
  OperacionSobreCuentaPropiaError,
  UltimoAdministradorError,
  UsuarioInexistenteError,
} from '../usuarios.service';
import type * as ServicioDeUsuarios from '../usuarios.service';

/** Toda tabla que no sea la de sesiones queda registrada: un pedido denegado no toca ninguna. */
const accesos = vi.hoisted(() => [] as string[]);
const base = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get: (_objetivo, clave) => {
          accesos.push(String(clave));
          return undefined;
        },
      },
    ),
);
vi.mock('../../../lib/prisma', async () => {
  const { conSesionesSimuladas } = await import('../../auth/__tests__/sesionSimulada');
  return { prisma: conSesionesSimuladas(base) };
});

const servicio = vi.hoisted(() => ({
  listarUsuarios: vi.fn(),
  crearUsuario: vi.fn(),
  modificarUsuario: vi.fn(),
  cambiarEstadoDeUsuario: vi.fn(),
  restablecerContrasena: vi.fn(),
}));
vi.mock('../usuarios.service', async (original) => ({
  ...(await original<typeof ServicioDeUsuarios>()),
  ...servicio,
}));

const app = createApp({ corsOrigins: [ORIGEN_DE_PRUEBA] });
const admin = () => clienteDePrueba(app, 'ADMINISTRADOR');
const ACTOR = idDe('ADMINISTRADOR');
const ID = 'b1b2b3b4-0000-4000-8000-000000000001';
const TEMPORAL = 'Contrasena-Temporal_De-Prueba_000';
const CLAVES = ['activo', 'debeCambiarPassword', 'email', 'id', 'nombre', 'rol', 'ultimoAccesoEn'];

const USUARIO = {
  id: ID,
  nombre: 'María Gómez',
  email: 'maria@ejemplo.example',
  rol: 'ADMINISTRATIVO' as const,
  activo: true,
  debeCambiarPassword: true,
  ultimoAccesoEn: null,
};

/** Los cinco endpoints, con un pedido válido para cada uno. */
const ENDPOINTS = [
  { nombre: 'GET /usuarios', pedir: (c: Cliente) => c.get('/usuarios') },
  {
    nombre: 'POST /usuarios',
    pedir: (c: Cliente) =>
      c.post('/usuarios').send({ nombre: 'Ana', email: 'ana@ejemplo.example', rol: 'CONSULTA' }),
  },
  {
    nombre: 'PATCH /usuarios/:id',
    pedir: (c: Cliente) => c.patch(`/usuarios/${ID}`).send({ nombre: 'Ana' }),
  },
  {
    nombre: 'PATCH /usuarios/:id/estado',
    pedir: (c: Cliente) => c.patch(`/usuarios/${ID}/estado`).send({ activo: false }),
  },
  {
    nombre: 'POST /usuarios/:id/restablecer-password',
    pedir: (c: Cliente) => c.post(`/usuarios/${ID}/restablecer-password`),
  },
] as const;
type Cliente = ReturnType<typeof clienteConCabeceras>;

type CuerpoDeError = { error: { code: string; message: string; details?: unknown } };
const errorDe = (res: request.Response) => (res.body as CuerpoDeError).error;
const cuerpoDe = (res: request.Response) => res.body as Record<string, unknown>;

const llamadas = () => Object.values(servicio).reduce((n, espia) => n + espia.mock.calls.length, 0);

beforeEach(() => {
  accesos.length = 0;
  servicio.listarUsuarios.mockResolvedValue([USUARIO]);
  servicio.crearUsuario.mockResolvedValue({ usuario: USUARIO, contrasenaTemporal: TEMPORAL });
  servicio.modificarUsuario.mockResolvedValue({
    usuario: USUARIO,
    modificados: ['nombre'],
    sesionesRevocadas: 0,
  });
  servicio.cambiarEstadoDeUsuario.mockResolvedValue({
    usuario: { ...USUARIO, activo: false },
    cambio: true,
    sesionesRevocadas: 2,
  });
  servicio.restablecerContrasena.mockResolvedValue({
    usuario: USUARIO,
    contrasenaTemporal: TEMPORAL,
    sesionesRevocadas: 1,
  });
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe.each(ENDPOINTS)('$nombre: autorización', ({ pedir }) => {
  it('sin sesión: 401 SESION_REQUERIDA, sin llegar al servicio', async () => {
    const res = await pedir(clienteConCabeceras(app, { Origin: ORIGEN_DE_PRUEBA }));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { details: { motivo: 'SESION_REQUERIDA' } } });
    expect(llamadas()).toBe(0);
    expect(accesos).toEqual([]);
  });

  it('sesión inválida (token desconocido): 401, sin llegar al servicio', async () => {
    const res = await pedir(
      clienteConCabeceras(app, {
        Origin: ORIGEN_DE_PRUEBA,
        Cookie: '__Host-rp_sesion=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    );
    expect(res.status).toBe(401);
    expect(llamadas()).toBe(0);
  });

  it.each(['CONSULTA', 'ADMINISTRATIVO'] as const)(
    '%s: 403 PERMISO_INSUFICIENTE, sin datos de cuentas ni efectos',
    async (rol) => {
      const res = await pedir(clienteDePrueba(app, rol));
      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'No tenés permiso para esta acción.',
          details: { motivo: 'PERMISO_INSUFICIENTE' },
        },
      });
      expect(llamadas()).toBe(0);
      expect(accesos).toEqual([]);
    },
  );

  it('contraseña temporal pendiente: 403 CAMBIO_DE_PASSWORD_REQUERIDO, sin llegar al servicio', async () => {
    const res = await pedir(clienteDePrueba(app, 'CAMBIO_PENDIENTE'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { details: { motivo: 'CAMBIO_DE_PASSWORD_REQUERIDO' } },
    });
    expect(llamadas()).toBe(0);
  });

  it('ADMINISTRADOR: llega al servicio una vez, con la base de la app y el actor de la sesión', async () => {
    const res = await pedir(admin());
    expect(res.status).toBeLessThan(300);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(llamadas()).toBe(1);
    const [espia] = Object.values(servicio).filter((e) => e.mock.calls.length > 0);
    const [db, datos] = (espia?.mock.calls[0] ?? []) as unknown[];
    const { prisma } = await import('../../../lib/prisma');
    expect(db).toBe(prisma);
    if (typeof datos === 'object' && datos !== null && 'actorId' in datos) {
      expect(datos.actorId).toBe(ACTOR);
    }
  });
});

describe('CSRF y caché', () => {
  it('una escritura sin Origin, con otro origen o cross-site: 403 ORIGEN_NO_PERMITIDO, sin efectos', async () => {
    const cookie = cookieDe('ADMINISTRADOR');
    for (const cabeceras of [
      { Cookie: cookie },
      { Cookie: cookie, Origin: 'https://sitio-ajeno.example' },
      { Cookie: cookie, Origin: ORIGEN_DE_PRUEBA, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const cliente = clienteConCabeceras(app, cabeceras);
      for (const { nombre, pedir } of ENDPOINTS.filter((e) => !e.nombre.startsWith('GET'))) {
        const res = await pedir(cliente);
        expect(res.status, nombre).toBe(403);
        expect(res.body).toMatchObject({ error: { details: { motivo: 'ORIGEN_NO_PERMITIDO' } } });
      }
    }
    expect(llamadas()).toBe(0);
  });

  it('un GET no necesita Origin', async () => {
    const res = await clienteConCabeceras(app, { Cookie: cookieDe('ADMINISTRADOR') }).get(
      '/usuarios',
    );
    expect(res.status).toBe(200);
  });

  it('las respuestas con contraseña temporal, y los errores, son no-store', async () => {
    const alta = await ENDPOINTS[1].pedir(admin());
    const restablecida = await ENDPOINTS[4].pedir(admin());
    servicio.crearUsuario.mockRejectedValueOnce(new EmailEnUsoError());
    const error = await ENDPOINTS[1].pedir(admin());
    for (const res of [alta, restablecida, error]) {
      expect(res.headers['cache-control']).toBe('no-store');
    }
    expect(alta.body).toHaveProperty('contrasenaTemporal');
  });
});

describe('validación (400 VALIDATION_ERROR, sin llegar al servicio)', () => {
  const casos: [string, (c: Cliente) => ReturnType<Cliente['get']>, string][] = [
    ['id que no es UUID', (c) => c.patch('/usuarios/123').send({ nombre: 'Ana' }), 'id'],
    [
      'id que no es UUID (estado)',
      (c) => c.patch('/usuarios/x/estado').send({ activo: true }),
      'id',
    ],
    ['id que no es UUID (restablecer)', (c) => c.post('/usuarios/x/restablecer-password'), 'id'],
    ['alta sin cuerpo', (c) => c.post('/usuarios'), 'body'],
    [
      'nombre vacío',
      (c) => c.post('/usuarios').send({ nombre: '  ', email: 'a@b.ex', rol: 'CONSULTA' }),
      'nombre',
    ],
    [
      'nombre demasiado largo',
      (c) =>
        c.post('/usuarios').send({ nombre: 'a'.repeat(151), email: 'a@b.ex', rol: 'CONSULTA' }),
      'nombre',
    ],
    [
      'nombre con caracteres de control',
      (c) => c.post('/usuarios').send({ nombre: 'Ana\u0000', email: 'a@b.ex', rol: 'CONSULTA' }),
      'nombre',
    ],
    [
      'email inválido',
      (c) => c.post('/usuarios').send({ nombre: 'Ana', email: 'ana@', rol: 'CONSULTA' }),
      'email',
    ],
    [
      'rol inexistente',
      (c) => c.post('/usuarios').send({ nombre: 'Ana', email: 'a@b.ex', rol: 'ROOT' }),
      'rol',
    ],
    [
      'contraseña enviada por el cliente',
      (c) =>
        c
          .post('/usuarios')
          .send({ nombre: 'Ana', email: 'a@b.ex', rol: 'CONSULTA', password: 'elegida-por-mi' }),
      'password',
    ],
    [
      'activo en el alta',
      (c) =>
        c
          .post('/usuarios')
          .send({ nombre: 'Ana', email: 'a@b.ex', rol: 'CONSULTA', activo: false }),
      'activo',
    ],
    [
      'debeCambiarPassword en el alta',
      (c) =>
        c
          .post('/usuarios')
          .send({ nombre: 'Ana', email: 'a@b.ex', rol: 'CONSULTA', debeCambiarPassword: false }),
      'debeCambiarPassword',
    ],
    ['edición vacía', (c) => c.patch(`/usuarios/${ID}`).send({}), 'body'],
    ['edición del email', (c) => c.patch(`/usuarios/${ID}`).send({ email: 'otra@b.ex' }), 'email'],
    [
      'edición con actorId',
      (c) => c.patch(`/usuarios/${ID}`).send({ nombre: 'Ana', actorId: ID }),
      'actorId',
    ],
    [
      'edición con rol inexistente',
      (c) => c.patch(`/usuarios/${ID}`).send({ rol: 'administrador' }),
      'rol',
    ],
    [
      'estado como texto',
      (c) => c.patch(`/usuarios/${ID}/estado`).send({ activo: 'false' }),
      'activo',
    ],
    ['estado ausente', (c) => c.patch(`/usuarios/${ID}/estado`).send({}), 'activo'],
    [
      'estado con otro dato',
      (c) => c.patch(`/usuarios/${ID}/estado`).send({ activo: true, rol: 'CONSULTA' }),
      'rol',
    ],
    [
      'restablecer con contraseña elegida',
      (c) => c.post(`/usuarios/${ID}/restablecer-password`).send({ password: 'x' }),
      'password',
    ],
    [
      'restablecer con actor',
      (c) => c.post(`/usuarios/${ID}/restablecer-password`).send({ actorId: ID }),
      'actorId',
    ],
    ['búsqueda demasiado larga', (c) => c.get(`/usuarios?q=${'a'.repeat(151)}`), 'q'],
    ['búsqueda con caracteres de control', (c) => c.get('/usuarios?q=a%00b'), 'q'],
    ['búsqueda repetida', (c) => c.get('/usuarios?q=a&q=b'), 'q'],
    ['filtro de rol inexistente', (c) => c.get('/usuarios?rol=ROOT'), 'rol'],
    [
      'incluirDesactivados ambiguo',
      (c) => c.get('/usuarios?incluirDesactivados=1'),
      'incluirDesactivados',
    ],
  ];

  it.each(casos)('%s', async (_caso, pedir, campo) => {
    const res = await pedir(admin());
    expect(res.status).toBe(400);
    expect(errorDe(res).code).toBe('VALIDATION_ERROR');
    expect(errorDe(res).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo })]),
    );
    expect(llamadas()).toBe(0);
  });

  it('un dato no permitido se informa en su campo, junto con los demás errores', async () => {
    const res = await admin()
      .post('/usuarios')
      .send({ nombre: '', email: 'a@b.ex', rol: 'CONSULTA', password: 'x' });
    expect(errorDe(res).details).toEqual(
      expect.arrayContaining([
        { campo: 'password', mensaje: MENSAJE_DATO_NO_PERMITIDO },
        { campo: 'nombre', mensaje: 'Ingresá el nombre.' },
      ]),
    );
    expect(JSON.stringify(res.body)).not.toContain('"x"');
  });
});

describe('GET /usuarios', () => {
  it('200 con un arreglo de cuentas con los campos públicos exactos', async () => {
    const res = await admin().get('/usuarios');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(Object.keys((res.body as object[])[0] ?? {}).sort()).toEqual(CLAVES);
    expect(UsuarioAdministradoSchema.array().parse(res.body)).toHaveLength(1);
  });

  it('traduce la query a los filtros del servicio: q → busqueda; solo activos por defecto', async () => {
    await admin().get('/usuarios');
    await admin().get('/usuarios?q=%20ana%20&rol=CONSULTA&incluirDesactivados=true');
    await admin().get('/usuarios?q=');
    expect(servicio.listarUsuarios.mock.calls.map(([, filtros]) => filtros as unknown)).toEqual([
      { incluirDesactivados: false },
      { busqueda: 'ana', rol: 'CONSULTA', incluirDesactivados: true },
      { incluirDesactivados: false },
    ]);
  });
});

describe('POST /usuarios', () => {
  it('201 con el usuario y la contraseña temporal; el servicio recibe los datos normalizados y el actor de la sesión', async () => {
    const res = await admin()
      .post('/usuarios')
      .set('X-Usuario-Id', ID)
      .send({ nombre: '  Ana Pérez ', email: ' Ana@Ejemplo.EXAMPLE ', rol: 'CONSULTA' });

    expect(res.status).toBe(201);
    expect(Object.keys(cuerpoDe(res)).sort()).toEqual(['contrasenaTemporal', 'usuario']);
    expect(Object.keys(cuerpoDe(res).usuario as object).sort()).toEqual(CLAVES);
    expect(cuerpoDe(res).contrasenaTemporal).toBe(TEMPORAL);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2|sesion/i);
    expect(servicio.crearUsuario).toHaveBeenCalledWith(expect.anything(), {
      actorId: ACTOR,
      datos: { nombre: 'Ana Pérez', email: 'ana@ejemplo.example', rol: 'CONSULTA' },
    });
  });

  it('email de otra cuenta: 409 EMAIL_EN_USO en el campo email', async () => {
    servicio.crearUsuario.mockRejectedValueOnce(new EmailEnUsoError());
    const res = await ENDPOINTS[1].pedir(admin());
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Ya existe una cuenta con ese email.',
        details: { motivo: 'EMAIL_EN_USO', campo: 'email' },
      },
    });
  });
});

describe('PATCH /usuarios/:id', () => {
  it('200 con el usuario, lo que cambió y las sesiones revocadas; solo pasa las claves enviadas', async () => {
    servicio.modificarUsuario.mockResolvedValueOnce({
      usuario: { ...USUARIO, rol: 'CONSULTA' },
      modificados: ['rol'],
      sesionesRevocadas: 3,
    });
    const res = await admin().patch(`/usuarios/${ID}`).send({ rol: 'CONSULTA' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usuario: { ...USUARIO, rol: 'CONSULTA' },
      modificados: ['rol'],
      sesionesRevocadas: 3,
    });
    expect(servicio.modificarUsuario).toHaveBeenCalledWith(expect.anything(), {
      actorId: ACTOR,
      usuarioId: ID,
      cambios: { rol: 'CONSULTA' },
    });
  });

  it('sin cambios reales: 200 con modificados vacío', async () => {
    servicio.modificarUsuario.mockResolvedValueOnce({
      usuario: USUARIO,
      modificados: [],
      sesionesRevocadas: 0,
    });
    const res = await admin().patch(`/usuarios/${ID}`).send({ nombre: USUARIO.nombre });
    expect(res.body).toMatchObject({ modificados: [], sesionesRevocadas: 0 });
  });

  it.each([
    [
      new OperacionSobreCuentaPropiaError('cambiar-rol'),
      409,
      { motivo: 'OPERACION_SOBRE_CUENTA_PROPIA', operacion: 'cambiar-rol' },
    ],
    [
      new UltimoAdministradorError('cambiar-rol'),
      409,
      { motivo: 'ULTIMO_ADMINISTRADOR', operacion: 'cambiar-rol' },
    ],
    [new UsuarioInexistenteError(), 404, undefined],
  ])('%s → %i', async (error, status, details) => {
    servicio.modificarUsuario.mockRejectedValueOnce(error);
    const res = await admin().patch(`/usuarios/${ID}`).send({ rol: 'CONSULTA' });
    expect(res.status).toBe(status);
    expect(errorDe(res).details).toEqual(details);
  });
});

describe('PATCH /usuarios/:id/estado', () => {
  it('200 con el usuario, si hubo cambio y las sesiones revocadas', async () => {
    const res = await admin().patch(`/usuarios/${ID}/estado`).send({ activo: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      usuario: { ...USUARIO, activo: false },
      cambio: true,
      sesionesRevocadas: 2,
    });
    expect(servicio.cambiarEstadoDeUsuario).toHaveBeenCalledWith(expect.anything(), {
      actorId: ACTOR,
      usuarioId: ID,
      activo: false,
    });
  });

  it('la repetición sin cambios: 200 con cambio false', async () => {
    servicio.cambiarEstadoDeUsuario.mockResolvedValueOnce({
      usuario: USUARIO,
      cambio: false,
      sesionesRevocadas: 0,
    });
    const res = await admin().patch(`/usuarios/${ID}/estado`).send({ activo: true });
    expect(res.body).toMatchObject({ cambio: false, sesionesRevocadas: 0 });
  });

  it.each([
    [new OperacionSobreCuentaPropiaError('desactivar'), 'OPERACION_SOBRE_CUENTA_PROPIA'],
    [new UltimoAdministradorError('desactivar'), 'ULTIMO_ADMINISTRADOR'],
  ])('%s → 409 %s', async (error, motivo) => {
    servicio.cambiarEstadoDeUsuario.mockRejectedValueOnce(error);
    const res = await admin().patch(`/usuarios/${ID}/estado`).send({ activo: false });
    expect(res.status).toBe(409);
    expect(errorDe(res).details).toEqual({ motivo, operacion: 'desactivar' });
  });
});

describe('POST /usuarios/:id/restablecer-password', () => {
  it('200 con el usuario y la contraseña temporal nueva, con o sin cuerpo vacío', async () => {
    for (const res of [
      await admin().post(`/usuarios/${ID}/restablecer-password`),
      await admin().post(`/usuarios/${ID}/restablecer-password`).send({}),
    ]) {
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        usuario: USUARIO,
        contrasenaTemporal: TEMPORAL,
        sesionesRevocadas: 1,
      });
    }
    expect(servicio.restablecerContrasena).toHaveBeenCalledWith(expect.anything(), {
      actorId: ACTOR,
      usuarioId: ID,
    });
  });

  it.each([
    [new OperacionSobreCuentaPropiaError('restablecer-password'), 409],
    [new UsuarioInexistenteError(), 404],
  ])('%s → %i, sin contraseña', async (error, status) => {
    servicio.restablecerContrasena.mockRejectedValueOnce(error);
    const res = await ENDPOINTS[4].pedir(admin());
    expect(res.status).toBe(status);
    expect(res.body).not.toHaveProperty('contrasenaTemporal');
  });
});

describe('errores de infraestructura y resultados inciertos', () => {
  const ESCRITURAS = [
    { espia: 'crearUsuario', pedir: ENDPOINTS[1].pedir, mensaje: /no hay una contraseña temporal/ },
    {
      espia: 'modificarUsuario',
      pedir: ENDPOINTS[2].pedir,
      mensaje: /No pudimos confirmar el resultado/,
    },
    {
      espia: 'cambiarEstadoDeUsuario',
      pedir: ENDPOINTS[3].pedir,
      mensaje: /No pudimos confirmar el resultado/,
    },
    {
      espia: 'restablecerContrasena',
      pedir: ENDPOINTS[4].pedir,
      mensaje: /no hay una contraseña temporal/,
    },
  ] as const;

  it.each(ESCRITURAS)(
    '$espia: COMMIT no confirmado → 500 RESULTADO_NO_CONFIRMADO, sin afirmar éxito ni contraseña',
    async ({ espia, pedir, mensaje }) => {
      servicio[espia].mockRejectedValueOnce(new OperacionNoConfirmadaError());
      const res = await pedir(admin());
      expect(res.status).toBe(500);
      expect(errorDe(res)).toMatchObject({
        code: 'INTERNAL_ERROR',
        details: { motivo: 'RESULTADO_NO_CONFIRMADO' },
      });
      expect(errorDe(res).message).toMatch(mensaje);
      expect(errorDe(res).message).not.toMatch(/no se guard/i);
      expect(JSON.stringify(res.body)).not.toContain(TEMPORAL);
    },
  );

  it.each(ESCRITURAS)(
    '$espia: PostgreSQL no responde → 503 RESULTADO_NO_CONFIRMADO, sin Retry-After',
    async ({ espia, pedir, mensaje }) => {
      servicio[espia].mockRejectedValueOnce(new BaseDeDatosNoDisponibleError());
      const res = await pedir(admin());
      expect(res.status).toBe(503);
      expect(errorDe(res)).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        details: { motivo: 'RESULTADO_NO_CONFIRMADO' },
      });
      expect(errorDe(res).message).toMatch(mensaje);
      expect(res.headers['retry-after']).toBeUndefined();
    },
  );

  it('listado con PostgreSQL caído: 503 con Retry-After (una lectura se puede repetir)', async () => {
    servicio.listarUsuarios.mockRejectedValueOnce(new BaseDeDatosNoDisponibleError());
    const res = await admin().get('/usuarios');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(errorDe(res).details).toBeUndefined();
  });

  it.each(['crearUsuario', 'restablecerContrasena'] as const)(
    '%s: capacidad de argon2 agotada → 503 con Retry-After (no se escribió nada)',
    async (espia) => {
      servicio[espia].mockRejectedValueOnce(new CapacidadAgotadaError());
      const res = await (espia === 'crearUsuario' ? ENDPOINTS[1] : ENDPOINTS[4]).pedir(admin());
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('5');
      expect(errorDe(res).message).toBe(
        'El servicio está ocupado. Probá de nuevo en unos segundos.',
      );
    },
  );

  it('conflicto de concurrencia agotado: 409 CONFLICTO_DE_CONCURRENCIA (nada se guardó)', async () => {
    servicio.cambiarEstadoDeUsuario.mockRejectedValueOnce(new ConflictoDeConcurrenciaError());
    const res = await ENDPOINTS[3].pedir(admin());
    expect(res.status).toBe(409);
    expect(errorDe(res).details).toEqual({ motivo: 'CONFLICTO_DE_CONCURRENCIA' });
  });

  it('datos inválidos del dominio: 400 con sus campos (el campo vacío se informa en body)', async () => {
    servicio.modificarUsuario.mockRejectedValueOnce(
      new DatosDeUsuarioInvalidosError([
        { campo: 'nombre', mensaje: 'Ingresá el nombre.' },
        { campo: '', mensaje: 'Enviá el nombre o el rol para modificar.' },
      ]),
    );
    const res = await ENDPOINTS[2].pedir(admin());
    expect(res.status).toBe(400);
    expect(errorDe(res).details).toEqual([
      { campo: 'nombre', mensaje: 'Ingresá el nombre.' },
      { campo: 'body', mensaje: 'Enviá el nombre o el rol para modificar.' },
    ]);
  });

  it('error inesperado: 500 genérico, sin detalles internos ni secretos', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    servicio.crearUsuario.mockRejectedValueOnce(
      new Error(`SELECT "passwordHash" FROM "Usuario" host=db password=${TEMPORAL}`),
    );
    const res = await ENDPOINTS[1].pedir(admin());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
    });
    expect(JSON.stringify(consola.mock.calls)).not.toMatch(/passwordHash|host=db|Contrasena/);
  });
});
