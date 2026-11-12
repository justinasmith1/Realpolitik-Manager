import { describe, expect, it } from 'vitest';

import {
  CambiarContrasenaSchema,
  CONTRASENA_LARGO_MAXIMO,
  CONTRASENA_LARGO_MINIMO,
  contarCaracteresDeContrasena,
  ContrasenaNuevaSchema,
  esUnicodeBienFormado,
  IniciarSesionSchema,
  MENSAJE_CONTRASENA_CARACTERES,
  MENSAJE_CONTRASENA_CORTA,
  MENSAJE_CONTRASENA_LARGA,
  MENSAJE_CONTRASENA_REPETIDA,
  SesionActualSchema,
} from './usuario.schema.js';

/** Mensajes de error del schema (vacío si la contraseña pasa). */
function problemas(contrasena: unknown): string[] {
  const resultado = ContrasenaNuevaSchema.safeParse(contrasena);
  return resultado.success ? [] : resultado.error.issues.map((issue) => issue.message);
}

describe('contarCaracteresDeContrasena', () => {
  it.each([
    ['ASCII', 'abc', 3],
    ['espacios (se cuentan, no se recortan)', '  a  ', 5],
    ['"é" compuesta', 'é'.normalize('NFC'), 1],
    ['"é" descompuesta: cuenta igual que la compuesta (NFC)', 'é'.normalize('NFD'), 1],
    ['un emoji de dos unidades UTF-16', '🔑', 1],
    ['ñ y acentos', 'ñandú', 5],
    ['un emoji compuesto (bandera): dos puntos de código', '🇦🇷', 2],
  ])('%s', (_caso, texto, esperado) => {
    expect(contarCaracteresDeContrasena(texto)).toBe(esperado);
  });
});

describe('esUnicodeBienFormado', () => {
  it('acepta texto con emojis completos', () => {
    expect(esUnicodeBienFormado('clave 🔑 completa')).toBe(true);
  });

  it.each([
    ['un sustituto alto suelto', 'a\uD83D'],
    ['un sustituto bajo suelto', '\uDD11b'],
  ])('rechaza %s', (_caso, texto) => {
    expect(esUnicodeBienFormado(texto)).toBe(false);
  });
});

