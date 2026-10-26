import { nombreDeItem, numeroDeWhatsappLegible } from '@/modules/rendiciones/rendiciones.etiquetas';

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
