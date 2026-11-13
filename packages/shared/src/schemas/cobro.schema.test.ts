import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MENSAJE_FECHA_COBRO_FUTURA,
  MENSAJE_FECHA_COBRO_INVALIDA,
  MENSAJE_NOTA_COBRO,
} from '../utils/cobro.js';

import {
  RegistrarCobroSchema,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
} from './rendicion.schema.js';

// El cobro informado por el cliente (HU3.10): el cuerpo de PUT /rendiciones/:id/cobro y cómo lo
// leen las entidades de la rendición.

function errores(r: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return (r.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RegistrarCobroSchema', () => {
  // 13/11/2026, 12:00 en Buenos Aires.
  const reloj = () => vi.useFakeTimers({ now: new Date('2026-11-13T15:00:00.000Z') });

  it('acepta una fecha y una nota', () => {
    reloj();
    const cuerpo = { fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' };
    expect(RegistrarCobroSchema.parse(cuerpo)).toEqual(cuerpo);
  });

  it('la nota es opcional', () => {
    reloj();
    expect(RegistrarCobroSchema.parse({ fecha: '2026-11-13' })).toEqual({ fecha: '2026-11-13' });
  });

  it('acepta la nota en null (el formulario la manda así cuando está vacía)', () => {
    reloj();
    expect(RegistrarCobroSchema.parse({ fecha: '2026-11-13', nota: null }).nota).toBeNull();
  });

  it('recorta la nota', () => {
    reloj();
    expect(RegistrarCobroSchema.parse({ fecha: '2026-11-13', nota: '  Pagó  ' }).nota).toBe('Pagó');
  });

  it.each(['', '   '])('rechaza la nota %j, en nota', (nota) => {
    reloj();
    expect(errores(RegistrarCobroSchema.safeParse({ fecha: '2026-11-13', nota }))).toEqual([
      { path: ['nota'], message: MENSAJE_NOTA_COBRO },
    ]);
  });

  it('acepta una nota de 300 caracteres y rechaza una de 301', () => {
    reloj();
    expect(
      RegistrarCobroSchema.safeParse({ fecha: '2026-11-13', nota: 'a'.repeat(300) }).success,
    ).toBe(true);
    expect(
      errores(RegistrarCobroSchema.safeParse({ fecha: '2026-11-13', nota: 'a'.repeat(301) })),
    ).toEqual([{ path: ['nota'], message: MENSAJE_NOTA_COBRO }]);
  });

  it('rechaza una fecha que no existe, en fecha', () => {
    reloj();
    expect(errores(RegistrarCobroSchema.safeParse({ fecha: '2026-02-30' }))).toEqual([
      { path: ['fecha'], message: MENSAJE_FECHA_COBRO_INVALIDA },
    ]);
  });

  it('rechaza una fecha futura, en fecha', () => {
    reloj();
    expect(errores(RegistrarCobroSchema.safeParse({ fecha: '2026-11-14' }))).toEqual([
      { path: ['fecha'], message: MENSAJE_FECHA_COBRO_FUTURA },
    ]);
  });

  it('a las 22:00 en Buenos Aires el día siguiente en UTC ya es futuro; hoy no', () => {
    vi.useFakeTimers({ now: new Date('2026-11-14T01:00:00.000Z') });
    expect(RegistrarCobroSchema.safeParse({ fecha: '2026-11-13' }).success).toBe(true);
    expect(errores(RegistrarCobroSchema.safeParse({ fecha: '2026-11-14' }))).toEqual([
      { path: ['fecha'], message: MENSAJE_FECHA_COBRO_FUTURA },
    ]);
  });

  it('la fecha es obligatoria', () => {
    reloj();
    const e = errores(RegistrarCobroSchema.safeParse({}));
    expect(e).toHaveLength(1);
    expect(e[0]?.path).toEqual(['fecha']);
  });
});

describe('cobro en las entidades de la rendición', () => {
  const rendicion = {
    id: 'e1f2a3b4-c5d6-4789-8abc-def012345678',
    clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    anio: 2026,
    mes: 10,
    numeroFactura: 'B 00002-00001482',
    emisor: 'SOCIEDAD',
    numeroOc: null,
    montoMensual: null,
    montoTotal: null,
    estado: 'ENVIADA',
    vigencia: 'ACTIVA',
    anuladaEn: null,
    creadoEn: '2026-10-20T12:00:00.000Z',
    actualizadoEn: '2026-10-20T12:00:00.000Z',
  };

  it('una clave ausente es "sin cobro" (como la OC)', () => {
    expect(RendicionSchema.parse(rendicion).cobro).toBeNull();
  });

  it('lee el cobro con su fecha y su nota', () => {
    const cobro = { fecha: '2026-11-10', nota: 'Avisó por mail' };
    expect(RendicionSchema.parse({ ...rendicion, cobro }).cobro).toEqual(cobro);
  });

  it('la nota puede ser null', () => {
    expect(
      RendicionSchema.parse({ ...rendicion, cobro: { fecha: '2026-11-10', nota: null } }).cobro,
    ).toEqual({ fecha: '2026-11-10', nota: null });
  });

  it('al leer no aplica la regla de la fecha futura', () => {
    expect(
      RendicionSchema.safeParse({ ...rendicion, cobro: { fecha: '2099-01-01', nota: null } })
        .success,
    ).toBe(true);
  });

  it('rechaza un cobro con una fecha que no es un día', () => {
    expect(
      RendicionSchema.safeParse({ ...rendicion, cobro: { fecha: '10/11/2026', nota: null } })
        .success,
    ).toBe(false);
  });

  it('lo heredan el detalle y el resumen del listado del cliente', () => {
    const cobro = { fecha: '2026-11-10', nota: null };
    expect(
      RendicionDetalleSchema.parse({ ...rendicion, cobro, items: [], historial: [] }).cobro,
    ).toEqual(cobro);
    expect(
      RendicionResumenSchema.parse({
        ...rendicion,
        cobro,
        resumen: { totalItems: 0, completados: 0 },
      }).cobro,
    ).toEqual(cobro);
  });
});
