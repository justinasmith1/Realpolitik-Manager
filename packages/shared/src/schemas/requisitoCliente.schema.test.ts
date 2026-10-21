import { describe, expect, it } from 'vitest';

import { CANTIDAD_MAX } from '../utils/diasAproximados.js';

import {
  CreateRequisitoClienteSchema,
  RequisitoClienteSchema,
  UpdateRequisitoClienteSchema,
} from './requisitoCliente.schema.js';

const TIPO_ID = 'c1d2e3f4-a5b6-4789-8abc-def012345678';

/** Mensajes de los issues de un parse fallido, con su path. */
function errores(r: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (r.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }));
}

describe('CreateRequisitoClienteSchema', () => {
  it('solo el tipo es obligatorio: el resto toma sus defaults', () => {
    expect(CreateRequisitoClienteSchema.parse({ tipoDocumentoId: TIPO_ID })).toEqual({
      tipoDocumentoId: TIPO_ID,
      cantidad: 1,
      diasAproximados: [],
      canalEntrega: null,
      nota: null,
    });
  });

  it('acepta el pedido completo del contrato', () => {
    const pedido = {
      tipoDocumentoId: TIPO_ID,
      cantidad: 3,
      diasAproximados: [1, 10, 20],
      canalEntrega: 'PORTAL_WEB',
      nota: 'Prints de la pauta',
    };
    expect(CreateRequisitoClienteSchema.parse(pedido)).toEqual(pedido);
  });

  it('exige tipoDocumentoId y que sea uuid', () => {
    expect(errores(CreateRequisitoClienteSchema.safeParse({}))[0]?.path).toEqual([
      'tipoDocumentoId',
    ]);
    expect(
      errores(CreateRequisitoClienteSchema.safeParse({ tipoDocumentoId: 'abc' }))[0]?.path,
    ).toEqual(['tipoDocumentoId']);
  });

  it('ignora clienteId, fechas y baja lógica', () => {
    const r = CreateRequisitoClienteSchema.parse({
      tipoDocumentoId: TIPO_ID,
      clienteId: TIPO_ID,
      isDeleted: true,
    });
    expect(Object.keys(r).sort()).toEqual([
      'canalEntrega',
      'cantidad',
      'diasAproximados',
      'nota',
      'tipoDocumentoId',
    ]);
  });

  describe('cantidad', () => {
    it.each([1, 5, CANTIDAD_MAX])('acepta %i', (cantidad) => {
      expect(
        CreateRequisitoClienteSchema.parse({ tipoDocumentoId: TIPO_ID, cantidad }).cantidad,
      ).toBe(cantidad);
    });

    it.each([0, -1, 1.5, CANTIDAD_MAX + 1, '3', null, NaN])('rechaza %j', (cantidad) => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({ tipoDocumentoId: TIPO_ID, cantidad }),
      );
      expect(e).toHaveLength(1);
      expect(e[0]?.path).toEqual(['cantidad']);
    });

    it('el mensaje del tope nombra el máximo', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          cantidad: CANTIDAD_MAX + 1,
        }),
      );
      expect(e[0]?.message).toContain(String(CANTIDAD_MAX));
    });
  });

  describe('diasAproximados', () => {
    it('los ordena ascendente para que el ítem N tome el día N', () => {
      const r = CreateRequisitoClienteSchema.parse({
        tipoDocumentoId: TIPO_ID,
        cantidad: 4,
        diasAproximados: [22, 1, 15, 8],
      });
      expect(r.diasAproximados).toEqual([1, 8, 15, 22]);
    });

    it('admite repetidos y los conserva', () => {
      const r = CreateRequisitoClienteSchema.parse({
        tipoDocumentoId: TIPO_ID,
        cantidad: 3,
        diasAproximados: [15, 1, 15],
      });
      expect(r.diasAproximados).toEqual([1, 15, 15]);
    });

    it('no modifica el arreglo que recibe', () => {
      const dias = [20, 5];
      CreateRequisitoClienteSchema.parse({
        tipoDocumentoId: TIPO_ID,
        cantidad: 2,
        diasAproximados: dias,
      });
      expect(dias).toEqual([20, 5]);
    });

    it('acepta los bordes 1 y 31', () => {
      const r = CreateRequisitoClienteSchema.parse({
        tipoDocumentoId: TIPO_ID,
        cantidad: 2,
        diasAproximados: [31, 1],
      });
      expect(r.diasAproximados).toEqual([1, 31]);
    });

    it.each([0, 32, -3, 1.5])('rechaza el día %j, en la posición del elemento', (dia) => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          cantidad: 2,
          diasAproximados: [5, dia],
        }),
      );
      expect(e).toHaveLength(1);
      expect(e[0]?.path).toEqual(['diasAproximados', 1]);
    });

    it('un NaN (días mal escritos en el front) se rechaza con un mensaje claro', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          cantidad: 2,
          diasAproximados: [1, NaN],
        }),
      );
      expect(e).toEqual([
        {
          path: ['diasAproximados', 1],
          message: 'Cada día aproximado debe ser un número entero entre 1 y 31.',
        },
      ]);
    });

    it('rechaza que no sea una lista', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          diasAproximados: '1,8',
        }),
      );
      expect(e[0]?.path).toEqual(['diasAproximados']);
    });

    it('con menos días que la cantidad: error en diasAproximados', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          cantidad: 3,
          diasAproximados: [1, 10],
        }),
      );
      expect(e).toEqual([
        {
          path: ['diasAproximados'],
          message: 'Cargá 3 días aproximados (uno por documento) o dejá la lista vacía.',
        },
      ]);
    });

    it('con más días que la cantidad: error en diasAproximados', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          diasAproximados: [1, 10],
        }),
      );
      expect(e[0]?.path).toEqual(['diasAproximados']);
    });

    it('una lista de más de CANTIDAD_MAX días se corta antes de ordenar', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          cantidad: CANTIDAD_MAX,
          diasAproximados: Array.from({ length: CANTIDAD_MAX + 1 }, () => 1),
        }),
      );
      expect(e).toHaveLength(1);
      expect(e[0]?.path).toEqual(['diasAproximados']);
    });
  });

  describe('canalEntrega', () => {
    it.each(['CORREO', 'PORTAL_WEB', 'WHATSAPP', null])('acepta %j', (canalEntrega) => {
      expect(
        CreateRequisitoClienteSchema.parse({ tipoDocumentoId: TIPO_ID, canalEntrega }).canalEntrega,
      ).toBe(canalEntrega);
    });

    it('rechaza un canal desconocido, en español', () => {
      const e = errores(
        CreateRequisitoClienteSchema.safeParse({ tipoDocumentoId: TIPO_ID, canalEntrega: 'FAX' }),
      );
      expect(e).toEqual([
        {
          path: ['canalEntrega'],
          message: 'El canal de entrega debe ser CORREO, PORTAL_WEB o WHATSAPP.',
        },
      ]);
    });
  });

  describe('nota', () => {
    it('se recorta; vacía o en blanco es null', () => {
      const parse = (nota: unknown) =>
        CreateRequisitoClienteSchema.parse({ tipoDocumentoId: TIPO_ID, nota }).nota;
      expect(parse('  hola  ')).toBe('hola');
      expect(parse('')).toBeNull();
      expect(parse('   ')).toBeNull();
      expect(parse(null)).toBeNull();
    });

    it('500 caracteres sí, 501 no', () => {
      const parse = (largo: number) =>
        CreateRequisitoClienteSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          nota: 'a'.repeat(largo),
        });
      expect(parse(500).success).toBe(true);
      expect(errores(parse(501))[0]?.path).toEqual(['nota']);
    });

    it('rechaza caracteres de control, también saltos de línea', () => {
      for (const nota of ['a\u0000b', 'a\nb']) {
        const e = errores(
          CreateRequisitoClienteSchema.safeParse({ tipoDocumentoId: TIPO_ID, nota }),
        );
        expect(e[0]?.path).toEqual(['nota']);
      }
    });
  });
});