describe('ContrasenaNuevaSchema', () => {
  const minima = 'a'.repeat(CONTRASENA_LARGO_MINIMO - 5) + 'bcdef';

  describe('largo (puntos de código después de NFC)', () => {
    it(`acepta exactamente ${CONTRASENA_LARGO_MINIMO} y ${CONTRASENA_LARGO_MAXIMO} caracteres`, () => {
      expect(problemas(minima)).toEqual([]);
      expect(problemas('x'.repeat(CONTRASENA_LARGO_MAXIMO))).toEqual([]);
    });

    it(`rechaza ${CONTRASENA_LARGO_MINIMO - 1} y ${CONTRASENA_LARGO_MAXIMO + 1}`, () => {
      expect(problemas(minima.slice(1))).toEqual([MENSAJE_CONTRASENA_CORTA]);
      expect(problemas('x'.repeat(CONTRASENA_LARGO_MAXIMO + 1))).toEqual([
        MENSAJE_CONTRASENA_LARGA,
      ]);
    });

    it('rechaza la contraseña vacía', () => {
      expect(problemas('')).toEqual([MENSAJE_CONTRASENA_CORTA]);
    });

    it('cuenta un emoji como un carácter: 14 emojis no alcanzan, 15 sí', () => {
      expect(problemas('🔑'.repeat(CONTRASENA_LARGO_MINIMO - 1))).toEqual([
        MENSAJE_CONTRASENA_CORTA,
      ]);
      expect(problemas('🔑'.repeat(CONTRASENA_LARGO_MINIMO))).toEqual([]);
    });

    it('cuenta después de NFC: 15 "é" descompuestas (30 unidades) valen 15', () => {
      const descompuesta = 'é'.normalize('NFD').repeat(CONTRASENA_LARGO_MINIMO);
      expect(descompuesta).toHaveLength(CONTRASENA_LARGO_MINIMO * 2);

      expect(problemas(descompuesta)).toEqual([]);
      expect(problemas('é'.normalize('NFD').repeat(CONTRASENA_LARGO_MAXIMO + 1))).toEqual([
        MENSAJE_CONTRASENA_LARGA,
      ]);
    });

    it('cuenta los espacios: no recorta los bordes', () => {
      const conEspacios = `  ${'a'.repeat(CONTRASENA_LARGO_MINIMO - 4)}  `;
      expect(contarCaracteresDeContrasena(conEspacios)).toBe(CONTRASENA_LARGO_MINIMO);

      expect(problemas(conEspacios)).toEqual([]);
    });
  });

  describe('caracteres', () => {
    it.each([
      ['espacios internos (una frase)', 'mi perro come manzanas verdes'],
      ['acentos y eñes', 'canción de la ñandú dorada'],
      ['emojis', 'llave 🔑 de la casa 🏠 vieja'],
      ['símbolos y otros alfabetos', 'Ω≈ç√∫ πρόσβαση 密码 كلمة'],
      ['sin mayúsculas, números ni símbolos', 'todas en minuscula sin nada'],
    ])('acepta %s', (_caso, contrasena) => {
      expect(problemas(contrasena)).toEqual([]);
    });

    it.each([
      ['un salto de línea', `${'a'.repeat(15)}\n`],
      ['una tabulación', `${'a'.repeat(15)}\t`],
      ['un NUL', `${'a'.repeat(15)}\u0000`],
      ['un carácter de control C1', `${'a'.repeat(15)}\u0085`],
      ['un sustituto UTF-16 suelto', `${'a'.repeat(15)}\uD83D`],
    ])('rechaza %s', (_caso, contrasena) => {
      expect(problemas(contrasena)).toEqual([MENSAJE_CONTRASENA_CARACTERES]);
    });

    it('rechaza un valor que no es texto', () => {
      expect(problemas(123456789012345)).toHaveLength(1);
      expect(problemas(undefined)).toHaveLength(1);
    });
  });

  it('no transforma la contraseña: devuelve exactamente lo recibido', () => {
    const contrasena = `  ${'é'.normalize('NFD')} frase con espacios  `;

    expect(ContrasenaNuevaSchema.parse(contrasena)).toBe(contrasena);
  });

  it('ningún mensaje incluye la contraseña', () => {
    const secreta = 'secreta-ficticia';
    for (const valor of [secreta.slice(0, 10), `${secreta}\n`, secreta.repeat(20)]) {
      for (const mensaje of problemas(valor)) expect(mensaje).not.toContain('secreta');
    }
  });
});

describe('IniciarSesionSchema', () => {
  it('normaliza el email y deja la contraseña exactamente como llegó', () => {
    expect(
      IniciarSesionSchema.parse({
        email: '  Persona@Ejemplo.EXAMPLE ',
        password: '  con espacios  ',
      }),
    ).toEqual({
      email: 'persona@ejemplo.example',
      password: '  con espacios  ',
    });
  });

  it('no aplica la política de contraseñas nuevas: una corta o común se puede verificar', () => {
    expect(
      IniciarSesionSchema.safeParse({ email: 'a@ejemplo.example', password: '1234' }).success,
    ).toBe(true);
  });

  it.each([
    ['sin contraseña', { email: 'a@ejemplo.example' }],
    ['con la contraseña vacía', { email: 'a@ejemplo.example', password: '' }],
    [
      'con más de 128 caracteres',
      { email: 'a@ejemplo.example', password: 'x'.repeat(CONTRASENA_LARGO_MAXIMO + 1) },
    ],
    ['con un email inválido', { email: 'no-es-email', password: 'x' }],
  ])('rechaza un pedido %s', (_caso, cuerpo) => {
    expect(IniciarSesionSchema.safeParse(cuerpo).success).toBe(false);
  });

  it('descarta campos que no son del contrato (rol, flags internos)', () => {
    expect(
      IniciarSesionSchema.parse({
        email: 'a@ejemplo.example',
        password: 'x',
        rol: 'ADMINISTRADOR',
        debeCambiarPassword: false,
      }),
    ).toEqual({ email: 'a@ejemplo.example', password: 'x' });
  });
});

