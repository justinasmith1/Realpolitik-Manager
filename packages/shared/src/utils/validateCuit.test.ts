import { describe, expect, it } from 'vitest';

import { validateCuit } from './validateCuit.js';

// ─── CUITs calculados y verificados con el algoritmo Módulo 11 ────────────────
//
// Tabla de CUITs verificados usados en el suite:
//   30-50001274-5  → ✅ persona jurídica
//   20-12345678-6  → ✅ persona física masculina (prefijo 20)
//   27-18005827-9  → ✅ persona física femenina  (prefijo 27)
//   23-25624146-3  → ✅ prefijo 23
//   33-70308853-3  → ✅ prefijo 33

describe('validateCuit — Algoritmo Módulo 11', () => {
  // ── Casos válidos ────────────────────────────────────────────────────────────
  describe('CUITs válidos', () => {
    it('acepta CUIT de persona jurídica sin guiones (30-50001274-5)', () => {
      expect(validateCuit('30500012745')).toBe(true);
    });

    it('acepta CUIT de persona jurídica con guiones (30-50001274-5)', () => {
      expect(validateCuit('30-50001274-5')).toBe(true);
    });

    it('acepta CUIT de persona física masculina — prefijo 20 (20-12345678-6)', () => {
      expect(validateCuit('20-12345678-6')).toBe(true);
    });

    it('acepta CUIT de persona física femenina — prefijo 27 (27-18005827-9)', () => {
      expect(validateCuit('27-18005827-9')).toBe(true);
    });

    it('acepta CUIT con prefijo 23 (23-25624146-3)', () => {
      expect(validateCuit('23-25624146-3')).toBe(true);
    });

    it('acepta CUIT con prefijo 33 (33-70308853-3)', () => {
      expect(validateCuit('33-70308853-3')).toBe(true);
    });

    it('acepta CUIT con espacios en lugar de guiones (normalización)', () => {
      expect(validateCuit('30 50001274 5')).toBe(true);
    });
  });

  // ── Casos inválidos — dígito verificador incorrecto ──────────────────────────
  describe('CUITs con dígito verificador incorrecto', () => {
    it('rechaza CUIT válido con último dígito incrementado en 1', () => {
      // 30-50001274-5 es válido → cambiar el verificador a 6 lo invalida
      expect(validateCuit('30500012746')).toBe(false);
    });

    it('rechaza CUIT válido con último dígito decrementado en 1', () => {
      // 20-12345678-6 es válido → cambiar el verificador a 5 lo invalida
      expect(validateCuit('20123456785')).toBe(false);
    });

    it('rechaza CUIT donde el verificador difiere del calculado', () => {
      // 27-18005827-9 es válido → cambiar el verificador a 0 lo invalida
      expect(validateCuit('27180058270')).toBe(false);
    });
  });

  // ── Casos inválidos — formato incorrecto ─────────────────────────────────────
  describe('CUITs con formato incorrecto', () => {
    it('rechaza string vacío', () => {
      expect(validateCuit('')).toBe(false);
    });

    it('rechaza CUIT con menos de 11 dígitos', () => {
      expect(validateCuit('3050001274')).toBe(false);
    });

    it('rechaza CUIT con más de 11 dígitos', () => {
      expect(validateCuit('305000127450')).toBe(false);
    });

    it('rechaza CUIT con letras', () => {
      expect(validateCuit('30-5000127A-5')).toBe(false);
    });

    it('rechaza CUIT con caracteres especiales no permitidos', () => {
      expect(validateCuit('30/50001274/5')).toBe(false);
    });
  });

  // ── Casos inválidos — prefijo no reconocido ──────────────────────────────────
  describe('CUITs con prefijo inválido', () => {
    it('rechaza CUIT con prefijo 11 (no existe en AFIP)', () => {
      // Con prefijo 11 el validador debe rechazar aunque el dígito fuera correcto
      expect(validateCuit('11500012745')).toBe(false);
    });

    it('rechaza CUIT con prefijo 99 (no existe en AFIP)', () => {
      expect(validateCuit('99000000000')).toBe(false);
    });

    it('rechaza CUIT con prefijo 00', () => {
      expect(validateCuit('00000000000')).toBe(false);
    });
  });
});
