import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActualizarEstadoRendicionSchema,
  CreateRendicionSchema,
  ItemChecklistSchema,
  MENSAJE_NUMERO_FACTURA_FORMATO,
  normalizarNumeroFactura,
  NUMERO_FACTURA_EJEMPLO,
  NumeroFacturaSchema,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
} from './rendicion.schema.js';

const ID = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const REQUISITO_ID = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const TIPO_ID = 'c1d2e3f4-a5b6-4789-8abc-def012345678';

function errores(r: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return (r.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('NumeroFacturaSchema', () => {
  it('acepta el formato canónico tal cual', () => {
    expect(NumeroFacturaSchema.parse('B 00002-00001482')).toBe('B 00002-00001482');
    expect(NUMERO_FACTURA_EJEMPLO).toBe('B 00002-00001482');
  });

  it.each([
    ['letra en minúscula y números cortos', 'b 2-1482'],
    ['sin espacio después de la letra', 'B2-1482'],
    ['con espacios alrededor del guion', 'b 00002 - 00001482'],
    ['con espacios en los bordes', '  b 2-1482  '],
    ['con todos los ceros', 'B 00002-00001482'],
  ])('normaliza %s a la forma canónica', (_caso, valor) => {
    expect(NumeroFacturaSchema.parse(valor)).toBe('B 00002-00001482');
  });

  it.each([
    ['A 1-1', 'A 00001-00000001'],
    ['c 99999-99999999', 'C 99999-99999999'],
  ])('completa con ceros a la izquierda: %s → %s', (valor, canonico) => {
    expect(NumeroFacturaSchema.parse(valor)).toBe(canonico);
  });

  it('normalizarNumeroFactura devuelve la forma canónica o null', () => {
    expect(normalizarNumeroFactura('b 2-1482')).toBe('B 00002-00001482');
    expect(normalizarNumeroFactura('FC-0001')).toBeNull();
  });

  it.each([
    ['sin letra', '00002-00001482'],
    ['con la letra D', 'D 00002-00001482'],
    ['con un punto de venta de 6 dígitos', 'B 000002-00001482'],
    ['con un número de 9 dígitos', 'B 00002-000001482'],
    ['con letras en el número', 'B 00002-0000148A'],
    ['sin guion', 'B 00002 00001482'],
    ['con el formato viejo', 'FC-0001'],
    ['con dos letras', 'AB 00002-00001482'],
    ['con una tabulación entre las partes', 'B\t00002-00001482'],
    ['con dígitos no ASCII', 'B ٠٠٠٠٢-٠٠٠٠١٤٨٢'],
  ])('rechaza un número %s, diciendo el formato esperado con un ejemplo', (_caso, valor) => {
    expect(errores(NumeroFacturaSchema.safeParse(valor))).toEqual([
      { path: [], message: MENSAJE_NUMERO_FACTURA_FORMATO },
    ]);
    expect(MENSAJE_NUMERO_FACTURA_FORMATO).toContain('B 00002-00001482');
  });

  it.each(['', '   '])('rechaza un número vacío o de solo espacios (%j)', (valor) => {
    expect(errores(NumeroFacturaSchema.safeParse(valor))).toEqual([
      { path: [], message: 'El número de factura es obligatorio.' },
    ]);
  });

  it.each([undefined, null, 123, true])('rechaza lo que no es texto (%j)', (valor) => {
    expect(NumeroFacturaSchema.safeParse(valor).success).toBe(false);
  });
});

describe('CreateRendicionSchema', () => {
  const AHORA = new Date('2026-10-15T12:00:00-03:00');
  const pedido = { anio: 2026, mes: 10, numeroFactura: 'B 00002-00001482' };

  function conFecha(fecha: Date) {
    vi.useFakeTimers();
    vi.setSystemTime(fecha);
  }

  it('acepta el pedido del contrato', () => {
    conFecha(AHORA);
    expect(CreateRendicionSchema.parse(pedido)).toEqual(pedido);
  });

  it('normaliza el número de factura a su forma canónica', () => {
    conFecha(AHORA);
    expect(
      CreateRendicionSchema.parse({ ...pedido, numeroFactura: ' b 2-1482 ' }).numeroFactura,
    ).toBe('B 00002-00001482');
  });

  it('un número con formato inválido es un error en `numeroFactura`', () => {
    conFecha(AHORA);
    expect(
      errores(CreateRendicionSchema.safeParse({ ...pedido, numeroFactura: 'FC-0001' })),
    ).toEqual([{ path: ['numeroFactura'], message: MENSAJE_NUMERO_FACTURA_FORMATO }]);
  });

  it('descarta lo que no es del pedido: no hay decisiones de condicionales', () => {
    conFecha(AHORA);
    const r = CreateRendicionSchema.parse({
      ...pedido,
      decisiones: [{ requisitoId: REQUISITO_ID, aplica: false }],
      clienteId: CLIENTE_ID,
    });
    expect(Object.keys(r).sort()).toEqual(['anio', 'mes', 'numeroFactura']);
  });

  it('exige anio, mes y numeroFactura, cada uno en su path', () => {
    conFecha(AHORA);
    const e = errores(CreateRendicionSchema.safeParse({}));
    expect(e.map((x) => x.path)).toEqual([['anio'], ['mes'], ['numeroFactura']]);
  });

  describe('anio', () => {
    it.each([2020, 2026, 2100])('acepta %i', (anio) => {
      conFecha(AHORA);
      // Con mes 1: 2100 sería futuro, así que se mide solo la regla del año.
      const r = CreateRendicionSchema.safeParse({ ...pedido, anio, mes: 1 });
      expect(errores(r).filter((x) => x.path[0] === 'anio')).toEqual([]);
    });

    it.each([2019, 2101, 0, -2026, 2026.5, '2026', null, NaN])('rechaza %j', (anio) => {
      conFecha(AHORA);
      const e = errores(CreateRendicionSchema.safeParse({ ...pedido, anio }));
      expect(e).toHaveLength(1);
      expect(e[0]?.path).toEqual(['anio']);
      expect(e[0]?.message).toBe('El año debe ser un número entero entre 2020 y 2100.');
    });
  });

  describe('mes', () => {
    it.each([0, 13, 1.5, '10', null, NaN])('rechaza %j', (mes) => {
      conFecha(AHORA);
      const e = errores(CreateRendicionSchema.safeParse({ ...pedido, mes }));
      expect(e).toHaveLength(1);
      expect(e[0]?.path).toEqual(['mes']);
      expect(e[0]?.message).toBe('El mes debe ser un número entero entre 1 y 12.');
    });
  });

  describe('período', () => {
    it('el mes actual es válido', () => {
      conFecha(AHORA);
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 10 }).success).toBe(
        true,
      );
    });

    it('cualquier mes pasado es válido, incluso años atrás', () => {
      conFecha(AHORA);
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 9 }).success).toBe(true);
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2020, mes: 1 }).success).toBe(true);
    });

    it('el mes siguiente es válido', () => {
      conFecha(AHORA);
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 11 }).success).toBe(
        true,
      );
    });

    it('dos meses adelante se rechaza, con el error en `mes`', () => {
      conFecha(AHORA);
      expect(errores(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 12 }))).toEqual([
        {
          path: ['mes'],
          message: 'El período no puede ser posterior al mes siguiente al actual.',
        },
      ]);
    });

    it('un año posterior se rechaza, siempre con el error en `mes`', () => {
      conFecha(AHORA);
      const e = errores(CreateRendicionSchema.safeParse({ ...pedido, anio: 2027, mes: 1 }));
      expect(e.map((x) => x.path)).toEqual([['mes']]);
    });

    it('borde del mes: a las 23:30 del 31 de octubre en Argentina todavía es octubre', () => {
      conFecha(new Date('2026-10-31T23:30:00-03:00')); // en UTC ya es noviembre
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 11 }).success).toBe(
        true,
      );
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 12 }).success).toBe(
        false,
      );
    });

    it('pasada la medianoche argentina, diciembre pasa a ser el mes siguiente', () => {
      conFecha(new Date('2026-11-01T00:30:00-03:00'));
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 12 }).success).toBe(
        true,
      );
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2027, mes: 1 }).success).toBe(
        false,
      );
    });

    it('en diciembre el mes siguiente es enero del año que viene', () => {
      conFecha(new Date('2026-12-15T12:00:00-03:00'));
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2027, mes: 1 }).success).toBe(true);
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2027, mes: 2 }).success).toBe(
        false,
      );
    });

    it('la fecha se lee al validar, no al crear el schema', () => {
      conFecha(AHORA);
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 12 }).success).toBe(
        false,
      );
      vi.setSystemTime(new Date('2026-11-15T12:00:00-03:00'));
      expect(CreateRendicionSchema.safeParse({ ...pedido, anio: 2026, mes: 12 }).success).toBe(
        true,
      );
    });

    it('un mes o año inválido no suma el error de período', () => {
      conFecha(AHORA);
      expect(
        errores(CreateRendicionSchema.safeParse({ ...pedido, anio: 2100, mes: 13 })),
      ).toHaveLength(1);
      expect(
        errores(CreateRendicionSchema.safeParse({ ...pedido, anio: 2101, mes: 1 })),
      ).toHaveLength(1);
    });
  });

  it('un número de factura inválido se informa en su campo', () => {
    conFecha(AHORA);
    const e = errores(CreateRendicionSchema.safeParse({ ...pedido, numeroFactura: '  ' }));
    expect(e).toEqual([
      { path: ['numeroFactura'], message: 'El número de factura es obligatorio.' },
    ]);
  });
});

