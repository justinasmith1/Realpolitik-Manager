import { describe, expect, it } from 'vitest';

import {
  ActualizarRendicionSchema,
  CreateRendicionSchema,
  MENSAJE_ACTUALIZAR_OC_VACIO,
  MONTO_OC_MAX,
  MontoOcSchema,
  NumeroOcSchema,
  RendicionSchema,
  UltimaOcSchema,
} from './rendicion.schema.js';

const BASE = { anio: 2026, mes: 10, numeroFactura: 'B 00002-00001482' };

describe('NumeroOcSchema', () => {
  it('recorta el texto', () => {
    expect(NumeroOcSchema.parse('  OC-123  ')).toBe('OC-123');
  });

  it.each(['', '   ', 'x'.repeat(101)])('rechaza %j', (valor) => {
    expect(NumeroOcSchema.safeParse(valor).success).toBe(false);
  });
});

describe('MontoOcSchema', () => {
  it.each([0, 1250000, 1250000.5, 10.99, MONTO_OC_MAX])('acepta %s', (monto) => {
    expect(MontoOcSchema.safeParse(monto).success).toBe(true);
  });

  // Con `monto * 100` el punto flotante da `26843826329.000004` y el monto se rechazaba.
  it.each([268438263.29, 999999999999.99])('acepta un monto grande con centavos: %s', (monto) => {
    expect(MontoOcSchema.safeParse(monto).success).toBe(true);
  });

  it.each([-1, 10.123, 0.001, Number.NaN, Infinity, MONTO_OC_MAX + 1, '10'])(
    'rechaza %s',
    (monto) => {
      expect(MontoOcSchema.safeParse(monto).success).toBe(false);
    },
  );
});

describe('CreateRendicionSchema con OC', () => {
  it('los tres datos son opcionales', () => {
    const resultado = CreateRendicionSchema.safeParse(BASE);
    expect(resultado.success).toBe(true);
  });

  it('acepta los tres datos juntos', () => {
    const resultado = CreateRendicionSchema.parse({
      ...BASE,
      numeroOc: ' OC-77 ',
      montoMensual: 100000,
      montoTotal: 1200000,
    });
    expect(resultado).toMatchObject({
      numeroOc: 'OC-77',
      montoMensual: 100000,
      montoTotal: 1200000,
    });
  });

  it('rechaza un monto negativo', () => {
    const resultado = CreateRendicionSchema.safeParse({ ...BASE, montoTotal: -5 });
    expect(resultado.success).toBe(false);
  });
});

describe('ActualizarRendicionSchema', () => {
  it('acepta un solo campo', () => {
    expect(ActualizarRendicionSchema.safeParse({ montoMensual: 10 }).success).toBe(true);
  });

  it('acepta null para borrar un dato', () => {
    expect(ActualizarRendicionSchema.parse({ numeroOc: null })).toEqual({ numeroOc: null });
  });

  it('rechaza un cuerpo sin ningún dato', () => {
    const resultado = ActualizarRendicionSchema.safeParse({});
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.message).toBe(MENSAJE_ACTUALIZAR_OC_VACIO);
    }
  });

  it('no acepta un número de OC vacío (se borra con null)', () => {
    expect(ActualizarRendicionSchema.safeParse({ numeroOc: '' }).success).toBe(false);
  });
});

describe('UltimaOcSchema', () => {
  it('acepta null (el cliente no tiene OC previa)', () => {
    expect(UltimaOcSchema.parse(null)).toBeNull();
  });

  it('acepta una OC con montos nulos', () => {
    const oc = { numeroOc: 'OC-1', montoMensual: null, montoTotal: 50 };
    expect(UltimaOcSchema.parse(oc)).toEqual(oc);
  });
});

describe('RendicionSchema con OC', () => {
  it('una clave ausente es null (rendiciones anteriores a HU2.11)', () => {
    const rendicion = RendicionSchema.parse({
      id: 'e1f2a3b4-c5d6-4789-8abc-def012345678',
      clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      anio: 2026,
      mes: 10,
      numeroFactura: 'B 00002-00001482',
      estado: 'ACTIVA',
      anuladaEn: null,
      creadoEn: '2026-10-01T00:00:00.000Z',
      actualizadoEn: '2026-10-01T00:00:00.000Z',
    });
    expect(rendicion).toMatchObject({ numeroOc: null, montoMensual: null, montoTotal: null });
  });
});
