import { describe, expect, it } from 'vitest';

import { mesActual } from '../utils/periodo.js';

import {
  AbrirRendicionFormSchema,
  CreateRendicionSchema,
  MENSAJE_EMISOR_OBLIGATORIO,
} from './rendicion.schema.js';

const { anio, mes } = mesActual(new Date());
const BASE = { anio, mes, numeroFactura: 'b 2-1482' };

describe('AbrirRendicionFormSchema', () => {
  it('exige el emisor, con el mensaje que ve la operadora', () => {
    const resultado = AbrirRendicionFormSchema.safeParse(BASE);

    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues).toEqual([
      expect.objectContaining({ path: ['emisor'], message: MENSAJE_EMISOR_OBLIGATORIO }),
    ]);
  });

  it('rechaza un emisor desconocido con el mismo mensaje', () => {
    const resultado = AbrirRendicionFormSchema.safeParse({ ...BASE, emisor: 'OTRO' });

    expect(resultado.error?.issues[0]).toMatchObject({
      path: ['emisor'],
      message: MENSAJE_EMISOR_OBLIGATORIO,
    });
  });

  it('el error del emisor sale junto con el de otro campo inválido', () => {
    const resultado = AbrirRendicionFormSchema.safeParse({ ...BASE, numeroFactura: 'FC-1' });

    expect(resultado.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'emisor',
      'numeroFactura',
    ]);
  });

  it('con emisor, entrega lo mismo que CreateRendicionSchema (factura canónica)', () => {
    const datos = { ...BASE, emisor: 'SOCIEDAD' };

    expect(AbrirRendicionFormSchema.parse(datos)).toEqual(CreateRendicionSchema.parse(datos));
    expect(AbrirRendicionFormSchema.parse(datos)).toMatchObject({
      numeroFactura: 'B 00002-00001482',
      emisor: 'SOCIEDAD',
    });
  });

  it('aplica la misma regla del período: no más allá del mes siguiente', () => {
    const resultado = AbrirRendicionFormSchema.safeParse({
      ...BASE,
      anio: anio + 1,
      emisor: 'SOCIEDAD',
    });

    expect(resultado.error?.issues).toEqual([expect.objectContaining({ path: ['mes'] })]);
  });

  it('CreateRendicionSchema sigue con el emisor opcional (el servidor completa el del cliente)', () => {
    expect(CreateRendicionSchema.safeParse(BASE).success).toBe(true);
  });
});