describe('ActualizarEstadoRendicionSchema', () => {
  it("acepta solo 'ANULADA'", () => {
    expect(ActualizarEstadoRendicionSchema.parse({ estado: 'ANULADA' })).toEqual({
      estado: 'ANULADA',
    });
  });

  it.each([{ estado: 'ACTIVA' }, { estado: 'anulada' }, { estado: 'OTRO' }, { estado: null }, {}])(
    'rechaza %j con un mensaje en español',
    (cuerpo) => {
      const e = errores(ActualizarEstadoRendicionSchema.safeParse(cuerpo));
      expect(e).toEqual([
        {
          path: ['estado'],
          message: 'El estado solo puede ser ANULADA: una rendición anulada no se reactiva.',
        },
      ]);
    },
  );
});

describe('entidades de lectura', () => {
  const item = {
    id: 'f1a2b3c4-d5e6-4789-8abc-def012345678',
    requisitoClienteId: REQUISITO_ID,
    tipoDocumentoId: TIPO_ID,
    nombreTipoDocumento: 'Print',
    ordinal: 1,
    totalOrdinal: 3,
    diaAproximado: 1,
    canalEntrega: 'CORREO',
    completado: false,
    completadoEn: null,
    creadoEn: '2026-10-20T12:00:00.000Z',
    actualizadoEn: '2026-10-20T12:00:00.000Z',
  };

  const rendicion = {
    id: ID,
    clienteId: CLIENTE_ID,
    anio: 2026,
    mes: 10,
    numeroFactura: '0001-00001234',
    estado: 'ACTIVA',
    anuladaEn: null,
    creadoEn: '2026-10-20T12:00:00.000Z',
    actualizadoEn: '2026-10-20T12:00:00.000Z',
  };

  describe('ItemChecklistSchema', () => {
    it('lee el ítem del contrato y convierte las fechas', () => {
      const r = ItemChecklistSchema.parse(item);
      expect(r.creadoEn).toBeInstanceOf(Date);
      expect(r.completadoEn).toBeNull();
    });

    it('un ítem completado trae su fecha', () => {
      const r = ItemChecklistSchema.parse({
        ...item,
        completado: true,
        completadoEn: '2026-10-21T09:00:00.000Z',
      });
      expect(r.completadoEn).toBeInstanceOf(Date);
    });

    it('diaAproximado puede ser null', () => {
      expect(ItemChecklistSchema.parse({ ...item, diaAproximado: null }).diaAproximado).toBeNull();
    });

    it('el canal efectivo nunca es null', () => {
      expect(ItemChecklistSchema.safeParse({ ...item, canalEntrega: null }).success).toBe(false);
      expect(ItemChecklistSchema.safeParse({ ...item, canalEntrega: 'FAX' }).success).toBe(false);
    });

    it('no aplica reglas de escritura: no reordena ni exige coherencia con nada', () => {
      expect(ItemChecklistSchema.parse({ ...item, ordinal: 2, totalOrdinal: 2 }).ordinal).toBe(2);
    });

    it('exige los campos del snapshot', () => {
      const { nombreTipoDocumento: _n, ...sinNombre } = item;
      expect(ItemChecklistSchema.safeParse(sinNombre).success).toBe(false);
    });
  });

  describe('RendicionSchema', () => {
    it('lee la rendición activa', () => {
      const r = RendicionSchema.parse(rendicion);
      expect(r.estado).toBe('ACTIVA');
      expect(r.anuladaEn).toBeNull();
    });

    it('lee la rendición anulada con su fecha', () => {
      const r = RendicionSchema.parse({
        ...rendicion,
        estado: 'ANULADA',
        anuladaEn: '2026-10-22T10:00:00.000Z',
      });
      expect(r.estado).toBe('ANULADA');
      expect(r.anuladaEn).toBeInstanceOf(Date);
    });

    it('el número de factura es un string simple: al leer no se normaliza ni se valida el formato', () => {
      expect(RendicionSchema.parse({ ...rendicion, numeroFactura: ' fc-1 ' }).numeroFactura).toBe(
        ' fc-1 ',
      );
    });

    it('no aplica la regla del período al leer', () => {
      expect(RendicionSchema.safeParse({ ...rendicion, anio: 2099, mes: 12 }).success).toBe(true);
    });

    it('rechaza un estado desconocido', () => {
      expect(RendicionSchema.safeParse({ ...rendicion, estado: 'BORRADA' }).success).toBe(false);
    });

    it('anuladaEn es obligatorio (puede ser null)', () => {
      const { anuladaEn: _a, ...sinAnulada } = rendicion;
      expect(RendicionSchema.safeParse(sinAnulada).success).toBe(false);
    });
  });

  describe('RendicionDetalleSchema', () => {
    it('suma los ítems', () => {
      const r = RendicionDetalleSchema.parse({ ...rendicion, items: [item] });
      expect(r.items).toHaveLength(1);
      expect(r.items[0]?.nombreTipoDocumento).toBe('Print');
    });

    it('items es obligatorio, aunque puede ser una lista vacía', () => {
      expect(RendicionDetalleSchema.safeParse(rendicion).success).toBe(false);
      expect(RendicionDetalleSchema.safeParse({ ...rendicion, items: [] }).success).toBe(true);
    });

    it('valida cada ítem, con su path', () => {
      const e = errores(
        RendicionDetalleSchema.safeParse({
          ...rendicion,
          items: [item, { ...item, ordinal: 'x' }],
        }),
      );
      expect(e[0]?.path).toEqual(['items', 1, 'ordinal']);
    });
  });

  describe('RendicionResumenSchema', () => {
    it('suma el resumen de avance y no lleva ítems', () => {
      const r = RendicionResumenSchema.parse({
        ...rendicion,
        resumen: { totalItems: 4, completados: 1 },
      });
      expect(r.resumen).toEqual({ totalItems: 4, completados: 1 });
      expect('items' in r).toBe(false);
    });

    it('resumen es obligatorio y sus contadores no son negativos', () => {
      expect(RendicionResumenSchema.safeParse(rendicion).success).toBe(false);
      expect(
        RendicionResumenSchema.safeParse({
          ...rendicion,
          resumen: { totalItems: 0, completados: 0 },
        }).success,
      ).toBe(true);
      expect(
        RendicionResumenSchema.safeParse({
          ...rendicion,
          resumen: { totalItems: -1, completados: 0 },
        }).success,
      ).toBe(false);
    });
  });
});
