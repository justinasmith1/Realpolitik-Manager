import { describe, expect, it } from 'vitest';

import { ListarClientesQuerySchema } from './listarClientesQuery.schema.js';

describe('ListarClientesQuerySchema', () => {
  it('sin parámetros: estado ACTIVO y nada más', () => {
    expect(ListarClientesQuerySchema.parse({})).toEqual({ estado: 'ACTIVO' });
  });

  it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'] as const)('acepta estado=%s', (estado) => {
    expect(ListarClientesQuerySchema.parse({ estado })).toEqual({ estado });
  });

  it('estado INACTIVO se combina con búsqueda y sector', () => {
    expect(
      ListarClientesQuerySchema.parse({ estado: 'INACTIVO', q: ' muni ', sector: 'PUBLICO' }),
    ).toEqual({ estado: 'INACTIVO', q: 'muni', sector: 'PUBLICO' });
  });

  it('acepta todos los parámetros válidos', () => {
    const query = {
      q: 'muni',
      estado: 'INACTIVO',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
    };
    expect(ListarClientesQuerySchema.parse(query)).toEqual(query);
  });

  it('recorta q y trata q vacío o en blanco como ausente', () => {
    expect(ListarClientesQuerySchema.parse({ q: '  muni  ' }).q).toBe('muni');
    expect(ListarClientesQuerySchema.parse({ q: '' }).q).toBeUndefined();
    expect(ListarClientesQuerySchema.parse({ q: '   ' }).q).toBeUndefined();
  });

  it.each([
    ['estado', { estado: 'BORRADO' }],
    ['sector', { sector: 'MIXTO' }],
    ['subtipo', { subtipo: 'FEDERAL' }],
  ])('rechaza un %s desconocido', (campo, query) => {
    const resultado = ListarClientesQuerySchema.safeParse(query);
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual([campo]);
  });

  it('sector PUBLICO con o sin subtipo es válido', () => {
    expect(ListarClientesQuerySchema.safeParse({ sector: 'PUBLICO' }).success).toBe(true);
    expect(
      ListarClientesQuerySchema.safeParse({ sector: 'PUBLICO', subtipo: 'SINDICAL_OBRA_SOCIAL' })
        .success,
    ).toBe(true);
  });

  it('subtipo sin sector es válido (los subtipos son solo del sector público)', () => {
    expect(ListarClientesQuerySchema.safeParse({ subtipo: 'MUNICIPAL' }).success).toBe(true);
  });

  it('sector PRIVADO con subtipo es inválido y el error apunta a "subtipo"', () => {
    const resultado = ListarClientesQuerySchema.safeParse({
      sector: 'PRIVADO',
      subtipo: 'MUNICIPAL',
    });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['subtipo']);
  });
});
