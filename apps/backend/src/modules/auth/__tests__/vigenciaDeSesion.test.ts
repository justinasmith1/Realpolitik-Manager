import { afterEach, describe, expect, it } from 'vitest';

import {
  debeRegistrarActividad,
  DURACIONES_DE_SESION,
  evaluarSesion,
  fechasDeSesionNueva,
  INTERVALO_MINIMO_DE_ACTIVIDAD_MS,
  RETENCION_DE_SESIONES_CERRADAS_MS,
  type TiemposDeSesion,
  umbralesDeActividad,
} from '../vigenciaDeSesion';

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

const INICIO = new Date('2026-11-11T12:00:00.000Z');
const en = (ms: number) => new Date(INICIO.getTime() + ms);

/** Una sesión creada en INICIO, con actividad en `actividad` (desplazamiento en ms). */
function sesion(extra: Partial<TiemposDeSesion> = {}): TiemposDeSesion {
  return { ...fechasDeSesionNueva(INICIO), revocadaEn: null, ...extra };
}

describe('duraciones propuestas (P2, pendientes de aprobación)', () => {
  it('son 24 horas de inactividad y 7 días absolutos', () => {
    expect(DURACIONES_DE_SESION).toEqual({ inactividadMs: 24 * HORA, absolutaMs: 7 * DIA });
    expect(Object.isFrozen(DURACIONES_DE_SESION)).toBe(true);
  });
});

