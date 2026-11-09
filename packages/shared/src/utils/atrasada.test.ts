import { describe, expect, it } from 'vitest';

import { esAtrasada, ultimoPeriodoAtrasado } from './atrasada.js';

// "Atrasada" (HU3.4): sin enviar y de dos meses atrás o más, en horario de Buenos Aires.

const NOVIEMBRE = new Date('2026-11-15T12:00:00-03:00');
const ENERO = new Date('2027-01-10T12:00:00-03:00');

describe('ultimoPeriodoAtrasado', () => {
  it('es dos meses antes del mes actual', () => {
    expect(ultimoPeriodoAtrasado(NOVIEMBRE)).toEqual({ anio: 2026, mes: 9 });
  });

  it('cruza de año', () => {
    expect(ultimoPeriodoAtrasado(ENERO)).toEqual({ anio: 2026, mes: 11 });
    expect(ultimoPeriodoAtrasado(new Date('2027-02-10T12:00:00-03:00'))).toEqual({
      anio: 2026,
      mes: 12,
    });
  });
});

describe('esAtrasada', () => {
  it('el mes actual no está atrasado', () => {
    expect(esAtrasada({ anio: 2026, mes: 11 }, 'EN_CURSO', NOVIEMBRE)).toBe(false);
  });

  it('el mes anterior En curso no está atrasado: se trabaja en el mes siguiente', () => {
    expect(esAtrasada({ anio: 2026, mes: 10 }, 'EN_CURSO', NOVIEMBRE)).toBe(false);
    expect(esAtrasada({ anio: 2026, mes: 10 }, 'COMPLETA', NOVIEMBRE)).toBe(false);
  });

  it.each(['EN_CURSO', 'COMPLETA'] as const)(
    'dos meses atrás, %s, está atrasada (y también más atrás)',
    (estado) => {
      expect(esAtrasada({ anio: 2026, mes: 9 }, estado, NOVIEMBRE)).toBe(true);
      expect(esAtrasada({ anio: 2025, mes: 3 }, estado, NOVIEMBRE)).toBe(true);
    },
  );

  it.each(['ENVIADA', 'APROBADA', 'RECHAZADA'] as const)(
    'dos meses atrás, %s, no está atrasada: ya se envió',
    (estado) => {
      expect(esAtrasada({ anio: 2026, mes: 9 }, estado, NOVIEMBRE)).toBe(false);
    },
  );

  it('un mes futuro no está atrasado', () => {
    expect(esAtrasada({ anio: 2026, mes: 12 }, 'EN_CURSO', NOVIEMBRE)).toBe(false);
  });

  it('cambio de año: en enero, noviembre del año anterior sí; diciembre no', () => {
    expect(esAtrasada({ anio: 2026, mes: 11 }, 'EN_CURSO', ENERO)).toBe(true);
    expect(esAtrasada({ anio: 2026, mes: 12 }, 'EN_CURSO', ENERO)).toBe(false);
  });

  describe('borde de medianoche en Buenos Aires', () => {
    it('01/12 00:30 en Argentina (03:30 UTC) ya es diciembre: octubre pasa a estar atrasada', () => {
      const hoy = new Date('2026-12-01T00:30:00-03:00');
      expect(hoy.toISOString()).toBe('2026-12-01T03:30:00.000Z');
      expect(esAtrasada({ anio: 2026, mes: 10 }, 'EN_CURSO', hoy)).toBe(true);
    });

    it('30/11 23:30 en Argentina (en UTC ya es 01/12) todavía es noviembre: octubre no está atrasada', () => {
      const hoy = new Date('2026-11-30T23:30:00-03:00');
      expect(hoy.getUTCDate()).toBe(1);
      expect(hoy.getUTCMonth() + 1).toBe(12);
      expect(esAtrasada({ anio: 2026, mes: 10 }, 'EN_CURSO', hoy)).toBe(false);
      expect(esAtrasada({ anio: 2026, mes: 9 }, 'EN_CURSO', hoy)).toBe(true);
    });
  });
});