describe('UpdateRequisitoClienteSchema', () => {
  it('sin defaults: lo ausente queda ausente', () => {
    expect(UpdateRequisitoClienteSchema.parse({ nota: 'x' })).toEqual({ nota: 'x' });
    expect(UpdateRequisitoClienteSchema.parse({ cantidad: 2 })).toEqual({ cantidad: 2 });
  });

  it('rechaza un pedido vacío', () => {
    const e = errores(UpdateRequisitoClienteSchema.safeParse({}));
    expect(e).toEqual([{ path: [], message: 'Enviá al menos un campo para modificar.' }]);
  });

  it('canalEntrega: null quita el override y nota: null la borra', () => {
    expect(UpdateRequisitoClienteSchema.parse({ canalEntrega: null })).toEqual({
      canalEntrega: null,
    });
    expect(UpdateRequisitoClienteSchema.parse({ nota: null })).toEqual({ nota: null });
    expect(UpdateRequisitoClienteSchema.parse({ nota: '  ' })).toEqual({ nota: null });
  });

  it('el tipo no es editable: si llega, se ignora', () => {
    expect(UpdateRequisitoClienteSchema.parse({ cantidad: 2, tipoDocumentoId: TIPO_ID })).toEqual({
      cantidad: 2,
    });
    expect(UpdateRequisitoClienteSchema.safeParse({ tipoDocumentoId: TIPO_ID }).success).toBe(
      false,
    );
  });

  it('ordena los días al guardar', () => {
    expect(UpdateRequisitoClienteSchema.parse({ diasAproximados: [20, 5] })).toEqual({
      diasAproximados: [5, 20],
    });
  });

  it('solo días: no se valida la coherencia (la cantidad guardada la valida el backend)', () => {
    expect(UpdateRequisitoClienteSchema.safeParse({ diasAproximados: [1, 2, 3] }).success).toBe(
      true,
    );
  });

  it('solo cantidad: no se valida la coherencia', () => {
    expect(UpdateRequisitoClienteSchema.safeParse({ cantidad: 7 }).success).toBe(true);
  });

  it('cantidad y días juntos: se valida la coherencia', () => {
    expect(UpdateRequisitoClienteSchema.parse({ cantidad: 2, diasAproximados: [10, 3] })).toEqual({
      cantidad: 2,
      diasAproximados: [3, 10],
    });
    const e = errores(
      UpdateRequisitoClienteSchema.safeParse({ cantidad: 3, diasAproximados: [1] }),
    );
    expect(e).toEqual([
      {
        path: ['diasAproximados'],
        message: 'Cargá 3 días aproximados (uno por documento) o dejá la lista vacía.',
      },
    ]);
  });

  it('cantidad y lista vacía juntos: es válido', () => {
    expect(UpdateRequisitoClienteSchema.parse({ cantidad: 4, diasAproximados: [] })).toEqual({
      cantidad: 4,
      diasAproximados: [],
    });
  });

  it('valida cada campo como el alta', () => {
    expect(errores(UpdateRequisitoClienteSchema.safeParse({ cantidad: 0 }))[0]?.path).toEqual([
      'cantidad',
    ]);
    expect(
      errores(UpdateRequisitoClienteSchema.safeParse({ canalEntrega: 'FAX' }))[0]?.path,
    ).toEqual(['canalEntrega']);
    expect(
      errores(UpdateRequisitoClienteSchema.safeParse({ diasAproximados: [0] }))[0]?.path,
    ).toEqual(['diasAproximados', 0]);
  });
});

