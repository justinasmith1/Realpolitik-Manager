import { fechaDelPaso } from '@realpolitik/shared';

import {
  cantidadDeRendicionesEnElMes,
  fechaCorta,
  fechaYHora,
  MENSAJE_COBRO_ESTADO_INVALIDO,
  nombreDeItem,
  numeroDeWhatsappLegible,
  textoDeCobro,
  textoDeCobroCorto,
  textoDeCobroEnChip,
  textoDeHoy,
  textoDePendientes,
  tipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';

// La fecha y hora del registro de un cambio de estado (HU4.6): dd/mm/aaaa HH:mm, 24 h, en
// Buenos Aires, la resuelva quien la resuelva (`Intl`, no sumar ni restar horas).
describe('fechaYHora', () => {
  it('una tarde: "16/11/2026 14:32"', () => {
    expect(fechaYHora(new Date('2026-11-16T17:32:00.000Z'))).toBe('16/11/2026 14:32');
  });

  it('un instante que en UTC ya es el día siguiente se lee con el día de Buenos Aires', () => {
    expect(fechaYHora(new Date('2026-11-03T02:30:00.000Z'))).toBe('02/11/2026 23:30');
    // Coincide con el día de `fechaCorta` para el mismo instante.
    expect(fechaCorta(new Date('2026-11-03T02:30:00.000Z'))).toBe('02/11/2026');
  });

  it('a medianoche, 24 horas: "00:05", no "24:05" ni "12:05 a. m."', () => {
    expect(fechaYHora(new Date('2026-11-16T03:05:00.000Z'))).toBe('16/11/2026 00:05');
  });

  it('en un envío, el día del paso (la fecha elegida) y el del registro no se confunden', () => {
    const envio = {
      estadoNuevo: 'ENVIADA',
      fecha: new Date('2026-11-12T12:00:00.000Z'),
      fechaEfectiva: '2026-10-05',
    } as const;

    expect(fechaCorta(fechaDelPaso(envio))).toBe('05/10/2026');
    expect(fechaYHora(envio.fecha)).toBe('12/11/2026 09:00');
  });
});

describe('nombreDeItem', () => {
  it('con un solo ejemplar, solo el nombre; con varios, cuál de cuántos', () => {
    expect(nombreDeItem({ nombreTipoDocumento: 'Factura', ordinal: 1, totalOrdinal: 1 })).toBe(
      'Factura',
    );
    expect(nombreDeItem({ nombreTipoDocumento: 'Print', ordinal: 2, totalOrdinal: 5 })).toBe(
      'Print 2 de 5',
    );
  });
});

describe('numeroDeWhatsappLegible', () => {
  it.each([
    ['+5493511234567', '+54 9 351 123 4567'],
    ['+5491123456789', '+54 9 11 2345 6789'],
    ['+59899123456', '+59899123456'],
  ])('%s se lee como %s', (numero, legible) => {
    expect(numeroDeWhatsappLegible(numero)).toBe(legible);
  });
});

// Pantalla Rendiciones (HU3.2).
describe('textoDePendientes', () => {
  it.each([
    [0, 'Sin pendientes'],
    [1, '1 pendiente'],
    [3, '3 pendientes'],
  ])('%i: "%s"', (faltantes, texto) => {
    expect(textoDePendientes(faltantes)).toBe(texto);
  });
});

describe('tipoDeCliente', () => {
  it('un público con subtipo dice el subtipo; sin él, o privado, el sector', () => {
    expect(tipoDeCliente({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' })).toBe('Municipio');
    expect(tipoDeCliente({ sector: 'PUBLICO', subtipo: null })).toBe('Público');
    expect(tipoDeCliente({ sector: 'PRIVADO', subtipo: null })).toBe('Privado');
  });
});

describe('textoDeHoy', () => {
  it('el día de la semana y dd/mm, en horario de Buenos Aires', () => {
    // 01:00 UTC del jueves 5/11 es todavía el miércoles 4/11 en Buenos Aires.
    expect(textoDeHoy(new Date('2026-11-05T01:00:00.000Z'))).toBe('Hoy es miércoles 04/11');
  });
});

describe('cantidadDeRendicionesEnElMes', () => {
  it('en singular y en plural, con el mes en minúscula', () => {
    expect(cantidadDeRendicionesEnElMes(1, { anio: 2026, mes: 11 }, 2026)).toBe(
      '1 rendición en noviembre',
    );
    expect(cantidadDeRendicionesEnElMes(0, { anio: 2026, mes: 3 }, 2026)).toBe(
      '0 rendiciones en marzo',
    );
  });

  it('si el mes es de otro año, lo aclara', () => {
    expect(cantidadDeRendicionesEnElMes(4, { anio: 2025, mes: 12 }, 2026)).toBe(
      '4 rendiciones en diciembre de 2025',
    );
  });
});

// ─── Cobro informado por el cliente (HU3.10) ──────────────────────────────────

describe('textos del cobro', () => {
  it('la fecha del cobro se lee como un día de calendario, sin pasar por Date', () => {
    expect(textoDeCobro('2026-11-10')).toBe('Cobrada el 10/11/2026');
    expect(textoDeCobroEnChip('2026-11-10')).toBe('Cobrada · 10/11/2026');
    expect(textoDeCobroCorto('2026-11-10')).toBe('Cobrada 10/11');
  });

  it.each(['2026-01-01', '2026-12-31'])('el día %s no se corre por la zona horaria', (dia) => {
    const [anio, mes, numero] = dia.split('-');
    expect(textoDeCobro(dia)).toBe(`Cobrada el ${numero}/${mes}/${anio}`);
    expect(textoDeCobroCorto(dia)).toBe(`Cobrada ${numero}/${mes}`);
  });

  it('los textos de error del cobro son los acordados', () => {
    expect(MENSAJE_COBRO_ESTADO_INVALIDO).toBe(
      'Solo se puede registrar el cobro de una rendición aprobada.',
    );
  });
});
