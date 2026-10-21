import { describe, expect, it } from 'vitest';

import { ListarTiposDocumentoQuerySchema } from './listarTiposDocumentoQuery.schema.js';

describe('ListarTiposDocumentoQuerySchema', () => {
  it('sin parámetros: solo activos (incluirInactivos false)', () => {
    expect(ListarTiposDocumentoQuerySchema.parse({})).toEqual({ incluirInactivos: false });
  });

  it("'true' y 'false' se convierten a booleano", () => {
    expect(ListarTiposDocumentoQuerySchema.parse({ incluirInactivos: 'true' })).toEqual({
      incluirInactivos: true,
    });
    expect(ListarTiposDocumentoQuerySchema.parse({ incluirInactivos: 'false' })).toEqual({
      incluirInactivos: false,
    });
  });

  it.each(['1', 'TRUE', 'si', '', true])('rechaza incluirInactivos=%j', (valor) => {
    const r = ListarTiposDocumentoQuerySchema.safeParse({ incluirInactivos: valor });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['incluirInactivos']);
      expect(r.error.issues[0]?.message).toBe('incluirInactivos debe ser true o false.');
    }
  });
});
