import { describe, expect, it } from 'vitest';

import {
  CargaMasivaRequisitoSchema,
  MOTIVOS_OMISION_CARGA_MASIVA,
  MotivoOmisionCargaMasivaSchema,
  ResultadoCargaMasivaSchema,
} from './cargaMasivaRequisito.schema.js';

const TIPO_ID = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const CLIENTE_A = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const CLIENTE_B = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';
const CLIENTE_C = 'c3d4e5f6-a7b8-4901-8cde-012345678901';

function errores(r: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return (r.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }));
}

describe('CargaMasivaRequisitoSchema', () => {
  it('pedido mínimo: cantidad 1 y días vacíos por cliente; canal y nota en null', () => {
    expect(
      CargaMasivaRequisitoSchema.parse({
        tipoDocumentoId: TIPO_ID,
        clientes: [{ clienteId: CLIENTE_A }],
      }),
    ).toEqual({
      tipoDocumentoId: TIPO_ID,
      canalEntrega: null,
      nota: null,
      clientes: [{ clienteId: CLIENTE_A, cantidad: 1, diasAproximados: [] }],
    });
  });

  it('cantidades distintas por cliente, con y sin días (el ejemplo del contrato)', () => {
    const r = CargaMasivaRequisitoSchema.parse({
      tipoDocumentoId: TIPO_ID,
      canalEntrega: 'PORTAL_WEB',
      nota: ' Constancia del mes anterior ',
      clientes: [
        { clienteId: CLIENTE_A, cantidad: 1 },
        { clienteId: CLIENTE_B, cantidad: 2, diasAproximados: [20, 5] },
        { clienteId: CLIENTE_C, cantidad: 3 },
      ],
    });
    expect(r.canalEntrega).toBe('PORTAL_WEB');
    expect(r.nota).toBe('Constancia del mes anterior');
    expect(r.clientes.map((c) => c.cantidad)).toEqual([1, 2, 3]);
    expect(r.clientes[1]?.diasAproximados).toEqual([5, 20]); // ordenados al guardar
    expect(r.clientes[2]?.diasAproximados).toEqual([]);
  });

  it('exige tipoDocumentoId uuid', () => {
    expect(
      errores(CargaMasivaRequisitoSchema.safeParse({ clientes: [{ clienteId: CLIENTE_A }] }))[0]
        ?.path,
    ).toEqual(['tipoDocumentoId']);
    expect(
      errores(
        CargaMasivaRequisitoSchema.safeParse({
          tipoDocumentoId: 'x',
          clientes: [{ clienteId: CLIENTE_A }],
        }),
      )[0]?.path,
    ).toEqual(['tipoDocumentoId']);
  });

  it('rechaza clientes ausente o vacío', () => {
    expect(
      errores(CargaMasivaRequisitoSchema.safeParse({ tipoDocumentoId: TIPO_ID }))[0]?.path,
    ).toEqual(['clientes']);
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({ tipoDocumentoId: TIPO_ID, clientes: [] }),
    );
    expect(e).toEqual([{ path: ['clientes'], message: 'Elegí al menos un cliente.' }]);
  });

  it('rechaza un clienteId que no es uuid, en su posición', () => {
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({
        tipoDocumentoId: TIPO_ID,
        clientes: [{ clienteId: CLIENTE_A }, { clienteId: 'x' }],
      }),
    );
    expect(e[0]?.path).toEqual(['clientes', 1, 'clienteId']);
  });

  it('rechaza una cantidad inválida de un cliente, en su posición', () => {
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({
        tipoDocumentoId: TIPO_ID,
        clientes: [{ clienteId: CLIENTE_A }, { clienteId: CLIENTE_B, cantidad: 0 }],
      }),
    );
    expect(e).toHaveLength(1);
    expect(e[0]?.path).toEqual(['clientes', 1, 'cantidad']);
  });

  it.each([0, 1.5])(
    'cantidad %j con días cargados: un solo error, en clientes.N.cantidad y ninguno en los días',
    (cantidad) => {
      const e = errores(
        CargaMasivaRequisitoSchema.safeParse({
          tipoDocumentoId: TIPO_ID,
          clientes: [
            { clienteId: CLIENTE_A },
            { clienteId: CLIENTE_B, cantidad, diasAproximados: [1, 2] },
          ],
        }),
      );
      expect(e.map((x) => x.path)).toEqual([['clientes', 1, 'cantidad']]);
    },
  );

  it('días que no coinciden con la cantidad: el error señala al cliente', () => {
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({
        tipoDocumentoId: TIPO_ID,
        clientes: [
          { clienteId: CLIENTE_A, cantidad: 1, diasAproximados: [3] },
          { clienteId: CLIENTE_B, cantidad: 3, diasAproximados: [1, 2] },
        ],
      }),
    );
    expect(e).toEqual([
      {
        path: ['clientes', 1, 'diasAproximados'],
        message: 'Cargá 3 días aproximados (uno por documento) o dejá la lista vacía.',
      },
    ]);
  });

  it('un día fuera de 1 a 31 señala el elemento', () => {
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({
        tipoDocumentoId: TIPO_ID,
        clientes: [{ clienteId: CLIENTE_A, cantidad: 1, diasAproximados: [32] }],
      }),
    );
    expect(e[0]?.path).toEqual(['clientes', 0, 'diasAproximados', 0]);
  });

  it('un cliente repetido marca CADA ocurrencia en su clienteId', () => {
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({
        tipoDocumentoId: TIPO_ID,
        clientes: [
          { clienteId: CLIENTE_A },
          { clienteId: CLIENTE_B },
          { clienteId: CLIENTE_A },
          { clienteId: CLIENTE_A },
        ],
      }),
    );
    expect(e.map((x) => x.path)).toEqual([
      ['clientes', 0, 'clienteId'],
      ['clientes', 2, 'clienteId'],
      ['clientes', 3, 'clienteId'],
    ]);
    expect(e[0]?.message).toBe('Este cliente está repetido en la lista.');
  });

  it('el mismo uuid en mayúsculas cuenta como repetido', () => {
    const e = errores(
      CargaMasivaRequisitoSchema.safeParse({
        tipoDocumentoId: TIPO_ID,
        clientes: [{ clienteId: CLIENTE_A }, { clienteId: CLIENTE_A.toUpperCase() }],
      }),
    );
    expect(e.map((x) => x.path)).toEqual([
      ['clientes', 0, 'clienteId'],
      ['clientes', 1, 'clienteId'],
    ]);
  });

  it('valida canalEntrega y nota como el alta individual', () => {
    const base = { tipoDocumentoId: TIPO_ID, clientes: [{ clienteId: CLIENTE_A }] };
    expect(
      errores(CargaMasivaRequisitoSchema.safeParse({ ...base, canalEntrega: 'FAX' }))[0]?.path,
    ).toEqual(['canalEntrega']);
    expect(
      errores(CargaMasivaRequisitoSchema.safeParse({ ...base, nota: 'a'.repeat(501) }))[0]?.path,
    ).toEqual(['nota']);
  });
});

