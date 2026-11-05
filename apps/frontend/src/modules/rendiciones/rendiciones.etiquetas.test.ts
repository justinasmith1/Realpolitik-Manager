import {
  cantidadDeRendicionesEnElMes,
  nombreDeItem,
  numeroDeWhatsappLegible,
  textoDeHoy,
  textoDePendientes,
  tipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';

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
