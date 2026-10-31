import { describe, expect, it } from 'vitest';

import {
  editarOcResolver,
  montoEscrito,
  ocVacia,
  type EditarOcFormValues,
} from '@/modules/rendiciones/components/editarOcForm.validation';
import { etiquetaDeMonto, etiquetaDeNumeroOc } from '@/modules/rendiciones/rendiciones.etiquetas';

const VACIO: EditarOcFormValues = { numeroOc: '', montoMensual: '', montoTotal: '' };
const sinContexto = {
  criteriaMode: 'firstError',
  fields: {},
  shouldUseNativeValidation: false,
} as const;

describe('montoEscrito', () => {
  it.each([
    ['1250000', 1250000],
    ['1250000,50', 1250000.5],
    ['1250000.50', 1250000.5],
    ['1.250.000', 1250000],
    ['1.250.000,5', 1250000.5],
    ['1.250.000,50', 1250000.5],
    ['  ', null],
    ['', null],
  ])('%j → %s', (texto, esperado) => {
    expect(montoEscrito(texto)).toBe(esperado);
  });

  it('da NaN con texto que no es un número', () => {
    expect(montoEscrito('abc')).toBeNaN();
  });

  // `Number()` solo aceptaría `1e5` (100000), `0x10` (16) y los signos.
  it.each(['1e5', '0x10', '-4', '+5'])(
    'da NaN con %j: solo acepta dígitos, puntos y comas',
    (texto) => {
      expect(montoEscrito(texto)).toBeNaN();
    },
  );
});

describe('etiquetas de la OC', () => {
  it('formatea un monto entero como moneda argentina, sin decimales', () => {
    expect(etiquetaDeMonto(1250000).replace(/\s/g, ' ')).toBe('$ 1.250.000');
  });

  it('con centavos, siempre muestra dos decimales', () => {
    expect(etiquetaDeMonto(1250000.5).replace(/\s/g, ' ')).toBe('$ 1.250.000,50');
    expect(etiquetaDeMonto(1250000.05).replace(/\s/g, ' ')).toBe('$ 1.250.000,05');
  });

  it('sin monto, un guion', () => {
    expect(etiquetaDeMonto(null)).toBe('-');
  });

  it('sin número, "No asignada"', () => {
    expect(etiquetaDeNumeroOc(null)).toBe('No asignada');
    expect(etiquetaDeNumeroOc('OC-1')).toBe('OC-1');
  });
});

describe('ocVacia', () => {
  it('es verdadero solo sin ningún dato', () => {
    expect(ocVacia(VACIO)).toBe(true);
    expect(ocVacia({ ...VACIO, montoTotal: '1' })).toBe(false);
  });
});

describe('editarOcResolver', () => {
  it('manda null en los campos vacíos', async () => {
    const resultado = await editarOcResolver(VACIO, undefined, sinContexto);
    expect(resultado.values).toEqual({ numeroOc: null, montoMensual: null, montoTotal: null });
  });

  it('entrega los datos normalizados', async () => {
    const resultado = await editarOcResolver(
      { numeroOc: ' OC-9 ', montoMensual: '1.000,50', montoTotal: '12000' },
      undefined,
      sinContexto,
    );
    expect(resultado.values).toEqual({ numeroOc: 'OC-9', montoMensual: 1000.5, montoTotal: 12000 });
  });

  it('marca el campo con un monto inválido', async () => {
    const resultado = await editarOcResolver(
      { ...VACIO, montoMensual: 'abc', montoTotal: '-4' },
      undefined,
      sinContexto,
    );
    expect(resultado.errors.montoMensual?.message).toBeDefined();
    expect(resultado.errors.montoTotal?.message).toBeDefined();
    expect(resultado.errors.numeroOc).toBeUndefined();
  });
});
