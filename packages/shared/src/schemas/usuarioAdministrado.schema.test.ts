import { describe, expect, it } from 'vitest';

import {
  ActualizarEstadoUsuarioSchema,
  ActualizarUsuarioSchema,
  CrearUsuarioSchema,
  ListarUsuariosQuerySchema,
  MENSAJE_DATO_NO_PERMITIDO,
  MENSAJE_NOMBRE_USUARIO_CARACTERES,
  MENSAJE_NOMBRE_USUARIO_LARGO,
  MENSAJE_NOMBRE_USUARIO_VACIO,
  MENSAJE_ROL_INVALIDO,
  NOMBRE_USUARIO_MAX,
  RestablecerContrasenaSchema,
  UsuarioAdministradoSchema,
} from './usuario.schema.js';

// Administración de usuarios (HU4.5): forma de los pedidos y de la respuesta.

const errores = (resultado: {
  success: boolean;
  error?: { issues: { path: unknown[]; message: string }[] };
}) =>
  resultado.success
    ? []
    : (resultado.error?.issues ?? []).map((i) => ({ campo: i.path.join('.'), mensaje: i.message }));

const valido = { nombre: 'Ana Pérez', email: 'ana@ejemplo.example', rol: 'CONSULTA' };

describe('CrearUsuarioSchema', () => {
  it('normaliza nombre y email', () => {
    expect(
      CrearUsuarioSchema.parse({ ...valido, nombre: '  Ana  ', email: ' ANA@Ejemplo.example ' }),
    ).toEqual({ nombre: 'Ana', email: 'ana@ejemplo.example', rol: 'CONSULTA' });
  });

  it('nombre: obligatorio, hasta 150 puntos de código, sin caracteres de control', () => {
    expect(errores(CrearUsuarioSchema.safeParse({ ...valido, nombre: ' ' }))).toEqual([
      { campo: 'nombre', mensaje: MENSAJE_NOMBRE_USUARIO_VACIO },
    ]);
    expect(
      CrearUsuarioSchema.safeParse({ ...valido, nombre: '🔑'.repeat(NOMBRE_USUARIO_MAX) }).success,
    ).toBe(true);
    expect(
      errores(
        CrearUsuarioSchema.safeParse({ ...valido, nombre: 'a'.repeat(NOMBRE_USUARIO_MAX + 1) }),
      ),
    ).toEqual([{ campo: 'nombre', mensaje: MENSAJE_NOMBRE_USUARIO_LARGO }]);
    expect(errores(CrearUsuarioSchema.safeParse({ ...valido, nombre: 'A\tB' }))).toEqual([
      { campo: 'nombre', mensaje: MENSAJE_NOMBRE_USUARIO_CARACTERES },
    ]);
  });

  it('rol: solo los tres roles', () => {
    expect(errores(CrearUsuarioSchema.safeParse({ ...valido, rol: 'consulta' }))).toEqual([
      { campo: 'rol', mensaje: MENSAJE_ROL_INVALIDO },
    ]);
  });

  it('una contraseña o un campo interno es un error en esa clave, junto con los demás', () => {
    expect(
      errores(
        CrearUsuarioSchema.safeParse({
          ...valido,
          nombre: '',
          password: 'elegida',
          activo: false,
          debeCambiarPassword: false,
        }),
      ),
    ).toEqual([
      { campo: 'password', mensaje: MENSAJE_DATO_NO_PERMITIDO },
      { campo: 'activo', mensaje: MENSAJE_DATO_NO_PERMITIDO },
      { campo: 'debeCambiarPassword', mensaje: MENSAJE_DATO_NO_PERMITIDO },
      { campo: 'nombre', mensaje: MENSAJE_NOMBRE_USUARIO_VACIO },
    ]);
  });
});

describe('ActualizarUsuarioSchema', () => {
  it('nombre y/o rol, al menos uno', () => {
    expect(ActualizarUsuarioSchema.parse({ rol: 'ADMINISTRATIVO' })).toEqual({
      rol: 'ADMINISTRATIVO',
    });
    expect(ActualizarUsuarioSchema.safeParse({}).success).toBe(false);
  });

  it('el email no se modifica', () => {
    expect(
      errores(ActualizarUsuarioSchema.safeParse({ email: 'otra@ejemplo.example' })),
    ).toContainEqual({
      campo: 'email',
      mensaje: MENSAJE_DATO_NO_PERMITIDO,
    });
  });
});

describe('ActualizarEstadoUsuarioSchema', () => {
  it('activo booleano; ni texto ni número', () => {
    expect(ActualizarEstadoUsuarioSchema.parse({ activo: false })).toEqual({ activo: false });
    for (const activo of ['false', 0, null, undefined]) {
      expect(ActualizarEstadoUsuarioSchema.safeParse({ activo }).success).toBe(false);
    }
  });
});

describe('RestablecerContrasenaSchema', () => {
  it('sin cuerpo o vacío; cualquier clave es un error', () => {
    expect(RestablecerContrasenaSchema.safeParse(undefined).success).toBe(true);
    expect(RestablecerContrasenaSchema.safeParse({}).success).toBe(true);
    expect(errores(RestablecerContrasenaSchema.safeParse({ password: 'x', actorId: 'y' }))).toEqual(
      [
        { campo: 'password', mensaje: MENSAJE_DATO_NO_PERMITIDO },
        { campo: 'actorId', mensaje: MENSAJE_DATO_NO_PERMITIDO },
      ],
    );
  });
});

describe('ListarUsuariosQuerySchema', () => {
  it('sin parámetros: solo activos; q vacío equivale a no enviarlo', () => {
    expect(ListarUsuariosQuerySchema.parse({})).toEqual({ incluirDesactivados: false });
    expect(ListarUsuariosQuerySchema.parse({ q: '  ' })).toEqual({ incluirDesactivados: false });
    expect(
      ListarUsuariosQuerySchema.parse({ q: ' ana ', rol: 'CONSULTA', incluirDesactivados: 'true' }),
    ).toEqual({ q: 'ana', rol: 'CONSULTA', incluirDesactivados: true });
  });

  it('rechaza un booleano ambiguo, un rol desconocido y una búsqueda larga o con control', () => {
    for (const query of [
      { incluirDesactivados: '1' },
      { rol: 'ROOT' },
      { q: 'a'.repeat(151) },
      { q: 'a\u0000' },
      { q: ['a', 'b'] },
    ]) {
      expect(ListarUsuariosQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe('UsuarioAdministradoSchema', () => {
  it('solo los campos públicos: descarta hash o sesiones si aparecieran', () => {
    const usuario = {
      id: '0b0b0b0b-0000-4000-8000-000000000001',
      nombre: 'Ana',
      email: 'ana@ejemplo.example',
      rol: 'CONSULTA',
      activo: true,
      debeCambiarPassword: true,
      ultimoAccesoEn: '2026-11-15T12:00:00.000Z',
    };
    expect(
      UsuarioAdministradoSchema.parse({ ...usuario, passwordHash: 'x', sesiones: [] }),
    ).toEqual({
      ...usuario,
      ultimoAccesoEn: new Date('2026-11-15T12:00:00.000Z'),
    });
    expect(
      UsuarioAdministradoSchema.parse({ ...usuario, ultimoAccesoEn: null }).ultimoAccesoEn,
    ).toBeNull();
  });
});