describe('fechasDeSesionNueva', () => {
  it('fija inicio y actividad en el mismo instante, y el vencimiento a 7 días', () => {
    expect(fechasDeSesionNueva(INICIO)).toEqual({
      createdAt: INICIO,
      ultimaActividadEn: INICIO,
      expiraEn: new Date('2026-11-18T12:00:00.000Z'),
    });
  });

  it('cumple el CHECK de la base: expiraEn > createdAt y actividad no anterior al inicio', () => {
    const { createdAt, ultimaActividadEn, expiraEn } = fechasDeSesionNueva(INICIO, {
      inactividadMs: 1,
      absolutaMs: 1,
    });

    expect(expiraEn.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(ultimaActividadEn.getTime()).toBe(createdAt.getTime());
  });

  it('devuelve fechas nuevas: modificar el resultado no altera `ahora`', () => {
    const ahora = new Date(INICIO);
    const fechas = fechasDeSesionNueva(ahora);
    fechas.createdAt.setUTCFullYear(2000);

    expect(ahora).toEqual(INICIO);
  });

  it('usa duraciones configuradas', () => {
    expect(
      fechasDeSesionNueva(INICIO, { inactividadMs: HORA, absolutaMs: 12 * HORA }).expiraEn,
    ).toEqual(en(12 * HORA));
  });
});

describe('evaluarSesion', () => {
  it('recién creada, está vigente', () => {
    expect(evaluarSesion(sesion(), INICIO)).toBe('VIGENTE');
  });

  describe('inactividad (24 h desde la última actividad)', () => {
    it('vigente un milisegundo antes del límite', () => {
      expect(evaluarSesion(sesion(), en(24 * HORA - 1))).toBe('VIGENTE');
    });

    it('vencida en el instante exacto del límite', () => {
      expect(evaluarSesion(sesion(), en(24 * HORA))).toBe('VENCIDA_POR_INACTIVIDAD');
    });

    it('la actividad corre el límite: actividad a las 20 h, vigente a las 30 h', () => {
      const conActividad = sesion({ ultimaActividadEn: en(20 * HORA) });

      expect(evaluarSesion(conActividad, en(30 * HORA))).toBe('VIGENTE');
      expect(evaluarSesion(conActividad, en(44 * HORA))).toBe('VENCIDA_POR_INACTIVIDAD');
    });
  });

  describe('duración absoluta (expiraEn)', () => {
    it('con actividad constante, vence igual a los 7 días exactos', () => {
      const activa = sesion({ ultimaActividadEn: en(7 * DIA - MINUTO) });

      expect(evaluarSesion(activa, en(7 * DIA - 1))).toBe('VIGENTE');
      expect(evaluarSesion(activa, en(7 * DIA))).toBe('VENCIDA_POR_DURACION');
    });

    it('cuando vencen las dos, informa la duración absoluta', () => {
      expect(evaluarSesion(sesion(), en(8 * DIA))).toBe('VENCIDA_POR_DURACION');
    });

    it('usa el expiraEn guardado: acortar la duración configurada no vence las sesiones ya creadas', () => {
      const corta = { inactividadMs: 24 * HORA, absolutaMs: HORA };

      expect(evaluarSesion(sesion(), en(2 * HORA), corta)).toBe('VIGENTE');
    });

    it('la inactividad usa la duración vigente', () => {
      expect(
        evaluarSesion(sesion(), en(2 * HORA), { inactividadMs: HORA, absolutaMs: 7 * DIA }),
      ).toBe('VENCIDA_POR_INACTIVIDAD');
    });
  });

  describe('revocación', () => {
    it('revocada antes que cualquier vencimiento', () => {
      const revocada = sesion({ revocadaEn: en(MINUTO) });

      expect(evaluarSesion(revocada, en(2 * MINUTO))).toBe('REVOCADA');
      expect(evaluarSesion(revocada, en(8 * DIA))).toBe('REVOCADA');
    });

    it('una sesión con revocadaEn nunca vuelve a estar vigente', () => {
      expect(evaluarSesion(sesion({ revocadaEn: INICIO }), INICIO)).toBe('REVOCADA');
    });
  });

  it('con un reloj que retrocede (actividad en el futuro), sigue vigente hasta su plazo', () => {
    const futura = sesion({ ultimaActividadEn: en(HORA) });

    expect(evaluarSesion(futura, en(30 * MINUTO))).toBe('VIGENTE');
    expect(evaluarSesion(futura, en(25 * HORA))).toBe('VENCIDA_POR_INACTIVIDAD');
  });

  describe('entradas inválidas', () => {
    it('rechaza una fecha inválida', () => {
      expect(() => evaluarSesion(sesion(), new Date('no es fecha'))).toThrow(RangeError);
      expect(() => evaluarSesion(sesion({ expiraEn: new Date(Number.NaN) }), INICIO)).toThrow(
        /expiraEn/,
      );
    });

    it.each([
      ['cero', { inactividadMs: 0, absolutaMs: DIA }],
      ['negativa', { inactividadMs: HORA, absolutaMs: -1 }],
      ['no entera', { inactividadMs: 1.5, absolutaMs: DIA }],
      ['infinita', { inactividadMs: Number.POSITIVE_INFINITY, absolutaMs: DIA }],
    ])('rechaza una duración %s', (_caso, duraciones) => {
      expect(() => evaluarSesion(sesion(), INICIO, duraciones)).toThrow(RangeError);
      expect(() => fechasDeSesionNueva(INICIO, duraciones)).toThrow(RangeError);
    });
  });
});

describe('debeRegistrarActividad (como mucho una escritura por minuto)', () => {
  const base = { ultimaActividadEn: INICIO };

  it('el intervalo es de un minuto', () => {
    expect(INTERVALO_MINIMO_DE_ACTIVIDAD_MS).toBe(MINUTO);
  });

  it.each([
    ['en el mismo instante', 0, false],
    ['a los 59,999 s', MINUTO - 1, false],
    ['al minuto exacto (la comparación es estricta, como la consulta)', MINUTO, false],
    ['un milisegundo después del minuto', MINUTO + 1, true],
    ['horas después', 5 * HORA, true],
    ['con un reloj que retrocede', -MINUTO, false],
  ])('%s → %s', (_caso, desplazamiento, esperado) => {
    expect(debeRegistrarActividad(base, en(desplazamiento))).toBe(esperado);
  });
});

describe('independiente de la zona horaria', () => {
  const zonaOriginal = process.env.TZ;

  afterEach(() => {
    if (zonaOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = zonaOriginal;
  });

  // El 1 de noviembre de 2026 Nueva York sale del horario de verano: ese "día" tiene 25 horas.
  // 24 horas de inactividad siguen siendo 24 horas reales.
  const antesDelCambio = new Date('2026-11-01T04:30:00.000Z'); // 00:30 en Nueva York (EDT)

  it.each([
    ['America/Argentina/Buenos_Aires', 180],
    ['America/New_York', 240],
    ['Asia/Tokyo', -540],
    ['UTC', 0],
  ])('mismo resultado en %s, también cruzando un cambio de horario', (zona, desfaseEsperado) => {
    process.env.TZ = zona;
    // Control: la zona del proceso cambió de verdad (si no, el test no probaría nada).
    expect(antesDelCambio.getTimezoneOffset()).toBe(desfaseEsperado);
    const creada: TiemposDeSesion = { ...fechasDeSesionNueva(antesDelCambio), revocadaEn: null };

    expect(creada.expiraEn.toISOString()).toBe('2026-11-08T04:30:00.000Z');
    expect(evaluarSesion(creada, new Date(antesDelCambio.getTime() + 24 * HORA - 1))).toBe(
      'VIGENTE',
    );
    expect(evaluarSesion(creada, new Date(antesDelCambio.getTime() + 24 * HORA))).toBe(
      'VENCIDA_POR_INACTIVIDAD',
    );
  });
});

describe('umbralesDeActividad (la escritura condicional del servicio)', () => {
  const ahora = en(3 * DIA);
  const { registrarSiAnteriorA, vigenteDesde } = umbralesDeActividad(ahora);

  it('son ahora − 1 minuto y ahora − inactividad', () => {
    expect(registrarSiAnteriorA).toEqual(new Date(ahora.getTime() - MINUTO));
    expect(vigenteDesde).toEqual(new Date(ahora.getTime() - 24 * HORA));
  });

  // En los bordes exactos, el WHERE (`ultima < registrarSiAnteriorA`, `ultima > vigenteDesde`) decide
  // lo mismo que `debeRegistrarActividad` y `evaluarSesion`: el SQL no diverge de las reglas.
  it.each([0, 1, MINUTO - 1, MINUTO, MINUTO + 1, HORA, 24 * HORA - 1, 24 * HORA, 24 * HORA + 1])(
    'con la última actividad %d ms antes, decide igual que las funciones puras',
    (antes) => {
      const ultimaActividadEn = new Date(ahora.getTime() - antes);
      const sesion = { ...sesionBase(), ultimaActividadEn };

      expect(ultimaActividadEn < registrarSiAnteriorA).toBe(debeRegistrarActividad(sesion, ahora));
      expect(ultimaActividadEn > vigenteDesde).toBe(evaluarSesion(sesion, ahora) === 'VIGENTE');
    },
  );

  function sesionBase(): TiemposDeSesion {
    return {
      createdAt: INICIO,
      ultimaActividadEn: INICIO,
      expiraEn: en(7 * DIA),
      revocadaEn: null,
    };
  }
});

describe('retención de sesiones cerradas', () => {
  it('es de 7 días', () => {
    expect(RETENCION_DE_SESIONES_CERRADAS_MS).toBe(7 * DIA);
  });
});
