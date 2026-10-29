import { describe, expect, it } from 'vitest';

import {
  OBSERVACIONES_CLIENTE_MAX,
  ObservacionesClienteLecturaSchema,
  ObservacionesClienteSchema,
} from './observacionesCliente.schema.js';

describe('ObservacionesClienteSchema', () => {
  it('el tope es el de la columna: 1000', () => {
    expect(OBSERVACIONES_CLIENTE_MAX).toBe(1000);
  });

  it('acepta un texto y lo recorta', () => {
    expect(ObservacionesClienteSchema.parse({ observaciones: '  Cambió el mail.  ' })).toEqual({
      observaciones: 'Cambió el mail.',
    });
  });

  it('null las borra', () => {
    expect(ObservacionesClienteSchema.parse({ observaciones: null })).toEqual({
      observaciones: null,
    });
  });

  it.each(['', '   ', ' \n \r\n '])(
    'un texto vacío o en blanco (%j) se guarda como null',
    (texto) => {
      expect(ObservacionesClienteSchema.parse({ observaciones: texto })).toEqual({
        observaciones: null,
      });
    },
  );

  it('la clave es obligatoria', () => {
    const r = ObservacionesClienteSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['observaciones']);
      expect(r.error.issues[0]?.message).toBe(
        'Enviá "observaciones": un texto, o null para borrarlas.',
      );
    }
  });

  it.each([5, true, ['a']])('rechaza lo que no es texto ni null (%j)', (valor) => {
    const r = ObservacionesClienteSchema.safeParse({ observaciones: valor });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['observaciones']);
  });

  it('admite saltos de línea (\\n y \\r\\n) y no los normaliza', () => {
    const texto = 'Pausó la pauta.\nRetoma en marzo.\r\nAvisar a Compras.';
    expect(ObservacionesClienteSchema.parse({ observaciones: texto })).toEqual({
      observaciones: texto,
    });
  });

  it('mide el largo sobre el texto recortado: 1000 sí, 1001 no', () => {
    expect(
      ObservacionesClienteSchema.safeParse({ observaciones: ` ${'a'.repeat(1000)} ` }).success,
    ).toBe(true);
    const r = ObservacionesClienteSchema.safeParse({ observaciones: 'a'.repeat(1001) });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'Las observaciones no pueden superar los 1000 caracteres.',
      );
    }
  });

  it.each([
    ['una tabulación', 'a\tb'],
    ['un NUL', 'a\u0000b'],
    ['un ESC', 'a\u001Bb'],
    ['un DEL', 'a\u007Fb'],
    ['un carácter C1 (NEL)', 'a\u0085b'],
  ])('el resto de los caracteres de control sigue rechazado: %s', (_descripcion, texto) => {
    const r = ObservacionesClienteSchema.safeParse({ observaciones: texto });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        'Las observaciones no pueden contener caracteres de control, salvo saltos de línea.',
      );
    }
  });
});

describe('ObservacionesClienteLecturaSchema', () => {
  const CON_TAB = 'Cambió\tel mail.\nAvisar a Compras.';

  it('un valor con tabulación se lee bien, tal cual, pero no se puede guardar', () => {
    expect(ObservacionesClienteLecturaSchema.parse({ observaciones: CON_TAB })).toEqual({
      observaciones: CON_TAB,
    });
    expect(ObservacionesClienteSchema.safeParse({ observaciones: CON_TAB }).success).toBe(false);
  });

  it.each(['a\u0000b', 'a\u001Bb', 'a\u0085b'])(
    'tampoco rechaza otros caracteres de control al leer (%j)',
    (texto) => {
      expect(ObservacionesClienteLecturaSchema.parse({ observaciones: texto })).toEqual({
        observaciones: texto,
      });
    },
  );

  it('acepta null y respeta el largo de la columna', () => {
    expect(ObservacionesClienteLecturaSchema.parse({ observaciones: null })).toEqual({
      observaciones: null,
    });
    expect(
      ObservacionesClienteLecturaSchema.safeParse({
        observaciones: 'a'.repeat(OBSERVACIONES_CLIENTE_MAX + 1),
      }).success,
    ).toBe(false);
  });
});
