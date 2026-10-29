import { describe, expect, it } from 'vitest';

import {
  ErrorAlmacenamiento,
  esClaveValida,
  esErrorAlmacenamiento,
  exigirClaveValida,
  generarClaveDocumento,
  noDisponible,
} from '../almacenamiento';

import { CLAVES_INVALIDAS } from './contratoAlmacenamiento';

describe('claves de almacenamiento', () => {
  it('genera claves opacas: documentos/ + un UUID v4, distintas cada vez', () => {
    const claves = new Set(Array.from({ length: 100 }, () => generarClaveDocumento()));
    expect(claves.size).toBe(100);
    for (const clave of claves) {
      expect(clave).toMatch(/^documentos\/[0-9a-f-]{36}$/);
      expect(esClaveValida(clave)).toBe(true);
    }
  });

  it('acepta una clave guardada en la base con la forma correcta', () => {
    const clave = generarClaveDocumento();
    expect(exigirClaveValida(String(clave))).toBe(clave);
  });

  it.each(CLAVES_INVALIDAS)('rechaza una clave %s', (_caso, clave) => {
    expect(esClaveValida(clave)).toBe(false);
    expect(() => exigirClaveValida(clave)).toThrow(ErrorAlmacenamiento);
  });
});

describe('ErrorAlmacenamiento', () => {
  it('conserva la causa técnica pero no la muestra en el mensaje', () => {
    const causa = new Error('connect ECONNREFUSED https://secreto.example/bucket');
    const error = noDisponible('guardar el objeto', causa);

    expect(error.codigo).toBe('NO_DISPONIBLE');
    expect(error.cause).toBe(causa);
    expect(error.message).toBe('No se pudo guardar el objeto en el almacenamiento.');
    expect(error.message).not.toContain('secreto');
  });

  it('esErrorAlmacenamiento distingue por código', () => {
    const error = noDisponible('leer el objeto', null);
    expect(esErrorAlmacenamiento(error)).toBe(true);
    expect(esErrorAlmacenamiento(error, 'NO_DISPONIBLE')).toBe(true);
    expect(esErrorAlmacenamiento(error, 'YA_EXISTE')).toBe(false);
    expect(esErrorAlmacenamiento(new Error('otro'))).toBe(false);
  });
});
