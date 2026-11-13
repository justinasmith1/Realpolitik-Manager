import { describe, expect, it } from 'vitest';

import { diaLegible, esDiaValido, hoyEnBuenosAires, inicioDelDiaEnBuenosAires } from './dia.js';
import { faltantesParaEnviar } from './envio.js';
import {
  diaDelPaso,
  diaDelUltimoRechazo,
  esRendicionModificable,
  fechaDelPaso,
  MENSAJE_FECHA_ENVIO_FUTURA,
  MENSAJE_FECHA_ENVIO_INVALIDA,
  primerDiaDeEnvio,
  problemaDeFechaEnvio,
  ultimoRechazoPendiente,
} from './envioDeRendicion.js';

// Marcar como Enviada (HU3.7): días de calendario, la regla de la fecha de envío, qué estados ya
// no se modifican y lo que falta para enviar.

describe('días de calendario', () => {
  it('hoy se toma en Buenos Aires, no en UTC', () => {
    // 23:30 del 31/12 en Buenos Aires: en UTC ya es 1/1.
    expect(hoyEnBuenosAires(new Date('2027-01-01T02:30:00.000Z'))).toBe('2026-12-31');
    expect(hoyEnBuenosAires(new Date('2027-01-01T03:00:00.000Z'))).toBe('2027-01-01');
  });

  it.each([
    ['2026-11-12', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-1-01', false],
    ['12/11/2026', false],
  ])('esDiaValido(%j) es %s', (dia, valido) => {
    expect(esDiaValido(dia)).toBe(valido);
  });

  it('un día empieza a las 00:00 de Buenos Aires (03:00 UTC)', () => {
    expect(inicioDelDiaEnBuenosAires('2026-11-08').toISOString()).toBe('2026-11-08T03:00:00.000Z');
  });

  it('diaLegible: dd/mm/aaaa', () => {
    expect(diaLegible('2026-10-01')).toBe('01/10/2026');
  });
});

describe('problemaDeFechaEnvio', () => {
  const octubre = { anio: 2026, mes: 10 };
  const ahora = new Date('2026-11-13T02:30:00.000Z'); // 12/11, 23:30 en Buenos Aires

  it.each(['2026-10-01', '2026-10-31', '2026-11-12'])('acepta %s', (dia) => {
    expect(problemaDeFechaEnvio(dia, octubre, ahora)).toBeNull();
  });

  it('rechaza una fecha futura (en Buenos Aires)', () => {
    expect(problemaDeFechaEnvio('2026-11-13', octubre, ahora)).toBe(MENSAJE_FECHA_ENVIO_FUTURA);
  });

  it('rechaza una fecha anterior al primer día del período', () => {
    expect(problemaDeFechaEnvio('2026-09-30', octubre, ahora)).toBe(
      'La fecha de envío no puede ser anterior al 01/10/2026, el primer día del período.',
    );
  });

  it('rechaza un día que no existe', () => {
    expect(problemaDeFechaEnvio('2026-10-32', octubre, ahora)).toBe(MENSAJE_FECHA_ENVIO_INVALIDA);
  });

  it('en un reenvío (HU3.9), rechaza una fecha anterior al día del último rechazo', () => {
    expect(problemaDeFechaEnvio('2026-11-04', octubre, ahora, '2026-11-05')).toBe(
      'La fecha de envío no puede ser anterior al 05/11/2026, el día del último rechazo.',
    );
    expect(problemaDeFechaEnvio('2026-11-05', octubre, ahora, '2026-11-05')).toBeNull();
    expect(problemaDeFechaEnvio('2026-11-12', octubre, ahora, '2026-11-05')).toBeNull();
  });

  it('la regla del período va antes que la del rechazo', () => {
    expect(problemaDeFechaEnvio('2026-09-30', octubre, ahora, '2026-11-05')).toBe(
      'La fecha de envío no puede ser anterior al 01/10/2026, el primer día del período.',
    );
  });
});

describe('primerDiaDeEnvio', () => {
  const octubre = { anio: 2026, mes: 10 };

  it('sin rechazo, el primer día del período', () => {
    expect(primerDiaDeEnvio(octubre, null)).toBe('2026-10-01');
  });

  it('con un rechazo dentro o después del período, el día del rechazo', () => {
    expect(primerDiaDeEnvio(octubre, '2026-11-05')).toBe('2026-11-05');
  });

  it('con un rechazo anterior al período (no debería pasar), el primer día del período', () => {
    expect(primerDiaDeEnvio(octubre, '2026-09-20')).toBe('2026-10-01');
  });
});

describe('rechazos (HU3.9)', () => {
  // A las 23:30 de Buenos Aires del 5/11 ya es 6/11 en UTC: el día es el de acá.
  const paso = (
    estadoNuevo: 'EN_CURSO' | 'COMPLETA' | 'ENVIADA' | 'RECHAZADA' | 'APROBADA',
    fecha: string,
    extra: { fechaEfectiva?: string; motivo?: string } = {},
  ) => ({ estadoNuevo, fecha: new Date(fecha), ...extra });
  const ALTA = paso('EN_CURSO', '2026-10-02T12:00:00.000Z');
  const COMPLETA = paso('COMPLETA', '2026-10-20T12:00:00.000Z');
  const ENVIO = paso('ENVIADA', '2026-10-21T12:00:00.000Z', { fechaEfectiva: '2026-10-21' });
  const RECHAZO = paso('RECHAZADA', '2026-11-06T02:30:00.000Z', { motivo: 'Falta la firma' });
  const REAPERTURA = paso('EN_CURSO', '2026-11-06T13:00:00.000Z');
  const COMPLETA_2 = paso('COMPLETA', '2026-11-07T12:00:00.000Z');
  const REENVIO = paso('ENVIADA', '2026-11-08T12:00:00.000Z', { fechaEfectiva: '2026-11-08' });
  const RECHAZO_2 = paso('RECHAZADA', '2026-11-10T12:00:00.000Z', { motivo: 'Factura mal' });

  describe('ultimoRechazoPendiente', () => {
    it('sin rechazos: null', () => {
      expect(ultimoRechazoPendiente([])).toBeNull();
      expect(ultimoRechazoPendiente([ALTA, COMPLETA, ENVIO])).toBeNull();
    });

    it('un rechazo sin reenvío: ese rechazo (Rechazada, reabierta o completa)', () => {
      expect(ultimoRechazoPendiente([ALTA, COMPLETA, ENVIO, RECHAZO])).toBe(RECHAZO);
      expect(ultimoRechazoPendiente([ALTA, COMPLETA, ENVIO, RECHAZO, REAPERTURA])).toBe(RECHAZO);
      expect(ultimoRechazoPendiente([ALTA, COMPLETA, ENVIO, RECHAZO, REAPERTURA, COMPLETA_2])).toBe(
        RECHAZO,
      );
    });

    it('un rechazo ya reenviado: null', () => {
      expect(
        ultimoRechazoPendiente([ALTA, COMPLETA, ENVIO, RECHAZO, REAPERTURA, COMPLETA_2, REENVIO]),
      ).toBeNull();
    });

    it('dos rechazos: el segundo, mientras no se reenvíe', () => {
      const historial = [
        ALTA,
        COMPLETA,
        ENVIO,
        RECHAZO,
        REAPERTURA,
        COMPLETA_2,
        REENVIO,
        RECHAZO_2,
      ];
      expect(ultimoRechazoPendiente(historial)).toBe(RECHAZO_2);
      expect(
        ultimoRechazoPendiente([...historial, paso('EN_CURSO', '2026-11-11T12:00:00.000Z')]),
      ).toBe(RECHAZO_2);
    });

    it('mira el orden del historial, no la fecha efectiva del envío', () => {
      // Un envío registrado después del rechazo resuelve el rechazo aunque su fecha sea el mismo día.
      const reenvioMismoDia = paso('ENVIADA', '2026-11-06T15:00:00.000Z', {
        fechaEfectiva: '2026-11-05',
      });
      expect(ultimoRechazoPendiente([ENVIO, RECHAZO, REAPERTURA, reenvioMismoDia])).toBeNull();
    });
  });

  describe('diaDelPaso y diaDelUltimoRechazo', () => {
    it('el día efectivo si lo hay; si no, el del registro en Buenos Aires', () => {
      expect(diaDelPaso(ENVIO)).toBe('2026-10-21');
      expect(diaDelPaso(RECHAZO)).toBe('2026-11-05');
    });

    it('el día del último rechazo, aunque ya se haya reenviado; null si nunca se rechazó', () => {
      expect(diaDelUltimoRechazo([ALTA, ENVIO])).toBeNull();
      expect(diaDelUltimoRechazo([ENVIO, RECHAZO, REAPERTURA])).toBe('2026-11-05');
      expect(diaDelUltimoRechazo([ENVIO, RECHAZO, REAPERTURA, REENVIO, RECHAZO_2])).toBe(
        '2026-11-10',
      );
    });
  });
});

describe('esRendicionModificable', () => {
  it.each([
    ['EN_CURSO', true],
    ['COMPLETA', true],
    ['ENVIADA', false],
    ['APROBADA', false],
    // Hasta que la operadora la reabre con "Corregir" (HU3.9).
    ['RECHAZADA', false],
  ] as const)('%s: %s', (estado, modificable) => {
    expect(esRendicionModificable(estado)).toBe(modificable);
  });
});

describe('fechaDelPaso', () => {
  const fecha = new Date('2026-11-12T18:00:00.000Z');

  it('sin fecha efectiva, la del registro', () => {
    expect(fechaDelPaso({ fecha, fechaEfectiva: null })).toBe(fecha);
    expect(fechaDelPaso({ fecha })).toBe(fecha);
  });

  it('con fecha efectiva, el inicio de ese día en Buenos Aires', () => {
    expect(fechaDelPaso({ fecha, fechaEfectiva: '2026-11-08' }).toISOString()).toBe(
      '2026-11-08T03:00:00.000Z',
    );
  });
});

describe('faltantesParaEnviar', () => {
  const documento = {
    aplicacionId: 'b1c2d3e4-f5a6-4789-8abc-000000000001',
    documentoId: 'b1c2d3e4-f5a6-4789-8abc-000000000002',
    nombreOriginal: 'factura.pdf',
    tipoContenido: 'application/pdf',
    tamanioBytes: 10,
    aplicadaEn: new Date('2026-10-01T12:00:00.000Z'),
  };

  it('cuenta los pendientes y los reunidos sin documento vigente, con la regla del envío', () => {
    const items = [
      { id: 'a', completado: true, documento },
      { id: 'b', completado: false, documento: null },
      { id: 'c', completado: true, documento: null },
      { id: 'd', completado: true },
    ];
    expect(faltantesParaEnviar(items).map((item) => item.id)).toEqual(['b', 'c', 'd']);
  });
});
