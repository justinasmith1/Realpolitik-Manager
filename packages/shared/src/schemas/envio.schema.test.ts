import { describe, expect, it } from 'vitest';

import {
  MAX_ITEMS_A_ENVIAR,
  MENSAJE_ITEMS_A_ENVIAR,
  PreparacionEnvioSchema,
  PrepararEnvioSchema,
} from './envio.schema.js';

const id = (n: number) => `b1c2d3e4-f5a6-4789-8abc-${String(n).padStart(12, '0')}`;
const FECHA = '2026-10-15T15:00:00.000Z';

const item = (extra: Record<string, unknown> = {}) => ({
  id: id(1),
  requisitoClienteId: id(2),
  tipoDocumentoId: id(3),
  nombreTipoDocumento: 'Print',
  ordinal: 1,
  totalOrdinal: 1,
  diaAproximado: null,
  canalEntrega: 'CORREO',
  completado: true,
  completadoEn: FECHA,
  creadoEn: FECHA,
  actualizadoEn: FECHA,
  documento: {
    aplicacionId: id(4),
    documentoId: id(5),
    nombreOriginal: 'print.pdf',
    tipoContenido: 'application/pdf',
    tamanioBytes: 10,
    aplicadaEn: FECHA,
  },
  ...extra,
});

describe('PrepararEnvioSchema', () => {
  it('acepta ítems sin repetir', () => {
    expect(PrepararEnvioSchema.safeParse({ itemIds: [id(1), id(2)] }).success).toBe(true);
  });

  it.each([
    ['vacío', []],
    ['repetido', [id(1), id(1)]],
    ['no UUID', ['x']],
    ['demasiados', Array.from({ length: MAX_ITEMS_A_ENVIAR + 1 }, (_, n) => id(n))],
  ])('rechaza una lista %s', (_caso, itemIds) => {
    const r = PrepararEnvioSchema.safeParse({ itemIds });
    expect(r.success).toBe(false);
  });

  it('el mensaje de una lista inválida es el de la selección', () => {
    const r = PrepararEnvioSchema.safeParse({ itemIds: [] });
    expect(r.success || r.error.issues[0]?.message).toBe(MENSAJE_ITEMS_A_ENVIAR);
  });
});

describe('PreparacionEnvioSchema', () => {
  it('acepta ítems completados con documento vigente', () => {
    expect(
      PreparacionEnvioSchema.safeParse({ rendicionId: id(9), canal: 'CORREO', items: [item()] })
        .success,
    ).toBe(true);
  });

  it('exige el documento y que el ítem esté completado: no es el checklist general', () => {
    for (const extra of [{ documento: null }, { documento: undefined }, { completado: false }]) {
      expect(
        PreparacionEnvioSchema.safeParse({
          rendicionId: id(9),
          canal: 'CORREO',
          items: [item(extra)],
        }).success,
      ).toBe(false);
    }
  });
});
