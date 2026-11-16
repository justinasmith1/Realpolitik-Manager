import {
  MENSAJE_EMAIL_USUARIO_VACIO as MENSAJE_EMAIL_VACIO,
  MENSAJE_NOMBRE_USUARIO_CARACTERES as MENSAJE_NOMBRE_CARACTERES,
  MENSAJE_NOMBRE_USUARIO_LARGO as MENSAJE_NOMBRE_LARGO,
  MENSAJE_NOMBRE_USUARIO_VACIO as MENSAJE_NOMBRE_VACIO,
  MENSAJE_ROL_INVALIDO,
  NOMBRE_USUARIO_MAX as NOMBRE_DE_USUARIO_MAXIMO,
} from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

import {
  MENSAJE_CAMPO_NO_MODIFICABLE,
  MENSAJE_SIN_CAMBIOS,
  validarCambiosDeUsuario,
  validarFiltrosDeUsuarios,
  validarUsuarioNuevo,
} from '../validacionDeUsuarios';

const valido = { nombre: 'Ana Pérez', email: 'ana@ejemplo.example', rol: 'ADMINISTRATIVO' };

const erroresDe = (resultado: ReturnType<typeof validarUsuarioNuevo>) =>
  resultado.ok ? [] : resultado.errores;

describe('validarUsuarioNuevo: nombre', () => {
  it('es obligatorio: vacío, solo espacios o ausente', () => {
    for (const nombre of ['', '   ', undefined, 42]) {
      expect(erroresDe(validarUsuarioNuevo({ ...valido, nombre }))).toEqual([
        { campo: 'nombre', mensaje: MENSAJE_NOMBRE_VACIO },
      ]);
    }
  });

  it('recorta los espacios exteriores y conserva los interiores', () => {
    const resultado = validarUsuarioNuevo({ ...valido, nombre: '  Ana   María  ' });
    expect(resultado).toEqual({
      ok: true,
      datos: { ...valido, nombre: 'Ana   María' },
    });
  });

  it(`acepta hasta ${NOMBRE_DE_USUARIO_MAXIMO} caracteres (puntos de código, después de recortar)`, () => {
    const justo = 'á'.repeat(NOMBRE_DE_USUARIO_MAXIMO);
    expect(validarUsuarioNuevo({ ...valido, nombre: ` ${justo} ` }).ok).toBe(true);
    // Un emoji ocupa dos unidades UTF-16 pero es un solo carácter, como lo cuenta PostgreSQL.
    expect(
      validarUsuarioNuevo({ ...valido, nombre: '🔑'.repeat(NOMBRE_DE_USUARIO_MAXIMO) }).ok,
    ).toBe(true);
  });

  it('rechaza uno más largo', () => {
    expect(
      erroresDe(
        validarUsuarioNuevo({ ...valido, nombre: 'a'.repeat(NOMBRE_DE_USUARIO_MAXIMO + 1) }),
      ),
    ).toEqual([{ campo: 'nombre', mensaje: MENSAJE_NOMBRE_LARGO }]);
  });

  it('rechaza caracteres de control y texto Unicode mal formado, sin repetir el valor', () => {
    for (const nombre of [
      'Ana\u0000',
      'Ana\nPérez',
      'Ana\tPérez',
      'Ana\u007f',
      'Ana\u0085',
      'Ana\ud83d',
    ]) {
      const errores = erroresDe(validarUsuarioNuevo({ ...valido, nombre }));
      expect(errores).toEqual([{ campo: 'nombre', mensaje: MENSAJE_NOMBRE_CARACTERES }]);
    }
  });
});

describe('validarUsuarioNuevo: email', () => {
  it('es obligatorio', () => {
    expect(erroresDe(validarUsuarioNuevo({ ...valido, email: undefined }))).toEqual([
      { campo: 'email', mensaje: MENSAJE_EMAIL_VACIO },
    ]);
  });

  it('rechaza un formato inválido', () => {
    for (const email of ['', 'ana', 'ana@', '@ejemplo.example', 'ana @ejemplo.example']) {
      const errores = erroresDe(validarUsuarioNuevo({ ...valido, email }));
      expect(errores).toHaveLength(1);
      expect(errores[0]?.campo).toBe('email');
    }
  });

  it('se normaliza como en el inicio de sesión: sin espacios en los bordes y en minúsculas', () => {
    const resultado = validarUsuarioNuevo({ ...valido, email: '  Ana.Perez@Ejemplo.EXAMPLE ' });
    expect(resultado.ok && resultado.datos.email).toBe('ana.perez@ejemplo.example');
  });
});