describe('RequisitoClienteSchema', () => {
  const requisito = {
    id: 'd1e2f3a4-b5c6-4789-8abc-def012345678',
    clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    tipoDocumento: { id: TIPO_ID, nombre: 'Print', activo: true },
    cantidad: 3,
    diasAproximados: [1, 10, 20],
    canalEntrega: null,
    nota: 'Prints de la pauta',
    creadoEn: '2026-10-20T12:00:00.000Z',
    actualizadoEn: '2026-10-20T12:00:00.000Z',
  };

  it('lee la entidad del contrato y convierte las fechas', () => {
    const r = RequisitoClienteSchema.parse(requisito);
    expect(r.creadoEn).toBeInstanceOf(Date);
    expect(r.tipoDocumento.nombre).toBe('Print');
  });

  it('no aplica reglas de escritura: no reordena ni exige coherencia', () => {
    const r = RequisitoClienteSchema.parse({
      ...requisito,
      cantidad: 2,
      diasAproximados: [20, 1, 5],
    });
    expect(r.diasAproximados).toEqual([20, 1, 5]);
  });

  it('conserva el canal guardado, que puede ser null', () => {
    expect(
      RequisitoClienteSchema.parse({ ...requisito, canalEntrega: 'WHATSAPP' }).canalEntrega,
    ).toBe('WHATSAPP');
  });

  it('rechaza una cantidad menor que 1', () => {
    expect(RequisitoClienteSchema.safeParse({ ...requisito, cantidad: 0 }).success).toBe(false);
  });

  it('exige el tipo anidado completo', () => {
    expect(
      RequisitoClienteSchema.safeParse({ ...requisito, tipoDocumento: { id: TIPO_ID } }).success,
    ).toBe(false);
  });
});
