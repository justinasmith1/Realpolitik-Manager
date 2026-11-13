import { describe, expect, it } from 'vitest';

import type { EstadoRendicion } from '../schemas/rendicion.schema.js';

import {
  COBRO_NOTA_MAX,
  ESTADOS_COBRABLES,
  esEstadoCobrable,
  MENSAJE_FECHA_COBRO_FUTURA,
  MENSAJE_FECHA_COBRO_INVALIDA,
  problemaDeFechaCobro,
} from './cobro.js';

// Registrar el cobro informado por el cliente (HU3.10): en qué estados se puede, el tope de la
// nota y la regla de la fecha.

describe('estados en los que se puede registrar el cobro', () => {
  it('son Enviada y Aprobada', () => {
    expect([...ESTADOS_COBRABLES]).toEqual(['ENVIADA', 'APROBADA']);
  });

  it.each<[EstadoRendicion, boolean]>([
    ['EN_CURSO', false],
    ['COMPLETA', false],
    ['ENVIADA', true],
    ['APROBADA', true],
    ['RECHAZADA', false],
  ])('esEstadoCobrable(%s) es %s', (estado, cobrable) => {
    expect(esEstadoCobrable(estado)).toBe(cobrable);
  });
});

it('la nota admite hasta 300 caracteres', () => {
  expect(COBRO_NOTA_MAX).toBe(300);
});

describe('problemaDeFechaCobro', () => {
  const ahora = new Date('2026-11-13T15:00:00.000Z'); // 13/11, 12:00 en Buenos Aires

  it('acepta hoy', () => {
    expect(problemaDeFechaCobro('2026-11-13', ahora)).toBeNull();
  });

  it.each(['2026-11-12', '2026-01-01', '2020-01-01'])('acepta un día pasado: %s', (dia) => {
    expect(problemaDeFechaCobro(dia, ahora)).toBeNull();
  });

  it('rechaza mañana', () => {
    expect(problemaDeFechaCobro('2026-11-14', ahora)).toBe(MENSAJE_FECHA_COBRO_FUTURA);
  });

  it('a las 22:00 en Buenos Aires ya es el día siguiente en UTC: el día siguiente se rechaza y hoy se acepta', () => {
    const noche = new Date('2026-11-14T01:00:00.000Z'); // 13/11, 22:00 en Buenos Aires
    expect(problemaDeFechaCobro('2026-11-14', noche)).toBe(MENSAJE_FECHA_COBRO_FUTURA);
    expect(problemaDeFechaCobro('2026-11-13', noche)).toBeNull();
  });

  it.each(['2026-02-30', '2026-13-01', '13/11/2026', '2026-1-1', ''])(
    'rechaza %j como fecha inválida',
    (dia) => {
      expect(problemaDeFechaCobro(dia, ahora)).toBe(MENSAJE_FECHA_COBRO_INVALIDA);
    },
  );

  it('lee el reloj al llamar si no se le pasa "ahora"', () => {
    expect(problemaDeFechaCobro('2100-01-01')).toBe(MENSAJE_FECHA_COBRO_FUTURA);
  });
});
