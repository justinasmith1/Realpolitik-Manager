import { describe, expect, it } from 'vitest';

import { INDICACIONES_ARMADO_MAX, IndicacionesArmadoSchema } from './indicacionesArmado.schema.js';

describe('IndicacionesArmadoSchema', () => {
  it('el tope es el de la columna: 1000', () => {
    expect(INDICACIONES_ARMADO_MAX).toBe(1000);
  });

  it('acepta un texto y lo recorta', () => {
    expect(IndicacionesArmadoSchema.parse({ indicacionesArmado: '  Factura primero.  ' })).toEqual({
      indicacionesArmado: 'Factura primero.',
    });
  });

  it('null las borra', () => {
    expect(IndicacionesArmadoSchema.parse({ indicacionesArmado: null })).toEqual({
      indicacionesArmado: null,
    });
  });

  it.each(['', '   ', ' \n \r\n '])(
    'un texto vacío o en blanco (%j) se guarda como null',
    (texto) => {
      expect(IndicacionesArmadoSchema.parse({ indicacionesArmado: texto })).toEqual({
        indicacionesArmado: null,
      });
    },
  );

  it('la clave es obligatoria', () => {
    const r = IndicacionesArmadoSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['indicacionesArmado']);
      expect(r.error.issues[0]?.message).toBe(
        'Enviá "indicacionesArmado": un texto, o null para borrarlas.',
      );
    }
  });

  it.each([5, true, ['a']])('rechaza lo que no es texto ni null (%j)', (valor) => {
    const r = IndicacionesArmadoSchema.safeParse({ indicacionesArmado: valor });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['indicacionesArmado']);
  });

  it('admite saltos de línea (\\n y \\r\\n) y no los normaliza', () => {
    const texto = 'Ordenar los prints por fecha.\nFactura siempre primero.\r\nSin grapas.';
    expect(IndicacionesArmadoSchema.parse({ indicacionesArmado: texto })).toEqual({
      indicacionesArmado: texto,
    });
  });

  it('mide el largo sobre el texto recortado: 1000 sí, 1001 no', () => {
    expect(
      IndicacionesArmadoSchema.safeParse({ indicacionesArmado: ` ${'a'.repeat(1000)} ` }).success,
    ).toBe(true);
    const r = IndicacionesArmadoSchema.safeParse({ indicacionesArmado: 'a'.repeat(1001) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'Las indicaciones de armado no pueden superar los 1000 caracteres.',
      );
    }
  });

  it.each(['a\tb', 'a\u0000b', 'a\u001Bb', 'a\u007Fb', 'a\u0085b'])(
    'el resto de los caracteres de control sigue rechazado (%j)',
    (texto) => {
      const r = IndicacionesArmadoSchema.safeParse({ indicacionesArmado: texto });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.message).toBe(
          'Las indicaciones de armado no pueden contener caracteres de control, salvo saltos de línea.',
        );
      }
    },
  );
});
