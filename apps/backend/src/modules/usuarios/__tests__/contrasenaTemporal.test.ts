import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { CONTRASENA_LARGO_MAXIMO } from '@realpolitik/shared';
import { describe, expect, it, vi } from 'vitest';

import { evaluarContrasenaNueva } from '../../auth/politicaDeContrasenas';
import {
  BYTES_DE_CONTRASENA_TEMPORAL,
  ContrasenaTemporalNoGeneradaError,
  generarContrasenaTemporal,
} from '../contrasenaTemporal';

const CONTEXTO = { email: 'ana.perez@ejemplo.example', nombre: 'Ana Pérez' };

/** 0x69 0xa6 0x9a en base64 es "aaaa": 24 bytes así dan 32 "a" (una repetición trivial). */
const bytesQueDanSoloA = () =>
  Buffer.from(Array.from({ length: 24 }, (_, i) => [0x69, 0xa6, 0x9a][i % 3] ?? 0));

describe('generarContrasenaTemporal', () => {
  it('usa 24 bytes del CSPRNG: 32 caracteres base64url (192 bits)', () => {
    expect(BYTES_DE_CONTRASENA_TEMPORAL).toBeGreaterThanOrEqual(24);
    const contrasena = generarContrasenaTemporal(CONTEXTO);
    expect(contrasena).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(contrasena.length).toBeLessThanOrEqual(CONTRASENA_LARGO_MAXIMO);
  });

  it('cumple la política de contraseñas nuevas con el contexto de la cuenta', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(evaluarContrasenaNueva(generarContrasenaTemporal(CONTEXTO), CONTEXTO)).toEqual({
        aceptada: true,
      });
    }
  });

  it('no se repite con el mismo contexto y el reloj detenido', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
      const generadas = new Set(
        Array.from({ length: 500 }, () => generarContrasenaTemporal(CONTEXTO)),
      );
      expect(generadas.size).toBe(500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('el contexto solo se usa para evaluarla: con la misma fuente, el resultado no cambia', () => {
    const bytes = randomBytes(BYTES_DE_CONTRASENA_TEMPORAL);
    expect(generarContrasenaTemporal(CONTEXTO, () => bytes)).toBe(
      generarContrasenaTemporal({ email: 'otra@ejemplo.example', nombre: 'Otra' }, () => bytes),
    );
  });

  it('descarta una generada que la política rechazaría y genera otra', () => {
    const rechazada = bytesQueDanSoloA();
    expect(rechazada.toString('base64url')).toBe('a'.repeat(32));
    const fuente = vi.fn().mockReturnValueOnce(rechazada).mockImplementation(randomBytes);

    const contrasena = generarContrasenaTemporal(CONTEXTO, fuente);

    expect(contrasena).not.toBe('a'.repeat(32));
    expect(fuente).toHaveBeenCalledTimes(2);
    expect(fuente).toHaveBeenCalledWith(BYTES_DE_CONTRASENA_TEMPORAL);
  });

  it('se rinde con un error sin la contraseña si la política rechaza todas', () => {
    const rechazada = bytesQueDanSoloA();
    let error: unknown;
    try {
      generarContrasenaTemporal(CONTEXTO, () => rechazada);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContrasenaTemporalNoGeneradaError);
    expect(String((error as Error).message)).not.toContain('aaaa');
  });

  it('no usa Math.random ni la hora: el código solo lee crypto.randomBytes', () => {
    const fuente = readFileSync(new URL('../contrasenaTemporal.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/Math\.random|Date\.now|new Date/);
    expect(fuente).toMatch(/import \{ randomBytes \} from 'node:crypto'/);
  });
});
