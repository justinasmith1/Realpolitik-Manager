import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  generarTokenDeSesion,
  hashDeTokenDeSesion,
  tieneFormatoDeTokenDeSesion,
} from '../tokenDeSesion';

describe('token de sesión', () => {
  it('es base64url de 32 bytes (43 caracteres, 256 bits)', () => {
    const { token } = generarTokenDeSesion();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('no se repite', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generarTokenDeSesion().token));

    expect(tokens.size).toBe(2000);
  });

  it('lo que se guarda es el SHA-256 en hexadecimal del token, no el token', () => {
    const { token, tokenHash } = generarTokenDeSesion();

    // Calculado aparte, sin pasar por el módulo.
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).not.toBe(Buffer.from(token, 'base64url').toString('hex'));
  });

  it('el hash es determinista: el token de la cookie encuentra la misma sesión', () => {
    const { token, tokenHash } = generarTokenDeSesion();

    expect(hashDeTokenDeSesion(token)).toBe(tokenHash);
  });

  it('tokens distintos tienen hashes distintos', () => {
    const a = generarTokenDeSesion();
    const b = generarTokenDeSesion();

    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  describe('tieneFormatoDeTokenDeSesion', () => {
    it('acepta un token generado', () => {
      expect(tieneFormatoDeTokenDeSesion(generarTokenDeSesion().token)).toBe(true);
    });

    it.each([
      ['vacío', ''],
      ['corto', 'a'.repeat(42)],
      ['largo', 'a'.repeat(44)],
      ['con relleno base64', `${'a'.repeat(42)}=`],
      ['con caracteres de base64 estándar', `${'a'.repeat(42)}+`],
      ['un hash guardado', 'a'.repeat(64)],
      ['no string', 123],
      ['undefined', undefined],
    ])('rechaza %s', (_caso, valor) => {
      expect(tieneFormatoDeTokenDeSesion(valor)).toBe(false);
    });
  });
});