describe('ResultadoCargaMasivaSchema', () => {
  it('los motivos de omisión tienen una sola fuente', () => {
    expect(MOTIVOS_OMISION_CARGA_MASIVA).toEqual(['REQUISITO_EXISTENTE', 'CLIENTE_NO_ACTIVO']);
    expect(MotivoOmisionCargaMasivaSchema.options).toEqual(MOTIVOS_OMISION_CARGA_MASIVA);
  });

  it('lee la respuesta del contrato', () => {
    const respuesta = {
      creados: [CLIENTE_A],
      omitidos: [{ clienteId: CLIENTE_B, motivo: 'REQUISITO_EXISTENTE' }],
    };
    expect(ResultadoCargaMasivaSchema.parse(respuesta)).toEqual(respuesta);
  });

  it('puede no crearse ninguno', () => {
    expect(
      ResultadoCargaMasivaSchema.safeParse({
        creados: [],
        omitidos: [{ clienteId: CLIENTE_A, motivo: 'CLIENTE_NO_ACTIVO' }],
      }).success,
    ).toBe(true);
  });

  it('rechaza un motivo desconocido', () => {
    expect(
      ResultadoCargaMasivaSchema.safeParse({
        creados: [],
        omitidos: [{ clienteId: CLIENTE_A, motivo: 'OTRO' }],
      }).success,
    ).toBe(false);
  });
});
