import { describe, expect, it } from 'vitest';

import { normalizarNombreTipoDocumento as normalizar } from './nombreTipoDocumento.js';

// Los caracteres invisibles (marcas combinantes, espacio duro) van como escapes `\u`: as\u00ed se ven
// en el c\u00f3digo y un editor que normalice el archivo a NFC no puede cambiar los casos de prueba.
const N_TILDE_DESCOMPUESTA = 'n\u0303';

describe('normalizarNombreTipoDocumento', () => {
  it('ignora mayúsculas y minúsculas', () => {
    for (const nombre of [
      'Constancia ARCA',
      'constancia arca',
      'CONSTANCIA ARCA',
      'cOnStAnCiA aRcA',
    ]) {
      expect(normalizar(nombre)).toBe('constancia arca');
    }
  });

  it('ignora las vocales acentuadas', () => {
    expect(normalizar('Constancía ARCA')).toBe('constancia arca');
    expect(normalizar('ÁÉÍÓÚ áéíóú')).toBe('aeiou aeiou');
    expect(normalizar('Certificación')).toBe('certificacion');
  });

  it('ignora otros diacríticos: diéresis, cedilla, acento grave y tildes que no son de la ñ', () => {
    expect(normalizar('Pingüino')).toBe('pinguino');
    expect(normalizar('Façade')).toBe('facade');
    expect(normalizar('Àè')).toBe('ae');
    expect(normalizar('São Tomé')).toBe('sao tome');
  });

  it('conserva la ñ como una letra distinta de la n', () => {
    expect(normalizar('Año')).toBe('año');
    expect(normalizar('Ano')).toBe('ano');
    expect(normalizar('Año')).not.toBe(normalizar('Ano'));
    expect(normalizar('AÑO')).toBe(normalizar('año'));
  });

  it('la ñ precompuesta (U+00F1) y la descompuesta (n + U+0303) dan la misma clave', () => {
    const descompuesta = `A${N_TILDE_DESCOMPUESTA}o`;
    expect(descompuesta).not.toBe('Año');
    expect(normalizar(descompuesta)).toBe(normalizar('Año'));
    expect(normalizar('AN\u0303O')).toBe('año');
    // La clave siempre lleva la ñ precompuesta.
    expect(normalizar(descompuesta)).toBe('año');
  });

  it('la tilde solo se conserva inmediatamente después de una n', () => {
    // Con otra marca entre la n y la tilde, ya no es una ñ.
    expect(normalizar('n\u0301\u0303')).toBe('n');
    expect(normalizar('a\u0303')).toBe('a');
  });

  it('recorta los espacios de los bordes', () => {
    expect(normalizar('   Factura   ')).toBe('factura');
    expect(normalizar('\u00A0Factura\u00A0')).toBe('factura');
  });

  it('colapsa los espacios internos repetidos, incluido el espacio duro', () => {
    expect(normalizar('Constancia    ARCA')).toBe('constancia arca');
    expect(normalizar('Constancia\u00A0ARCA')).toBe('constancia arca');
    expect(normalizar('Pago  \u00A0 IIBB')).toBe('pago iibb');
  });

  it('deja como están las letras que Unicode no descompone', () => {
    expect(normalizar('Øresund Łódź Straße')).toBe('øresund łodz straße');
  });

  it('es idempotente', () => {
    for (const nombre of [
      '  Constancía   ARCA ',
      'AÑO',
      `A${N_TILDE_DESCOMPUESTA}o`,
      'İstanbul',
      'Øresund Łódź',
      'Pingüino',
    ]) {
      const una = normalizar(nombre);
      expect(normalizar(una)).toBe(una);
    }
  });

  it('el resultado nunca es más largo que la entrada (entra en VARCHAR(100))', () => {
    expect(normalizar('Á'.repeat(100))).toBe('a'.repeat(100));
    expect(normalizar('Ñ'.repeat(100))).toBe('ñ'.repeat(100));
    expect(normalizar(N_TILDE_DESCOMPUESTA.repeat(50))).toBe('ñ'.repeat(50));
    // La única letra que al pasar a minúscula agrega una marca (İ → i + U+0307) la pierde después.
    expect(normalizar('İ'.repeat(100))).toBe('i'.repeat(100));
    for (const nombre of ['a'.repeat(100), 'Ü'.repeat(100), `${'x'.repeat(98)}  `]) {
      expect(normalizar(nombre).length).toBeLessThanOrEqual(nombre.length);
    }
  });

  it('da la clave esperada para cada tipo del catálogo validado', () => {
    const catalogo: Record<string, string> = {
      Factura: 'factura',
      Print: 'print',
      'Constancia escrita': 'constancia escrita',
      CAE: 'cae',
      OC: 'oc',
      'Constancia ARCA': 'constancia arca',
      'Libre deuda': 'libre deuda',
      'Pago IIBB': 'pago iibb',
      'Constancia IIBB': 'constancia iibb',
    };
    for (const [nombre, clave] of Object.entries(catalogo)) {
      expect(normalizar(nombre)).toBe(clave);
    }
    // Ningún par del catálogo choca entre sí.
    const claves = Object.keys(catalogo).map(normalizar);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('el nombre anterior de OC no choca con OC', () => {
    expect(normalizar('Orden de compra')).toBe('orden de compra');
    expect(normalizar('Orden de compra')).not.toBe(normalizar('OC'));
  });
});
