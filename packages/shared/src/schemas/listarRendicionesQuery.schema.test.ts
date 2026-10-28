import { describe, expect, it } from 'vitest';

import {
  FILTRO_ESTADO_POR_DEFECTO,
  ListarRendicionesQuerySchema,
  MENSAJE_REQUISITO_ID,
} from './listarRendicionesQuery.schema.js';

describe('ListarRendicionesQuerySchema', () => {
  it('sin parámetros: ningún filtro', () => {
    expect(ListarRendicionesQuerySchema.parse({})).toEqual({});
  });

  it('convierte anio y mes a número', () => {
    expect(ListarRendicionesQuerySchema.parse({ anio: '2026', mes: '10' })).toEqual({
      anio: 2026,
      mes: 10,
    });
  });

  it('se pueden usar por separado', () => {
    expect(ListarRendicionesQuerySchema.parse({ mes: '3' })).toEqual({ mes: 3 });
    expect(ListarRendicionesQuerySchema.parse({ anio: '2024' })).toEqual({ anio: 2024 });
  });

  it('acepta los bordes de los rangos', () => {
    expect(ListarRendicionesQuerySchema.safeParse({ anio: '2020', mes: '1' }).success).toBe(true);
    expect(ListarRendicionesQuerySchema.safeParse({ anio: '2100', mes: '12' }).success).toBe(true);
  });

  it.each(['2019', '2101', '0', '99999999999999999999'])(
    'rechaza anio=%s fuera de rango',
    (anio) => {
      const r = ListarRendicionesQuerySchema.safeParse({ anio });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues[0]?.path).toEqual(['anio']);
        expect(r.error.issues[0]?.message).toBe(
          'El año debe ser un número entero entre 2020 y 2100.',
        );
      }
    },
  );

  it.each(['0', '13', '100'])('rechaza mes=%s fuera de rango', (mes) => {
    const r = ListarRendicionesQuerySchema.safeParse({ mes });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['mes']);
      expect(r.error.issues[0]?.message).toBe('El mes debe ser un número entero entre 1 y 12.');
    }
  });

  it.each(['', ' 5 ', '1.5', '-3', '+3', '1e1', '0x10', 'abc', 'NaN'])(
    'solo dígitos puros: rechaza mes=%j',
    (mes) => {
      const r = ListarRendicionesQuerySchema.safeParse({ mes });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['mes']);
    },
  );

  it.each(['', ' 2026', '2026.0', '2e3', 'dos mil'])(
    'solo dígitos puros: rechaza anio=%j',
    (anio) => {
      const r = ListarRendicionesQuerySchema.safeParse({ anio });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path).toEqual(['anio']);
    },
  );

  it('rechaza lo que no es texto (un parámetro repetido llega como lista)', () => {
    expect(ListarRendicionesQuerySchema.safeParse({ mes: ['1', '2'] }).success).toBe(false);
    expect(ListarRendicionesQuerySchema.safeParse({ anio: 2026 }).success).toBe(false);
  });

  it('informa anio y mes inválidos a la vez, cada uno en su campo', () => {
    const r = ListarRendicionesQuerySchema.safeParse({ anio: 'x', mes: 'y' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path)).toEqual([['anio'], ['mes']]);
  });

  describe('estado', () => {
    it('es opcional y no se completa: sin el parámetro el pedido sigue vacío', () => {
      expect(ListarRendicionesQuerySchema.parse({})).toEqual({});
      expect(FILTRO_ESTADO_POR_DEFECTO).toBe('ACTIVA');
    });

    it.each(['ACTIVA', 'ANULADA', 'TODAS'])('acepta %s', (estado) => {
      expect(ListarRendicionesQuerySchema.parse({ estado })).toEqual({ estado });
    });

    it('se combina con el período', () => {
      expect(
        ListarRendicionesQuerySchema.parse({ anio: '2026', mes: '10', estado: 'TODAS' }),
      ).toEqual({ anio: 2026, mes: 10, estado: 'TODAS' });
    });

    it.each(['activa', 'ANULADAS', 'BORRADA', '', ['ACTIVA', 'ANULADA']])(
      'rechaza %j con un mensaje claro',
      (estado) => {
        const r = ListarRendicionesQuerySchema.safeParse({ estado });
        expect(r.success).toBe(false);
        if (!r.success) {
          expect(r.error.issues[0]?.message).toBe('El estado debe ser ACTIVA, ANULADA o TODAS.');
          expect(r.error.issues[0]?.path).toEqual(['estado']);
        }
      },
    );
  });

  describe('requisitoId', () => {
    const REQUISITO = 'd1e2f3a4-b5c6-4789-8abc-def012345601';

    it('es opcional y se combina con el estado', () => {
      expect(ListarRendicionesQuerySchema.parse({})).toEqual({});
      expect(
        ListarRendicionesQuerySchema.parse({ estado: 'ACTIVA', requisitoId: REQUISITO }),
      ).toEqual({ estado: 'ACTIVA', requisitoId: REQUISITO });
    });

    it.each(['no-es-uuid', '', [REQUISITO, REQUISITO]])(
      'rechaza %j con un mensaje claro',
      (requisitoId) => {
        const r = ListarRendicionesQuerySchema.safeParse({ requisitoId });
        expect(r.success).toBe(false);
        if (!r.success) {
          expect(r.error.issues).toEqual([
            expect.objectContaining({ path: ['requisitoId'], message: MENSAJE_REQUISITO_ID }),
          ]);
        }
      },
    );
  });
});
