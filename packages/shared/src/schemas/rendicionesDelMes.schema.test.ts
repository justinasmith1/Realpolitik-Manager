import { describe, expect, it } from 'vitest';

import { MENSAJE_ANIO, MENSAJE_MES } from './rendicion.schema.js';
import {
  ListarRendicionesDelMesQuerySchema,
  RendicionAtrasadaSchema,
  RendicionDelMesSchema,
} from './rendicionesDelMes.schema.js';

// Pantalla Rendiciones (HU3.2): el período del listado y la forma de cada fila.

describe('ListarRendicionesDelMesQuerySchema', () => {
  it('convierte anio y mes a número', () => {
    expect(ListarRendicionesDelMesQuerySchema.parse({ anio: '2026', mes: '11' })).toEqual({
      anio: 2026,
      mes: 11,
    });
  });

  it('acepta los bordes de los rangos', () => {
    expect(ListarRendicionesDelMesQuerySchema.safeParse({ anio: '2020', mes: '1' }).success).toBe(
      true,
    );
    expect(ListarRendicionesDelMesQuerySchema.safeParse({ anio: '2100', mes: '12' }).success).toBe(
      true,
    );
  });

  it('los dos son obligatorios', () => {
    const r = ListarRendicionesDelMesQuerySchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([
      ['anio', MENSAJE_ANIO],
      ['mes', MENSAJE_MES],
    ]);
  });

  it.each([
    ['un año fuera de rango', { anio: '2019', mes: '1' }, 'anio'],
    ['un mes 13', { anio: '2026', mes: '13' }, 'mes'],
    ['un mes 0', { anio: '2026', mes: '0' }, 'mes'],
    ['un mes que no es un entero', { anio: '2026', mes: '1.5' }, 'mes'],
    ['un año con espacios', { anio: ' 2026', mes: '1' }, 'anio'],
    ['un parámetro repetido', { anio: '2026', mes: ['1', '2'] }, 'mes'],
  ])('rechaza %s, en su campo', (_caso, query, campo) => {
    const r = ListarRendicionesDelMesQuerySchema.safeParse(query);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([campo]);
  });
});

describe('RendicionDelMesSchema', () => {
  const fila = {
    id: 'e1f2a3b4-c5d6-4789-8abc-def012345678',
    clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    cliente: { denominacion: 'Muni Ejemplo', sector: 'PUBLICO', subtipo: 'MUNICIPAL' },
    numeroFactura: 'B 00002-00001482',
    estado: 'EN_CURSO',
    avance: { reunidos: 2, total: 5, faltantes: 3 },
    ultimoPaso: null,
    atrasada: false,
  };

  it('lee una fila En curso, sin último paso', () => {
    expect(RendicionDelMesSchema.parse(fila)).toEqual(fila);
  });

  it('un cliente privado no tiene subtipo', () => {
    const privado = {
      ...fila,
      cliente: { denominacion: 'Zeta', sector: 'PRIVADO', subtipo: null },
    };
    expect(RendicionDelMesSchema.parse(privado).cliente.subtipo).toBeNull();
  });

  it('una Enviada lleva el último paso con su fecha', () => {
    const r = RendicionDelMesSchema.parse({
      ...fila,
      estado: 'ENVIADA',
      ultimoPaso: { estado: 'ENVIADA', fecha: '2026-11-03T15:00:00.000Z' },
    });
    expect(r.ultimoPaso).toEqual({
      estado: 'ENVIADA',
      fecha: new Date('2026-11-03T15:00:00.000Z'),
    });
  });

  it.each([
    [
      'un último paso de un estado sin fecha',
      { ultimoPaso: { estado: 'COMPLETA', fecha: '2026-11-03T15:00:00.000Z' } },
    ],
    ['un avance negativo', { avance: { reunidos: -1, total: 5, faltantes: 6 } }],
    ['un estado desconocido', { estado: 'ATRASADA' }],
    ['sin cliente', { cliente: undefined }],
    ['sin atrasada', { atrasada: undefined }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(RendicionDelMesSchema.safeParse({ ...fila, ...cambio }).success).toBe(false);
  });
});

describe('RendicionAtrasadaSchema', () => {
  const fila = {
    id: 'e1f2a3b4-c5d6-4789-8abc-def012345678',
    clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    cliente: { denominacion: 'Muni Ejemplo', sector: 'PUBLICO', subtipo: 'MUNICIPAL' },
    numeroFactura: 'B 00002-00001482',
    estado: 'EN_CURSO',
    avance: { reunidos: 2, total: 5, faltantes: 3 },
    ultimoPaso: null,
    atrasada: true,
    anio: 2026,
    mes: 9,
  };

  it('es la fila del mes más su período', () => {
    expect(RendicionAtrasadaSchema.parse(fila)).toEqual(fila);
  });

  it.each([
    ['sin período', { anio: undefined }],
    ['un mes fuera de rango', { mes: 13 }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(RendicionAtrasadaSchema.safeParse({ ...fila, ...cambio }).success).toBe(false);
  });
});