describe('validarUsuarioNuevo: rol', () => {
  it('acepta los tres roles', () => {
    for (const rol of ['ADMINISTRADOR', 'ADMINISTRATIVO', 'CONSULTA']) {
      expect(validarUsuarioNuevo({ ...valido, rol }).ok).toBe(true);
    }
  });

  it('rechaza cualquier otro valor, también en minúsculas o ausente', () => {
    for (const rol of ['SUPERADMIN', 'administrador', '', undefined, null]) {
      expect(erroresDe(validarUsuarioNuevo({ ...valido, rol }))).toEqual([
        { campo: 'rol', mensaje: MENSAJE_ROL_INVALIDO },
      ]);
    }
  });
});

describe('validarUsuarioNuevo: varios errores', () => {
  it('informa un error por campo', () => {
    const errores = erroresDe(validarUsuarioNuevo({ nombre: '', email: 'x', rol: 'X' }));
    expect(errores.map((e) => e.campo)).toEqual(['nombre', 'email', 'rol']);
  });

  it('rechaza algo que no es un objeto', () => {
    expect(validarUsuarioNuevo(null).ok).toBe(false);
    expect(validarUsuarioNuevo('ana').ok).toBe(false);
  });
});

describe('validarCambiosDeUsuario', () => {
  it('acepta nombre, rol o ambos', () => {
    expect(validarCambiosDeUsuario({ nombre: ' Ana ' })).toEqual({
      ok: true,
      datos: { nombre: 'Ana' },
    });
    expect(validarCambiosDeUsuario({ rol: 'CONSULTA' })).toEqual({
      ok: true,
      datos: { rol: 'CONSULTA' },
    });
    expect(validarCambiosDeUsuario({ nombre: 'Ana', rol: 'CONSULTA' }).ok).toBe(true);
  });

  it('exige al menos uno', () => {
    expect(validarCambiosDeUsuario({})).toEqual({
      ok: false,
      errores: [{ campo: '', mensaje: MENSAJE_SIN_CAMBIOS }],
    });
  });

  it('no permite modificar el email ni otras propiedades', () => {
    const resultado = validarCambiosDeUsuario({
      nombre: 'Ana',
      email: 'otra@ejemplo.example',
      passwordHash: '$argon2id$...',
      activo: false,
      debeCambiarPassword: false,
      ultimoAccesoEn: null,
    });
    expect(resultado).toEqual({
      ok: false,
      errores: [
        { campo: 'email', mensaje: MENSAJE_CAMPO_NO_MODIFICABLE },
        { campo: 'passwordHash', mensaje: MENSAJE_CAMPO_NO_MODIFICABLE },
        { campo: 'activo', mensaje: MENSAJE_CAMPO_NO_MODIFICABLE },
        { campo: 'debeCambiarPassword', mensaje: MENSAJE_CAMPO_NO_MODIFICABLE },
        { campo: 'ultimoAccesoEn', mensaje: MENSAJE_CAMPO_NO_MODIFICABLE },
      ],
    });
  });

  it('valida el nombre y el rol con las mismas reglas que el alta', () => {
    expect(validarCambiosDeUsuario({ nombre: '  ' }).ok).toBe(false);
    expect(validarCambiosDeUsuario({ rol: 'ROOT' }).ok).toBe(false);
  });
});

describe('validarFiltrosDeUsuarios', () => {
  it('sin filtros: solo activos', () => {
    expect(validarFiltrosDeUsuarios()).toEqual({ ok: true, datos: { incluirDesactivados: false } });
  });

  it('recorta la búsqueda y la omite si queda vacía', () => {
    expect(validarFiltrosDeUsuarios({ busqueda: '  ana ' })).toEqual({
      ok: true,
      datos: { busqueda: 'ana', incluirDesactivados: false },
    });
    expect(validarFiltrosDeUsuarios({ busqueda: '   ' })).toEqual({
      ok: true,
      datos: { incluirDesactivados: false },
    });
  });

  it('rechaza un rol desconocido, una búsqueda con caracteres de control o claves extra', () => {
    expect(validarFiltrosDeUsuarios({ rol: 'ROOT' }).ok).toBe(false);
    expect(validarFiltrosDeUsuarios({ busqueda: 'a\u0000' }).ok).toBe(false);
    expect(validarFiltrosDeUsuarios({ busqueda: 'a'.repeat(151) }).ok).toBe(false);
    expect(validarFiltrosDeUsuarios({ pagina: 2 }).ok).toBe(false);
    expect(validarFiltrosDeUsuarios({ incluirDesactivados: 'true' }).ok).toBe(false);
  });
});
