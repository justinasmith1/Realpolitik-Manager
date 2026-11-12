// Hash y verificación con la biblioteca `argon2` REAL (sin mocks): lo que se prueba es justamente
// que el formato, los parámetros y la verificación sean los esperados.

import { CONTRASENA_LARGO_MAXIMO } from '@realpolitik/shared';
import { argon2i, hash as hashDirecto } from 'argon2';
import { describe, expect, it } from 'vitest';

import {
  ContrasenaFueraDeRangoError,
  HashDeContrasenaInvalidoError,
  hashearContrasena,
  necesitaRehash,
  PARAMETROS_ARGON2,
  verificarContrasena,
} from '../contrasenas';

const CONTRASENA = 'una frase de prueba ficticia';

/** Parámetros de un PHC de argon2id, sin depender del orden en que la biblioteca los escribe. */
function parametrosDe(hash: string): Record<string, string> {
  const [, algoritmo, version, parametros] = hash.split('$');
  return {
    algoritmo: algoritmo ?? '',
    version: version ?? '',
    ...Object.fromEntries(
      (parametros ?? '').split(',').map((par): [string, string] => {
        const [clave = '', valor = ''] = par.split('=');
        return [clave, valor];
      }),
    ),
  };
}

async function rechazo(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba un rechazo');
}

describe('hashearContrasena', () => {
  it('produce un PHC de argon2id con los parámetros del ADR', async () => {
    const hash = await hashearContrasena(CONTRASENA);

    expect(parametrosDe(hash)).toEqual({
      algoritmo: 'argon2id',
      version: 'v=19',
      m: '19456',
      t: '2',
      p: '1',
    });
  });

  it('no guarda la contraseña: el hash no la contiene', async () => {
    const hash = await hashearContrasena(CONTRASENA);

    expect(hash).not.toContain(CONTRASENA);
    expect(hash).not.toContain(Buffer.from(CONTRASENA).toString('base64').slice(0, 12));
  });

  it('usa una sal nueva cada vez: dos hashes de la misma contraseña difieren y ambos verifican', async () => {
    const [a, b] = await Promise.all([
      hashearContrasena(CONTRASENA),
      hashearContrasena(CONTRASENA),
    ]);

    expect(a).not.toBe(b);
    await expect(verificarContrasena(a, CONTRASENA)).resolves.toBe(true);
    await expect(verificarContrasena(b, CONTRASENA)).resolves.toBe(true);
  });

  it(`acepta exactamente ${CONTRASENA_LARGO_MAXIMO} caracteres, contados en puntos de código`, async () => {
    // Emojis: 2 unidades UTF-16 cada uno, 1 punto de código. 128 emojis son 256 unidades.
    const contrasena = '🔑'.repeat(CONTRASENA_LARGO_MAXIMO);

    const hash = await hashearContrasena(contrasena);

    await expect(verificarContrasena(hash, contrasena)).resolves.toBe(true);
  });

  it.each([
    ['vacía', ''],
    ['más larga que el máximo', 'a'.repeat(CONTRASENA_LARGO_MAXIMO + 1)],
  ])('rechaza una contraseña %s sin calcular el hash', async (_caso, contrasena) => {
    const error = await rechazo(hashearContrasena(contrasena));

    expect(error).toBeInstanceOf(ContrasenaFueraDeRangoError);
    expect((error as Error).message).not.toContain(contrasena || '\u0000');
  });
});

