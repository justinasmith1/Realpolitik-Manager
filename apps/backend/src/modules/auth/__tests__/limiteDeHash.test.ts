// El límite del proceso con cálculos REALES de argon2: con 12 verificaciones a la vez, 2 corren, 8
// esperan y 2 se rechazan por capacidad, sin confundirse con una contraseña incorrecta.

import { describe, expect, it } from 'vitest';

import { CapacidadAgotadaError } from '../../../lib/limitadorDeConcurrencia';
import { hashearContrasena, verificarContrasena } from '../contrasenas';
import { limiteDeHash, MAXIMO_HASHES_EN_ESPERA, MAXIMO_HASHES_SIMULTANEOS } from '../limiteDeHash';

describe('limiteDeHash', () => {
  it('son 2 cálculos a la vez y 8 en espera (ADR-0006 §2)', () => {
    expect([MAXIMO_HASHES_SIMULTANEOS, MAXIMO_HASHES_EN_ESPERA]).toEqual([2, 8]);
  });

  it('acota los cálculos reales y distingue saturación de credencial incorrecta', async () => {
    const hash = await hashearContrasena('frase ficticia para el límite');
    const capacidad = MAXIMO_HASHES_SIMULTANEOS + MAXIMO_HASHES_EN_ESPERA;

    const intentos = Array.from({ length: capacidad + 2 }, (_, i) =>
      limiteDeHash
        .ejecutar(() =>
          verificarContrasena(hash, i % 2 === 0 ? 'frase ficticia para el límite' : 'otra'),
        )
        .then(
          (coincide) => (coincide ? 'correcta' : 'incorrecta'),
          (error: unknown) => (error instanceof CapacidadAgotadaError ? 'saturado' : 'error'),
        ),
    );
    expect(limiteDeHash.enCurso).toBe(MAXIMO_HASHES_SIMULTANEOS);
    expect(limiteDeHash.enEspera).toBe(MAXIMO_HASHES_EN_ESPERA);

    const resultados = await Promise.all(intentos);

    expect(resultados.slice(0, capacidad)).toEqual(
      Array.from({ length: capacidad }, (_, i) => (i % 2 === 0 ? 'correcta' : 'incorrecta')),
    );
    expect(resultados.slice(capacidad)).toEqual(['saturado', 'saturado']);
    expect([limiteDeHash.enCurso, limiteDeHash.enEspera]).toEqual([0, 0]);
  });
});
