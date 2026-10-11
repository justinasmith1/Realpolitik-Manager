import { describe, expect, it } from 'vitest';

import { ListarClientesQuerySchema, MAX_BUSQUEDA_CLIENTES } from './listarClientesQuery.schema.js';

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

  describe('q', () => {
    it('el límite compartido es el largo de la razón social, la columna más larga donde se busca', () => {
      expect(MAX_BUSQUEDA_CLIENTES).toBe(150);
    });

    it('acepta el máximo (150 caracteres)', () => {
      const q = 'a'.repeat(MAX_BUSQUEDA_CLIENTES);
      expect(ListarClientesQuerySchema.parse({ q }).q).toBe(q);
    });

    it('rechaza 151 caracteres y el error apunta a "q"', () => {
      const resultado = ListarClientesQuerySchema.safeParse({
        q: 'a'.repeat(MAX_BUSQUEDA_CLIENTES + 1),
      });
      expect(resultado.success).toBe(false);
      expect(resultado.error?.issues.map((issue) => issue.path)).toEqual([['q']]);
      expect(resultado.error?.issues[0]?.message).toBe(
        'La búsqueda no puede superar los 150 caracteres.',
      );
    });

    it('el largo se mide después de recortar', () => {
      const q = 'a'.repeat(150);
      expect(ListarClientesQuerySchema.safeParse({ q: `  ${q}  ` }).success).toBe(true);
      expect(ListarClientesQuerySchema.safeParse({ q: ' '.repeat(500) }).success).toBe(true);
    });

    it('no toca %, _ ni la barra invertida: el escape es asunto de quien arma la búsqueda', () => {
      expect(ListarClientesQuerySchema.parse({ q: '50%_\\' }).q).toBe('50%_\\');
    });

    it.each(['abc\u0000', 'a\nb', 'a\tb', 'a\u007Fb'])(
      'rechaza caracteres de control (%j)',
      (q) => {
        const resultado = ListarClientesQuerySchema.safeParse({ q });
        expect(resultado.error?.issues.map((issue) => issue.path)).toEqual([['q']]);
      },
    );

    it('rechaza q repetido (llega como arreglo) con 400 en lugar de romper', () => {
      expect(ListarClientesQuerySchema.safeParse({ q: ['a', 'b'] }).success).toBe(false);
    });
  });
});
