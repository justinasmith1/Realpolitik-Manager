import { describe, expect, it } from 'vitest';

import {
  ActualizarCanalDeItemSchema,
  MAX_RENDICIONES_A_PROPAGAR,
  MENSAJE_CANAL_DE_ITEM,
  MENSAJE_RENDICION_IDS,
  PropagarCanalDeRequisitoSchema,
  ResultadoPropagarCanalSchema,
} from './canalDeItem.schema.js';

describe('ActualizarCanalDeItemSchema', () => {
  it.each(['CORREO', 'PORTAL_WEB', 'WHATSAPP'])('acepta %s', (canalEntrega) => {
    expect(ActualizarCanalDeItemSchema.parse({ canalEntrega })).toEqual({ canalEntrega });
  });

  it('ignora otros campos: el resto del snapshot del ítem no se edita', () => {
    expect(
      ActualizarCanalDeItemSchema.parse({ canalEntrega: 'CORREO', diaAproximado: 5, ordinal: 2 }),
    ).toEqual({ canalEntrega: 'CORREO' });
  });

  it.each([
    ['un canal inexistente', { canalEntrega: 'FAX' }],
    ['en minúscula', { canalEntrega: 'correo' }],
    ['null (el ítem siempre tiene canal)', { canalEntrega: null }],
    ['sin el campo', {}],
  ])('rechaza %s con un mensaje en español', (_caso, cuerpo) => {
    const r = ActualizarCanalDeItemSchema.safeParse(cuerpo);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual([
        expect.objectContaining({ path: ['canalEntrega'], message: MENSAJE_CANAL_DE_ITEM }),
      ]);
    }
  });
});

describe('PropagarCanalDeRequisitoSchema', () => {
  const id = (n: number) => `e1f2a3b4-c5d6-4789-8abc-${String(n).padStart(12, '0')}`;

  it('acepta una o varias rendiciones', () => {
    expect(PropagarCanalDeRequisitoSchema.parse({ rendicionIds: [id(1)] })).toEqual({
      rendicionIds: [id(1)],
    });
    expect(PropagarCanalDeRequisitoSchema.parse({ rendicionIds: [id(1), id(2)] })).toEqual({
      rendicionIds: [id(1), id(2)],
    });
  });

  it('ignora otros campos: el canal lo resuelve el backend, no viaja en el cuerpo', () => {
    expect(
      PropagarCanalDeRequisitoSchema.parse({ rendicionIds: [id(1)], canalEntrega: 'WHATSAPP' }),
    ).toEqual({ rendicionIds: [id(1)] });
  });

  it(`acepta hasta ${MAX_RENDICIONES_A_PROPAGAR} y rechaza una más`, () => {
    const ids = Array.from({ length: MAX_RENDICIONES_A_PROPAGAR + 1 }, (_, n) => id(n));
    expect(PropagarCanalDeRequisitoSchema.safeParse({ rendicionIds: ids.slice(1) }).success).toBe(
      true,
    );
    expect(PropagarCanalDeRequisitoSchema.safeParse({ rendicionIds: ids }).success).toBe(false);
  });

  it.each([
    ['una lista vacía', { rendicionIds: [] }],
    ['una rendición repetida', { rendicionIds: [id(1), id(1)] }],
    ['un id que no es uuid', { rendicionIds: ['no-es-uuid'] }],
    ['un texto en vez de una lista', { rendicionIds: id(1) }],
    ['sin el campo', {}],
  ])('rechaza %s con un mensaje en español', (_caso, cuerpo) => {
    const r = PropagarCanalDeRequisitoSchema.safeParse(cuerpo);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]).toMatchObject({ message: MENSAJE_RENDICION_IDS });
      expect(r.error.issues[0]?.path[0]).toBe('rendicionIds');
    }
  });
});

describe('ResultadoPropagarCanalSchema', () => {
  it('lee el canal aplicado y cuántos ítems cambió en cada rendición', () => {
    const resultado = {
      canalEntrega: 'PORTAL_WEB',
      rendiciones: [{ rendicionId: 'e1f2a3b4-c5d6-4789-8abc-def012345678', itemsActualizados: 3 }],
    };
    expect(ResultadoPropagarCanalSchema.parse(resultado)).toEqual(resultado);
  });

  it('rechaza un conteo negativo o un canal desconocido', () => {
    const rendiciones = [
      { rendicionId: 'e1f2a3b4-c5d6-4789-8abc-def012345678', itemsActualizados: -1 },
    ];
    expect(
      ResultadoPropagarCanalSchema.safeParse({ canalEntrega: 'CORREO', rendiciones }).success,
    ).toBe(false);
    expect(
      ResultadoPropagarCanalSchema.safeParse({ canalEntrega: 'FAX', rendiciones: [] }).success,
    ).toBe(false);
  });
});
