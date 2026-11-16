// Administración de usuarios contra PostgreSQL REAL: listado, alta, edición, estados,
// restablecimiento, sesiones y eventos. El login es el de producción (`iniciarSesion`).
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`). Solo crean, modifican y borran cuentas con
// la marca de la corrida. No dependen de que haya o no otros administradores en la base: el último
// administrador y las carreras están en `usuarios.concurrencia.integration.test.ts`.

import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BaseDeDatosNoDisponibleError } from '../../../lib/baseDeDatosNoDisponible';
import type * as Autenticacion from '../../auth/autenticacion.service';
import { hashearContrasena, verificarContrasena } from '../../auth/contrasenas';
import { evaluarContrasenaNueva } from '../../auth/politicaDeContrasenas';
import { ProteccionDeLogin } from '../../auth/proteccionDeLogin';
import type * as Sesiones from '../../auth/sesiones.service';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
// Solo tipos: el servicio carga `lib/prisma` (vía sesiones), y eso tiene que pasar DESPUÉS de fijar
// `DATABASE_URL` en `beforeAll`. Con un import estático, `lib/prisma` tomaría la base del `.env`.
import type * as Servicio from '../usuarios.service';

import {
  capturarEventos,
  conexion,
  type Cuentas,
  cuentasDePrueba,
  conexionVerificada,
  nuevaMarca,
  PASSWORD,
} from './entornoDeUsuarios';

const url = urlDeBaseDescartable();
const MARCA = nuevaMarca('usuarios');
const INEXISTENTE = '00000000-0000-4000-8000-00000000beef';
const CLAVES = ['activo', 'debeCambiarPassword', 'email', 'id', 'nombre', 'rol', 'ultimoAccesoEn'];

/** La conexión de la aplicación (`lib/prisma`): la usan el login y la validación de sesiones. */
let prisma: PrismaClient;
/** Otra conexión, la de los servicios administrativos (como otro proceso). */
let admin: PrismaClient;
let cuentas: Cuentas;
let auth: typeof Autenticacion;
let sesiones: typeof Sesiones;
/** El ADMINISTRADOR que ejecuta las operaciones. */
let actor: { id: string };
let s: typeof Servicio;
/** La guarda pasó: solo entonces se limpia (nunca se escribe en una base sin verificar). */
let verificada = false;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  auth = await import('../../auth/autenticacion.service');
  sesiones = await import('../../auth/sesiones.service');
  s = await import('../usuarios.service');
  admin = conexion(url);
  // La guarda corre antes de cualquier escritura; si falla, la suite no arranca.
  cuentas = await cuentasDePrueba({
    url,
    prisma,
    otras: [admin],
    marca: MARCA,
    hash: await hashearContrasena(PASSWORD),
  });
  verificada = true;
  actor = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'actor' });
});

afterAll(async () => {
  if (url === undefined) return;
  if (verificada) await cuentas.limpiar();
  await prisma?.$disconnect();
  await admin?.$disconnect();
});

let eventos: ReturnType<typeof capturarEventos>;
beforeAll(() => {
  eventos = capturarEventos();
});
afterAll(() => eventos?.soltar());
afterEach(() => {
  // Cada test mira solo sus eventos.
  eventos?.soltar();
  eventos = capturarEventos();
});

const login = (email: string, password = PASSWORD) =>
  auth.iniciarSesion({ email, password, ip: '192.0.2.10' }, new ProteccionDeLogin());

const fila = (id: string) => prisma.usuario.findUniqueOrThrow({ where: { id } });

/** Sesiones sin revocar y sin vencer (las que `validarSesion` aceptaría con la cuenta activa). */
const vigentes = (usuarioId: string) =>
  prisma.sesion.findMany({ where: { usuarioId, revocadaEn: null, expiraEn: { gt: new Date() } } });

describe.skipIf(url === undefined)('listarUsuarios', () => {
  it('devuelve solo los campos de la administración, sin hash ni sesiones', async () => {
    const cuenta = await cuentas.crear({ nombre: `Lista ${MARCA}` });
    await login(cuenta.email);

    const lista = await s.listarUsuarios(admin, { busqueda: `Lista ${MARCA}` });

    expect(lista).toHaveLength(1);
    expect(Object.keys(lista[0] ?? {}).sort()).toEqual(CLAVES);
    expect(lista[0]).toMatchObject({ id: cuenta.id, rol: 'ADMINISTRATIVO', activo: true });
    expect(lista[0]?.ultimoAccesoEn).toBeInstanceOf(Date);
    expect(JSON.stringify(lista)).not.toMatch(/argon2|passwordHash|tokenHash|sesion/i);
  });

  it('no lee columnas sensibles: la consulta SQL selecciona solo los campos permitidos', async () => {
    const espia = new PrismaClient({
      datasourceUrl: url ?? '',
      log: [{ emit: 'event', level: 'query' }],
    });
    const consultas: string[] = [];
    espia.$on('query', (e: Prisma.QueryEvent) => consultas.push(e.query));
    try {
      await s.listarUsuarios(espia, { busqueda: MARCA, incluirDesactivados: true });
    } finally {
      await espia.$disconnect();
    }
    const select = consultas.find((q) => q.includes('FROM "public"."Usuario"'));
    expect(select).toBeDefined();
    expect(select).not.toMatch(/passwordHash|passwordActualizadaEn|"Sesion"/);
  });

  it('ordena por nombre y después por email, y por defecto omite las desactivadas', async () => {
    const zoe = await cuentas.crear({ nombre: `Zoe ${MARCA}`, alias: 'orden-a' });
    const anaB = await cuentas.crear({ nombre: `Ana ${MARCA}`, alias: 'orden-c' });
    const anaA = await cuentas.crear({ nombre: `Ana ${MARCA}`, alias: 'orden-b' });
    const baja = await cuentas.crear({ nombre: `Ana ${MARCA}`, alias: 'orden-d', activo: false });

    const activos = await s.listarUsuarios(admin, { busqueda: `${MARCA}-orden` });
    expect(activos.map((u) => u.id)).toEqual([anaA.id, anaB.id, zoe.id]);

    const todos = await s.listarUsuarios(admin, {
      busqueda: `${MARCA}-orden`,
      incluirDesactivados: true,
    });
    expect(todos.map((u) => u.id)).toEqual([anaA.id, anaB.id, baja.id, zoe.id]);
    expect(todos.find((u) => u.id === baja.id)?.activo).toBe(false);
  });

  it('busca en nombre y email sin distinguir mayúsculas, con comodines literales, y filtra por rol', async () => {
    const consulta = await cuentas.crear({ rol: 'CONSULTA', nombre: `Búsqueda_100% ${MARCA}` });
    const otra = await cuentas.crear({ rol: 'ADMINISTRATIVO', nombre: `Búsqueda ${MARCA}` });

    const porNombre = await s.listarUsuarios(admin, {
      busqueda: `búsqueda_100% ${MARCA}`.toUpperCase(),
    });
    expect(porNombre.map((u) => u.id)).toEqual([consulta.id]);

    const porEmail = await s.listarUsuarios(admin, { busqueda: consulta.email.toUpperCase() });
    expect(porEmail.map((u) => u.id)).toEqual([consulta.id]);

    // `%` y `_` no son comodines: "Búsqueda_" no encuentra "Búsqueda " ni "%" todo.
    expect((await s.listarUsuarios(admin, { busqueda: `Búsqueda_ ${MARCA}` })).length).toBe(0);
    expect(
      (await s.listarUsuarios(admin, { busqueda: '%' })).every((u) => u.nombre.includes('%')),
    ).toBe(true);

    const soloConsulta = await s.listarUsuarios(admin, { busqueda: `Búsqueda`, rol: 'CONSULTA' });
    expect(soloConsulta.map((u) => u.id)).toContain(consulta.id);
    expect(soloConsulta.map((u) => u.id)).not.toContain(otra.id);
    expect(soloConsulta.every((u) => u.rol === 'CONSULTA')).toBe(true);
  });
});

describe.skipIf(url === undefined)('crearUsuario', () => {
  it('crea la cuenta activa, con cambio obligatorio, sin último acceso y solo el hash argon2id', async () => {
    const ahora = new Date('2026-11-15T10:00:00.000Z');
    const { usuario, contrasenaTemporal } = await s.crearUsuario(
      admin,
      {
        actorId: actor.id,
        datos: {
          nombre: '  Nueva Persona  ',
          email: `  ${cuentas.email('alta').toUpperCase()} `,
          rol: 'CONSULTA',
        },
      },
      ahora,
    );

    expect(Object.keys(usuario).sort()).toEqual(CLAVES);
    expect(usuario).toEqual({
      id: expect.any(String) as unknown,
      nombre: 'Nueva Persona',
      email: cuentas.email('alta'),
      rol: 'CONSULTA',
      activo: true,
      debeCambiarPassword: true,
      ultimoAccesoEn: null,
    });
    expect(evaluarContrasenaNueva(contrasenaTemporal, usuario)).toEqual({ aceptada: true });

    const guardada = await fila(usuario.id);
    // Los parámetros de PARAMETROS_ARGON2 (19 MiB, 2 pasadas, paralelismo 1), en el orden del PHC.
    expect(guardada.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(await verificarContrasena(guardada.passwordHash, contrasenaTemporal)).toBe(true);
    expect(guardada.passwordActualizadaEn).toEqual(ahora);
    expect(JSON.stringify(guardada)).not.toContain(contrasenaTemporal);
    expect(await prisma.sesion.count({ where: { usuarioId: usuario.id } })).toBe(0);

    expect(eventos.administrativos()).toEqual([
      expect.objectContaining({
        evento: 'usuarios.creado',
        actorId: actor.id,
        usuarioId: usuario.id,
        rol: 'CONSULTA',
      }),
    ]);
    const todo = eventos.lineas().join('');
    expect(todo).not.toContain(contrasenaTemporal);
    expect(todo).not.toContain(cuentas.email('alta'));
    expect(todo).not.toContain('argon2');
  });

  it('con la contraseña temporal se entra y la sesión exige el cambio obligatorio', async () => {
    const { usuario, contrasenaTemporal } = await s.crearUsuario(admin, {
      actorId: actor.id,
      datos: {
        nombre: 'Primer Ingreso',
        email: cuentas.email('primer-ingreso'),
        rol: 'ADMINISTRATIVO',
      },
    });
    const entrada = await login(usuario.email, contrasenaTemporal);
    expect(entrada.usuario).toMatchObject({ id: usuario.id, debeCambiarPassword: true });
  });

  it('rechaza un email ya usado, sin distinguir mayúsculas, aunque la cuenta esté desactivada', async () => {
    const activa = await cuentas.crear({ alias: 'repetido-activa' });
    const inactiva = await cuentas.crear({ alias: 'repetido-inactiva', activo: false });

    for (const email of [activa.email.toUpperCase(), ` ${inactiva.email} `]) {
      await expect(
        s.crearUsuario(admin, {
          actorId: actor.id,
          datos: { nombre: 'Otra', email, rol: 'CONSULTA' },
        }),
      ).rejects.toBeInstanceOf(s.EmailEnUsoError);
    }
    expect(
      await prisma.usuario.count({ where: { email: { in: [activa.email, inactiva.email] } } }),
    ).toBe(2);
    expect(eventos.administrativos()).toEqual([]);
  });

  it('datos inválidos: nada se crea', async () => {
    const error = await s
      .crearUsuario(admin, {
        actorId: actor.id,
        datos: { nombre: 'Ana\u0000', email: cuentas.email('invalida'), rol: 'ROOT' },
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(s.DatosDeUsuarioInvalidosError);
    expect(await prisma.usuario.count({ where: { email: cuentas.email('invalida') } })).toBe(0);
  });

  it('altas simultáneas con el mismo email: una sola cuenta, las demás EmailEnUsoError (índice único)', async () => {
    const conexiones = [
      admin,
      ...(await Promise.all([1, 2, 3].map(() => conexionVerificada(url ?? '')))),
    ];
    try {
      const email = cuentas.email('carrera');
      const resultados = await Promise.allSettled(
        conexiones.map((db, i) =>
          s.crearUsuario(db, {
            actorId: actor.id,
            datos: { nombre: `Carrera ${i}`, email, rol: 'CONSULTA' },
          }),
        ),
      );
      const creadas = resultados.filter((r) => r.status === 'fulfilled');
      const rechazos = resultados.filter((r) => r.status === 'rejected');
      expect(creadas).toHaveLength(1);
      expect(rechazos).toHaveLength(conexiones.length - 1);
      for (const r of rechazos) expect(r.reason).toBeInstanceOf(s.EmailEnUsoError);
      expect(await prisma.usuario.count({ where: { email } })).toBe(1);
      expect(eventos.administrativos()).toHaveLength(1);
    } finally {
      await Promise.all(conexiones.slice(1).map((db) => db.$disconnect()));
    }
  });
});

describe.skipIf(url === undefined)('modificarUsuario', () => {
  it('cambiar el nombre lo guarda, conserva el rol y no revoca sesiones', async () => {
    const cuenta = await cuentas.crear({ rol: 'CONSULTA' });
    const { sesion } = await login(cuenta.email);

    const resultado = await s.modificarUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      cambios: { nombre: '  Nombre Nuevo ' },
    });

    expect(resultado).toMatchObject({ modificados: ['nombre'], sesionesRevocadas: 0 });
    expect(resultado.usuario).toMatchObject({ nombre: 'Nombre Nuevo', rol: 'CONSULTA' });
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([
      expect.objectContaining({
        evento: 'usuarios.nombre_cambiado',
        actorId: actor.id,
        usuarioId: cuenta.id,
      }),
    ]);
  });

  it('cambiar el rol revoca TODAS sus sesiones; la siguiente entra con el rol nuevo', async () => {
    const cuenta = await cuentas.crear({ rol: 'ADMINISTRATIVO' });
    const tokens = [
      (await login(cuenta.email)).sesion.token,
      (await login(cuenta.email)).sesion.token,
    ];

    const resultado = await s.modificarUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      cambios: { rol: 'CONSULTA' },
    });

    expect(resultado).toMatchObject({ modificados: ['rol'], sesionesRevocadas: 2 });
    for (const token of tokens) {
      expect(await sesiones.validarSesion(token)).toEqual({ valida: false, motivo: 'REVOCADA' });
    }
    const nueva = await login(cuenta.email);
    const validada = await sesiones.validarSesion(nueva.sesion.token);
    expect(validada.valida && validada.sesion.usuario.rol).toBe('CONSULTA');
    expect(eventos.administrativos()).toEqual([
      {
        fecha: expect.any(String) as unknown,
        evento: 'usuarios.rol_cambiado',
        actorId: actor.id,
        usuarioId: cuenta.id,
        rolAnterior: 'ADMINISTRATIVO',
        rol: 'CONSULTA',
        sesionesRevocadas: 2,
      },
    ]);
  });

  it('nombre y rol juntos: guarda ambos y revoca (un evento por cada cambio)', async () => {
    const cuenta = await cuentas.crear({ rol: 'CONSULTA' });
    await login(cuenta.email);
    const resultado = await s.modificarUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      cambios: { nombre: 'Ambos', rol: 'ADMINISTRATIVO' },
    });
    expect(resultado).toMatchObject({ modificados: ['nombre', 'rol'], sesionesRevocadas: 1 });
    expect(eventos.administrativos().map((e) => e.evento)).toEqual([
      'usuarios.nombre_cambiado',
      'usuarios.rol_cambiado',
    ]);
  });

  it('el administrador cambia su propio nombre, pero no su rol (ni junto con el nombre)', async () => {
    const propio = await cuentas.crear({ rol: 'ADMINISTRADOR', alias: 'propio' });
    await cuentas.crear({ rol: 'ADMINISTRADOR' }); // no es el último administrador: igual se rechaza
    const { sesion } = await login(propio.email);

    const nombre = await s.modificarUsuario(admin, {
      actorId: propio.id,
      usuarioId: propio.id,
      cambios: { nombre: 'Mi Nombre' },
    });
    expect(nombre.modificados).toEqual(['nombre']);
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);

    for (const rol of ['ADMINISTRATIVO', 'CONSULTA']) {
      await expect(
        s.modificarUsuario(admin, {
          actorId: propio.id.toUpperCase(),
          usuarioId: propio.id,
          cambios: { nombre: 'Otro Nombre', rol },
        }),
      ).rejects.toEqual(new s.OperacionSobreCuentaPropiaError('cambiar-rol'));
    }
    expect(await fila(propio.id)).toMatchObject({ nombre: 'Mi Nombre', rol: 'ADMINISTRADOR' });
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);
  });

  it('sin cambios reales: no escribe, no revoca y no registra eventos', async () => {
    const cuenta = await cuentas.crear({ rol: 'CONSULTA' });
    const { sesion } = await login(cuenta.email);
    const antes = await fila(cuenta.id);

    const resultado = await s.modificarUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      cambios: { nombre: ` ${antes.nombre} `, rol: 'CONSULTA' },
    });

    expect(resultado).toMatchObject({ modificados: [], sesionesRevocadas: 0 });
    expect((await fila(cuenta.id)).updatedAt).toEqual(antes.updatedAt);
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([]);
  });

  it('no modifica el email ni otras propiedades', async () => {
    const cuenta = await cuentas.crear();
    const antes = await fila(cuenta.id);
    for (const cambios of [
      { email: cuentas.email('cambiado') },
      { nombre: 'X', activo: false },
      { passwordHash: '$argon2id$v=19$x' },
      { debeCambiarPassword: true },
    ]) {
      await expect(
        s.modificarUsuario(admin, {
          actorId: actor.id,
          usuarioId: cuenta.id,
          cambios,
        }),
      ).rejects.toBeInstanceOf(s.DatosDeUsuarioInvalidosError);
    }
    expect(await fila(cuenta.id)).toEqual(antes);
  });

  it('usuario inexistente', async () => {
    await expect(
      s.modificarUsuario(admin, {
        actorId: actor.id,
        usuarioId: INEXISTENTE,
        cambios: { nombre: 'X' },
      }),
    ).rejects.toBeInstanceOf(s.UsuarioInexistenteError);
    await expect(
      s.modificarUsuario(admin, {
        actorId: actor.id,
        usuarioId: INEXISTENTE,
        cambios: { rol: 'CONSULTA' },
      }),
    ).rejects.toBeInstanceOf(s.UsuarioInexistenteError);
  });
});

describe.skipIf(url === undefined)('cambiarEstadoDeUsuario', () => {
  it('desactivar: revoca todas las sesiones, impide entrar y la cuenta sigue en la base y en el listado', async () => {
    const cuenta = await cuentas.crear({ nombre: `Baja ${MARCA}` });
    const tokens = [
      (await login(cuenta.email)).sesion.token,
      (await login(cuenta.email)).sesion.token,
    ];

    const resultado = await s.cambiarEstadoDeUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      activo: false,
    });

    expect(resultado).toMatchObject({
      cambio: true,
      sesionesRevocadas: 2,
      usuario: { activo: false },
    });
    for (const token of tokens) expect((await sesiones.validarSesion(token)).valida).toBe(false);
    await expect(login(cuenta.email)).rejects.toMatchObject({ motivoInterno: 'inactiva' });
    expect(await vigentes(cuenta.id)).toHaveLength(0);
    expect(await fila(cuenta.id)).toMatchObject({ activo: false });
    expect((await s.listarUsuarios(admin, { busqueda: `Baja ${MARCA}` })).length).toBe(0);
    expect(
      (await s.listarUsuarios(admin, { busqueda: `Baja ${MARCA}`, incluirDesactivados: true })).map(
        (u) => u.id,
      ),
    ).toEqual([cuenta.id]);
    expect(eventos.administrativos()).toEqual([
      expect.objectContaining({
        evento: 'usuarios.desactivado',
        actorId: actor.id,
        usuarioId: cuenta.id,
        sesionesRevocadas: 2,
      }),
    ]);
  });

  it('reactivar: se vuelve a entrar con la misma contraseña; no revive sesiones ni cambia rol, hash ni cambio obligatorio', async () => {
    const cuenta = await cuentas.crear({ rol: 'CONSULTA', debeCambiarPassword: true });
    const vieja = (await login(cuenta.email)).sesion.token;
    await s.cambiarEstadoDeUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      activo: false,
    });
    const desactivada = await fila(cuenta.id);
    eventos.soltar();
    eventos = capturarEventos();

    const resultado = await s.cambiarEstadoDeUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      activo: true,
    });

    expect(resultado).toMatchObject({ cambio: true, sesionesRevocadas: 0 });
    const reactivada = await fila(cuenta.id);
    expect(reactivada).toMatchObject({
      activo: true,
      rol: 'CONSULTA',
      debeCambiarPassword: true,
      passwordHash: desactivada.passwordHash,
      passwordActualizadaEn: desactivada.passwordActualizadaEn,
    });
    expect(await prisma.sesion.count({ where: { usuarioId: cuenta.id, revocadaEn: null } })).toBe(
      0,
    );
    expect((await sesiones.validarSesion(vieja)).valida).toBe(false);
    const entrada = await login(cuenta.email);
    expect(entrada.usuario.debeCambiarPassword).toBe(true);
    expect(eventos.administrativos()).toEqual([
      expect.objectContaining({
        evento: 'usuarios.reactivado',
        actorId: actor.id,
        usuarioId: cuenta.id,
      }),
    ]);
  });

  it('repetir la operación no es un error: cambio false, sin escribir, sin revocar, sin eventos', async () => {
    const inactiva = await cuentas.crear({ activo: false });
    const antesInactiva = await fila(inactiva.id);
    const activa = await cuentas.crear();
    const { sesion } = await login(activa.email);
    const antesActiva = await fila(activa.id);

    expect(
      await s.cambiarEstadoDeUsuario(admin, {
        actorId: actor.id,
        usuarioId: inactiva.id,
        activo: false,
      }),
    ).toMatchObject({ cambio: false, sesionesRevocadas: 0 });
    expect(
      await s.cambiarEstadoDeUsuario(admin, {
        actorId: actor.id,
        usuarioId: activa.id,
        activo: true,
      }),
    ).toMatchObject({ cambio: false, sesionesRevocadas: 0 });

    expect((await fila(inactiva.id)).updatedAt).toEqual(antesInactiva.updatedAt);
    expect((await fila(activa.id)).updatedAt).toEqual(antesActiva.updatedAt);
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);
    expect(eventos.administrativos()).toEqual([]);
  });

  it('nadie se desactiva a sí mismo', async () => {
    const propio = await cuentas.crear({ rol: 'ADMINISTRADOR' });
    const { sesion } = await login(propio.email);
    await expect(
      s.cambiarEstadoDeUsuario(admin, { actorId: propio.id, usuarioId: propio.id, activo: false }),
    ).rejects.toEqual(new s.OperacionSobreCuentaPropiaError('desactivar'));
    expect(await fila(propio.id)).toMatchObject({ activo: true });
    expect((await sesiones.validarSesion(sesion.token)).valida).toBe(true);
  });

  it('usuario inexistente', async () => {
    for (const activo of [true, false]) {
      await expect(
        s.cambiarEstadoDeUsuario(admin, { actorId: actor.id, usuarioId: INEXISTENTE, activo }),
      ).rejects.toBeInstanceOf(s.UsuarioInexistenteError);
    }
  });
});

describe.skipIf(url === undefined)('restablecerContrasena', () => {
  it('nueva temporal: hash nuevo, la anterior deja de servir, cambio obligatorio y sesiones revocadas', async () => {
    const cuenta = await cuentas.crear({ rol: 'CONSULTA', nombre: `Restablecer ${MARCA}` });
    const tokens = [
      (await login(cuenta.email)).sesion.token,
      (await login(cuenta.email)).sesion.token,
    ];
    const antes = await fila(cuenta.id);
    const ahora = new Date(Date.now() + 1000);

    const { usuario, contrasenaTemporal, sesionesRevocadas } = await s.restablecerContrasena(
      admin,
      { actorId: actor.id, usuarioId: cuenta.id },
      ahora,
    );

    expect(Object.keys(usuario).sort()).toEqual(CLAVES);
    expect(sesionesRevocadas).toBe(2);
    expect(evaluarContrasenaNueva(contrasenaTemporal, usuario)).toEqual({ aceptada: true });
    const despues = await fila(cuenta.id);
    expect(despues.passwordHash).not.toBe(antes.passwordHash);
    expect(despues.passwordHash).toMatch(/^\$argon2id\$/);
    expect(despues).toMatchObject({
      debeCambiarPassword: true,
      passwordActualizadaEn: ahora,
      nombre: antes.nombre,
      email: antes.email,
      rol: 'CONSULTA',
      activo: true,
    });
    for (const token of tokens) expect((await sesiones.validarSesion(token)).valida).toBe(false);
    await expect(login(cuenta.email)).rejects.toMatchObject({ motivoInterno: 'credenciales' });
    expect((await login(cuenta.email, contrasenaTemporal)).usuario.debeCambiarPassword).toBe(true);

    expect(eventos.administrativos()).toEqual([
      {
        fecha: expect.any(String) as unknown,
        evento: 'auth.password.restablecida',
        actorId: actor.id,
        usuarioId: cuenta.id,
        sesionesRevocadas: 2,
      },
    ]);
    expect(eventos.lineas().join('')).not.toContain(contrasenaTemporal);
  });

  it('una cuenta desactivada se restablece y sigue desactivada hasta reactivarla', async () => {
    const cuenta = await cuentas.crear({ activo: false });
    const { contrasenaTemporal } = await s.restablecerContrasena(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
    });
    expect(await fila(cuenta.id)).toMatchObject({ activo: false, debeCambiarPassword: true });
    await expect(login(cuenta.email, contrasenaTemporal)).rejects.toMatchObject({
      motivoInterno: 'inactiva',
    });

    await s.cambiarEstadoDeUsuario(admin, {
      actorId: actor.id,
      usuarioId: cuenta.id,
      activo: true,
    });
    expect((await login(cuenta.email, contrasenaTemporal)).usuario.debeCambiarPassword).toBe(true);
  });

  it('no restablece la propia contraseña (para eso está el cambio voluntario)', async () => {
    const antes = await fila(actor.id);
    await expect(
      s.restablecerContrasena(admin, { actorId: actor.id, usuarioId: actor.id }),
    ).rejects.toEqual(new s.OperacionSobreCuentaPropiaError('restablecer-password'));
    expect(await fila(actor.id)).toEqual(antes);
  });

  it('usuario inexistente', async () => {
    await expect(
      s.restablecerContrasena(admin, { actorId: actor.id, usuarioId: INEXISTENTE }),
    ).rejects.toBeInstanceOf(s.UsuarioInexistenteError);
  });

  it('dos restablecimientos simultáneos: vale solo uno de los dos y no queda ninguna sesión', async () => {
    const cuenta = await cuentas.crear();
    await login(cuenta.email);
    const otra = await conexionVerificada(url ?? '');
    try {
      const [a, b] = await Promise.all([
        s.restablecerContrasena(admin, { actorId: actor.id, usuarioId: cuenta.id }),
        s.restablecerContrasena(otra, { actorId: actor.id, usuarioId: cuenta.id }),
      ]);
      const { passwordHash } = await fila(cuenta.id);
      const validas = [
        await verificarContrasena(passwordHash, a.contrasenaTemporal),
        await verificarContrasena(passwordHash, b.contrasenaTemporal),
      ];
      expect(validas.filter(Boolean)).toHaveLength(1);
      expect(await vigentes(cuenta.id)).toHaveLength(0);
      expect(await verificarContrasena(passwordHash, PASSWORD)).toBe(false);
    } finally {
      await otra.$disconnect();
    }
  });
});

describe.skipIf(url === undefined)('PostgreSQL no disponible', () => {
  it('cada operación lanza BaseDeDatosNoDisponibleError, sin detalles y sin eventos', async () => {
    const caida = new PrismaClient({
      datasourceUrl: 'postgresql://nadie:nada@127.0.0.1:1/realpolitik_caida_test?connect_timeout=2',
      log: [],
    });
    const cuenta = await cuentas.crear();
    try {
      const operaciones = [
        () => s.listarUsuarios(caida),
        () =>
          s.crearUsuario(caida, {
            actorId: actor.id,
            datos: { nombre: 'X', email: cuentas.email('caida'), rol: 'CONSULTA' },
          }),
        () =>
          s.modificarUsuario(caida, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            cambios: { nombre: 'X' },
          }),
        () =>
          s.cambiarEstadoDeUsuario(caida, {
            actorId: actor.id,
            usuarioId: cuenta.id,
            activo: false,
          }),
        () => s.restablecerContrasena(caida, { actorId: actor.id, usuarioId: cuenta.id }),
      ];
      for (const operacion of operaciones) {
        const error = await operacion().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BaseDeDatosNoDisponibleError);
        expect(String((error as Error).message)).not.toMatch(/127\.0\.0\.1|nadie|5432|:1/);
        // Nunca se confunde con un usuario inexistente.
        expect(error).not.toBeInstanceOf(s.UsuarioInexistenteError);
      }
      expect(eventos.administrativos()).toEqual([]);
      expect(await fila(cuenta.id)).toMatchObject({ activo: true, nombre: cuenta.nombre });
    } finally {
      await caida.$disconnect();
    }
    // En Windows cada conexión rechazada tarda un par de segundos (reintentos del sistema).
  }, 60_000);
});