describe('CambiarContrasenaSchema', () => {
  const ACTUAL = 'temporal';
  const NUEVA = 'una frase nueva y larga';
  /** Campo y mensaje de cada problema (vacío si el cuerpo pasa). */
  const errores = (cuerpo: unknown) => {
    const resultado = CambiarContrasenaSchema.safeParse(cuerpo);
    return resultado.success
      ? []
      : resultado.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };

  it('acepta una actual cualquiera (temporal, corta) y una nueva que cumple la política', () => {
    expect(CambiarContrasenaSchema.parse({ actual: ACTUAL, nueva: NUEVA })).toEqual({
      actual: ACTUAL,
      nueva: NUEVA,
    });
  });

  it('no recorta ninguna de las dos', () => {
    expect(CambiarContrasenaSchema.parse({ actual: ' a ', nueva: `  ${NUEVA}  ` })).toEqual({
      actual: ' a ',
      nueva: `  ${NUEVA}  `,
    });
  });

  it.each([
    ['sin la actual', { nueva: NUEVA }, 'actual'],
    ['con la actual vacía', { actual: '', nueva: NUEVA }, 'actual'],
    [
      'con la actual de más de 128',
      { actual: 'x'.repeat(CONTRASENA_LARGO_MAXIMO + 1), nueva: NUEVA },
      'actual',
    ],
    ['sin la nueva', { actual: ACTUAL }, 'nueva'],
    ['con la nueva corta', { actual: ACTUAL, nueva: 'corta' }, 'nueva'],
    [
      'con la nueva de más de 128',
      { actual: ACTUAL, nueva: 'x'.repeat(CONTRASENA_LARGO_MAXIMO + 1) },
      'nueva',
    ],
    ['con un salto de línea en la nueva', { actual: ACTUAL, nueva: `${NUEVA}\n` }, 'nueva'],
  ])('rechaza un pedido %s (campo %s)', (_caso, cuerpo, campo) => {
    expect(errores(cuerpo).map(([c]) => c)).toEqual([campo]);
  });

  it('rechaza la misma contraseña como nueva, también en otra forma Unicode equivalente', () => {
    const conAcento = 'una frase con acentuación';
    expect(errores({ actual: conAcento, nueva: conAcento })).toEqual([
      ['nueva', MENSAJE_CONTRASENA_REPETIDA],
    ]);
    expect(
      errores({ actual: conAcento.normalize('NFD'), nueva: conAcento.normalize('NFC') }),
    ).toEqual([['nueva', MENSAJE_CONTRASENA_REPETIDA]]);
  });

  it('descarta campos que no son del contrato (el indicador de primer acceso no se modifica desde afuera)', () => {
    expect(
      CambiarContrasenaSchema.parse({ actual: ACTUAL, nueva: NUEVA, debeCambiarPassword: false }),
    ).toEqual({ actual: ACTUAL, nueva: NUEVA });
  });
});

describe('SesionActualSchema', () => {
  it('solo admite los datos públicos del usuario', () => {
    const usuario = {
      id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
      email: 'a@ejemplo.example',
      nombre: 'Persona',
      rol: 'CONSULTA',
      debeCambiarPassword: true,
    };

    expect(SesionActualSchema.parse({ usuario: { ...usuario, passwordHash: 'x' } })).toEqual({
      usuario,
    });
  });
});
