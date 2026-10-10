import { describe, expect, it } from 'vitest';

import { escaparComodinesDeLike } from './like';

describe('escaparComodinesDeLike', () => {
  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['\\', '\\\\'],
    ['50%', '50\\%'],
    ['Plan_B', 'Plan\\_B'],
    ['c:\\datos', 'c:\\\\datos'],
    ['%_\\', '\\%\\_\\\\'],
  ])('%j → %j', (entrada, esperado) => {
    expect(escaparComodinesDeLike(entrada)).toBe(esperado);
  });

  it('no toca el resto del texto', () => {
    expect(escaparComodinesDeLike('Municipalidad de Córdoba 30-12345678-1')).toBe(
      'Municipalidad de Córdoba 30-12345678-1',
    );
  });
});
