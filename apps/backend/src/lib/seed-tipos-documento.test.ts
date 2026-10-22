import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

import { CATALOGO_TIPOS_DOCUMENTO, RENOMBRES_TIPOS_DOCUMENTO } from './seed-tipos-documento';

/** Las claves del catálogo, tal como las guarda la base en `nombreNormalizado`. */
function clavesDelCatalogo(): string[] {
  return CATALOGO_TIPOS_DOCUMENTO.map((tipo) => normalizar(tipo.nombre));
}

describe('catálogo de tipos de documento del seed', () => {
  it('tiene los nueve tipos validados, en el orden del catálogo', () => {
    expect(CATALOGO_TIPOS_DOCUMENTO.map((tipo) => tipo.nombre)).toEqual([
      'Factura',
      'Print',
      'Constancia escrita',
      'CAE',
      'OC',
      'Constancia ARCA',
      'Libre deuda',
      'Pago IIBB',
      'Constancia IIBB',
    ]);
  });

  it('solo OC tiene descripción: es la única confirmada por el negocio', () => {
    const conDescripcion = CATALOGO_TIPOS_DOCUMENTO.filter((tipo) => tipo.descripcion !== null);
    expect(conDescripcion).toEqual([{ nombre: 'OC', descripcion: 'Orden de compra' }]);
  });

  it('ningún tipo del catálogo choca con otro por la clave normalizada', () => {
    const claves = clavesDelCatalogo();
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('cada renombre termina en un tipo del catálogo y parte de uno que ya no está', () => {
    const claves = new Set(clavesDelCatalogo());
    expect(RENOMBRES_TIPOS_DOCUMENTO).toEqual([{ anterior: 'Orden de compra', nuevo: 'OC' }]);
    for (const { anterior, nuevo } of RENOMBRES_TIPOS_DOCUMENTO) {
      expect(claves.has(normalizar(nuevo))).toBe(true);
      expect(claves.has(normalizar(anterior))).toBe(false);
    }
  });
});
