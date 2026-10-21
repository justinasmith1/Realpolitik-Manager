import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANIO_MAX, ANIO_MIN, mesActual, periodoMuyFuturo } from './periodo.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('límites de año', () => {
  it('son los de la base: 2020 a 2100', () => {
    expect(ANIO_MIN).toBe(2020);
    expect(ANIO_MAX).toBe(2100);
  });
});

describe('mesActual', () => {
  it('toma el mes en horario de Buenos Aires', () => {
    expect(mesActual(new Date('2026-10-15T12:00:00-03:00'))).toEqual({ anio: 2026, mes: 10 });
  });

  it('a las 23:30 del último día del mes en Argentina todavía es ese mes (en UTC ya es el siguiente)', () => {
    const ahora = new Date('2026-10-31T23:30:00-03:00');
    expect(ahora.getUTCMonth() + 1).toBe(11);
    expect(mesActual(ahora)).toEqual({ anio: 2026, mes: 10 });
  });

  it('a las 00:30 del primer día del mes en Argentina ya es ese mes', () => {
    expect(mesActual(new Date('2026-11-01T00:30:00-03:00'))).toEqual({ anio: 2026, mes: 11 });
  });

  it('cruza de año en diciembre', () => {
    expect(mesActual(new Date('2026-12-31T23:30:00-03:00'))).toEqual({ anio: 2026, mes: 12 });
    expect(mesActual(new Date('2027-01-01T00:00:00-03:00'))).toEqual({ anio: 2027, mes: 1 });
  });

  it('sin argumento lee la fecha al llamarse, no al importar el módulo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-03-10T12:00:00-03:00'));
    expect(mesActual()).toEqual({ anio: 2030, mes: 3 });
    vi.setSystemTime(new Date('2031-08-10T12:00:00-03:00'));
    expect(mesActual()).toEqual({ anio: 2031, mes: 8 });
  });
});

describe('periodoMuyFuturo', () => {
  const ahora = new Date('2026-10-15T12:00:00-03:00');

  it('el mes actual no es futuro', () => {
    expect(periodoMuyFuturo({ anio: 2026, mes: 10 }, ahora)).toBe(false);
  });

  it('el mes siguiente es el máximo permitido', () => {
    expect(periodoMuyFuturo({ anio: 2026, mes: 11 }, ahora)).toBe(false);
  });

  it('dos meses adelante se rechaza', () => {
    expect(periodoMuyFuturo({ anio: 2026, mes: 12 }, ahora)).toBe(true);
  });

  it('cualquier mes pasado vale', () => {
    expect(periodoMuyFuturo({ anio: 2026, mes: 9 }, ahora)).toBe(false);
    expect(periodoMuyFuturo({ anio: 2020, mes: 1 }, ahora)).toBe(false);
  });

  it('un año posterior se rechaza aunque el número de mes sea menor', () => {
    expect(periodoMuyFuturo({ anio: 2027, mes: 1 }, ahora)).toBe(true);
  });

  it('en diciembre el mes siguiente es enero del año que viene', () => {
    const diciembre = new Date('2026-12-15T12:00:00-03:00');
    expect(periodoMuyFuturo({ anio: 2027, mes: 1 }, diciembre)).toBe(false);
    expect(periodoMuyFuturo({ anio: 2027, mes: 2 }, diciembre)).toBe(true);
  });

  it('respeta el cambio de mes en horario argentino', () => {
    // En UTC ya es noviembre, pero en Argentina todavía es octubre: diciembre sigue siendo 2 meses adelante.
    const finDeOctubre = new Date('2026-10-31T23:30:00-03:00');
    expect(periodoMuyFuturo({ anio: 2026, mes: 11 }, finDeOctubre)).toBe(false);
    expect(periodoMuyFuturo({ anio: 2026, mes: 12 }, finDeOctubre)).toBe(true);
  });

  it('sin fecha usa la fecha del sistema al llamarse', () => {
    vi.useFakeTimers();
    vi.setSystemTime(ahora);
    expect(periodoMuyFuturo({ anio: 2026, mes: 11 })).toBe(false);
    expect(periodoMuyFuturo({ anio: 2026, mes: 12 })).toBe(true);
  });
});
