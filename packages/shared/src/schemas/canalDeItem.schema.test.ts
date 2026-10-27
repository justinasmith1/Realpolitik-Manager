import { describe, expect, it } from 'vitest';

import { ActualizarCanalDeItemSchema, MENSAJE_CANAL_DE_ITEM } from './canalDeItem.schema.js';

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