describe('verificarContrasena', () => {
  it('distingue la contraseña correcta de las incorrectas', async () => {
    const hash = await hashearContrasena(CONTRASENA);

    await expect(verificarContrasena(hash, CONTRASENA)).resolves.toBe(true);
    for (const incorrecta of [
      'otra frase de prueba ficticia',
      CONTRASENA.toUpperCase(),
      `${CONTRASENA} `,
      ` ${CONTRASENA}`,
      CONTRASENA.slice(0, -1),
    ]) {
      await expect(verificarContrasena(hash, incorrecta)).resolves.toBe(false);
    }
  });

  it('normaliza a NFC: la misma contraseña compuesta o descompuesta verifica igual', async () => {
    const compuesta = 'contraseña con canción'.normalize('NFC');
    const descompuesta = compuesta.normalize('NFD');
    expect(descompuesta).not.toBe(compuesta);

    const hash = await hashearContrasena(descompuesta);

    await expect(verificarContrasena(hash, compuesta)).resolves.toBe(true);
  });

  it('un sustituto UTF-16 suelto no se hashea ni coincide con U+FFFD (evita colisiones)', async () => {
    // Al pasar a bytes, "\uD83D" suelto se vuelve U+FFFD: sin el chequeo, estas dos verificarían igual.
    const conReemplazo = 'frase de prueba ficticia �';
    const hash = await hashearContrasena(conReemplazo);

    await expect(hashearContrasena('frase de prueba ficticia \uD83D')).rejects.toBeInstanceOf(
      ContrasenaFueraDeRangoError,
    );
    await expect(verificarContrasena(hash, 'frase de prueba ficticia \uD83D')).resolves.toBe(false);
    await expect(verificarContrasena(hash, conReemplazo)).resolves.toBe(true);
  });

  it('admite espacios, acentos y cualquier carácter imprimible', async () => {
    const contrasena = '  mi perro Ñandú come 3 🍎 por día!  ';
    const hash = await hashearContrasena(contrasena);

    await expect(verificarContrasena(hash, contrasena)).resolves.toBe(true);
  });

  it.each([
    ['vacía', ''],
    ['más larga que el máximo', 'b'.repeat(CONTRASENA_LARGO_MAXIMO + 1)],
  ])('devuelve false para una contraseña %s, sin error', async (_caso, contrasena) => {
    const hash = await hashearContrasena(CONTRASENA);

    await expect(verificarContrasena(hash, contrasena)).resolves.toBe(false);
  });

  it('verifica hashes calculados con otros parámetros (cambiarlos no rompe los existentes)', async () => {
    const viejo = await hashDirecto(CONTRASENA, {
      ...PARAMETROS_ARGON2,
      timeCost: 1,
      memoryCost: 12_288,
    });

    await expect(verificarContrasena(viejo, CONTRASENA)).resolves.toBe(true);
    await expect(verificarContrasena(viejo, 'otra')).resolves.toBe(false);
  });

  describe('hash guardado inválido: error de datos, no credencial incorrecta', () => {
    it.each([
      ['vacío', ''],
      ['una contraseña en claro', CONTRASENA],
      ['un hash bcrypt', '$2b$10$abcdefghijklmnopqrstuuJxzZb2mC6t6yQWm8XoUeW9oWJm6Gx1y'],
      ['basura con prefijo argon2id', '$argon2id$v=19$m=19456,t=2,p=1$basura'],
      ['parámetros inválidos', '$argon2id$v=19$m=x,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g'],
    ])('rechaza %s con HashDeContrasenaInvalidoError', async (_caso, hash) => {
      const error = await rechazo(verificarContrasena(hash, CONTRASENA));

      expect(error).toBeInstanceOf(HashDeContrasenaInvalidoError);
      expect((error as Error).message).not.toContain(CONTRASENA);
      if (hash !== '') expect((error as Error).message).not.toContain(hash);
      expect((error as Error).cause).toBeUndefined();
    });

    it('rechaza un PHC válido de argon2i (otra variante)', async () => {
      const hashArgon2i = await hashDirecto(CONTRASENA, { ...PARAMETROS_ARGON2, type: argon2i });

      await expect(verificarContrasena(hashArgon2i, CONTRASENA)).rejects.toBeInstanceOf(
        HashDeContrasenaInvalidoError,
      );
    });

    it('un hash truncado sigue siendo parseable: no verifica', async () => {
      const hash = await hashearContrasena(CONTRASENA);

      await expect(verificarContrasena(hash.slice(0, -6), CONTRASENA)).resolves.toBe(false);
    });
  });
});

describe('necesitaRehash', () => {
  it('es false para un hash con los parámetros actuales', async () => {
    expect(necesitaRehash(await hashearContrasena(CONTRASENA))).toBe(false);
  });

  it('es true para un hash con parámetros anteriores', async () => {
    const viejo = await hashDirecto(CONTRASENA, { ...PARAMETROS_ARGON2, timeCost: 1 });

    expect(necesitaRehash(viejo)).toBe(true);
  });

  it.each([
    ['no argon2id', 'texto'],
    ['mal formado', '$argon2id$basura'],
  ])('rechaza un hash %s', (_caso, hash) => {
    expect(() => necesitaRehash(hash)).toThrow(HashDeContrasenaInvalidoError);
  });
});
