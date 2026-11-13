import { describe, expect, it } from 'vitest';

import { diaLegible, esDiaValido, hoyEnBuenosAires, inicioDelDiaEnBuenosAires } from './dia.js';
import { faltantesParaEnviar } from './envio.js';
import {
  esRendicionModificable,
  fechaDelPaso,
  MENSAJE_FECHA_ENVIO_FUTURA,
  MENSAJE_FECHA_ENVIO_INVALIDA,
  problemaDeFechaEnvio,
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
});

describe('esRendicionModificable', () => {
  it.each([
    ['EN_CURSO', true],
    ['COMPLETA', true],
    ['ENVIADA', false],
    ['APROBADA', false],
    ['RECHAZADA', true],
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
