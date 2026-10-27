import { describe, expect, it } from 'vitest';

import {
  CANTIDAD_MAX,
  DIA_MAX,
  DIA_MIN,
  parsearDiasEscritos,
  problemaDeDias,
} from './diasAproximados.js';

describe('límites', () => {
  it('los días van de 1 a 31 y el tope de cantidad es 31 (uno por día del mes)', () => {
    expect(DIA_MIN).toBe(1);
    expect(DIA_MAX).toBe(31);
    expect(CANTIDAD_MAX).toBe(31);
  });
});

describe('parsearDiasEscritos', () => {
  it('lee días separados por coma, con o sin espacios', () => {
    expect(parsearDiasEscritos('1, 8, 15')).toEqual([1, 8, 15]);
    expect(parsearDiasEscritos('1,8,15')).toEqual([1, 8, 15]);
    expect(parsearDiasEscritos('  3 ,  20 ')).toEqual([3, 20]);
  });

  it('conserva el orden y los repetidos tal cual se escribieron', () => {
    expect(parsearDiasEscritos('15, 1, 15')).toEqual([15, 1, 15]);
  });

  it('ignora los vacíos', () => {
    expect(parsearDiasEscritos('1,,8,')).toEqual([1, 8]);
    expect(parsearDiasEscritos(' , 5 ,  , ')).toEqual([5]);
  });

  it('un texto vacío o en blanco es una lista vacía', () => {
    expect(parsearDiasEscritos('')).toEqual([]);
    expect(parsearDiasEscritos('   ')).toEqual([]);
    expect(parsearDiasEscritos(',')).toEqual([]);
  });

  it.each(['a', '1.5', '-3', '0', '1e1', '+3', '1 8', '0x10'])(
    'devuelve NaN en la posición de "%s", que no es un entero positivo',
    (texto) => {
      expect(parsearDiasEscritos(texto)).toEqual([NaN]);
    },
  );

  it('solo marca con NaN la posición inválida', () => {
    const dias = parsearDiasEscritos('1, x, 15');
    expect(dias).toHaveLength(3);
    expect(dias[0]).toBe(1);
    expect(dias[1]).toBeNaN();
    expect(dias[2]).toBe(15);
  });

  it('no valida el rango: eso lo hace el schema', () => {
    expect(parsearDiasEscritos('32, 99')).toEqual([32, 99]);
  });
});

describe('problemaDeDias', () => {
  it('una lista vacía es válida con cualquier cantidad', () => {
    expect(problemaDeDias(1, [])).toBeNull();
    expect(problemaDeDias(5, [])).toBeNull();
  });

  it('una lista con exactamente `cantidad` días es válida', () => {
    expect(problemaDeDias(1, [10])).toBeNull();
    expect(problemaDeDias(3, [1, 10, 10])).toBeNull();
  });

  it('con menos días que la cantidad devuelve el mensaje', () => {
    expect(problemaDeDias(3, [1, 10])).toBe(
      'Cargá 3 días aproximados (uno por documento) o dejá la lista vacía.',
    );
  });

  it('con más días que la cantidad devuelve el mensaje', () => {
    expect(problemaDeDias(2, [1, 10, 20])).toBe(
      'Cargá 2 días aproximados (uno por documento) o dejá la lista vacía.',
    );
  });

  it('usa el singular cuando la cantidad es 1', () => {
    expect(problemaDeDias(1, [1, 2])).toBe(
      'Cargá 1 día aproximado (uno por documento) o dejá la lista vacía.',
    );
  });
});
