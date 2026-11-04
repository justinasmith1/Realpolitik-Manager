import { describe, expect, it } from 'vitest';

import { ListarRendicionesQuerySchema } from './listarRendicionesQuery.schema.js';
import {
  ETIQUETAS_ESTADO_RENDICION,
  EstadoRendicion,
  HistorialEstadoRendicionSchema,
  MENSAJE_ESTADO_RENDICION,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
} from './rendicion.schema.js';

// Estado de la rendición (HU3.1, ADR-0005): en qué paso está, con su historial de cambios.

const FECHA = '2026-11-03T12:00:00.000Z';
const RENDICION = {
  id: 'e1f2a3b4-c5d6-4789-8abc-def012345678',
  clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  anio: 2026,
  mes: 11,
  numeroFactura: 'B 00002-00001482',
  estado: 'EN_CURSO',
  vigencia: 'ACTIVA',
  anuladaEn: null,
  creadoEn: FECHA,
  actualizadoEn: FECHA,
};
const ALTA = { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: FECHA };

describe('EstadoRendicion', () => {
  it('tiene los cinco estados, en el orden del proceso', () => {
    expect(EstadoRendicion.options).toEqual([
      'EN_CURSO',
      'COMPLETA',
      'ENVIADA',
      'APROBADA',
      'RECHAZADA',
    ]);
  });

  it('"Atrasada" no es un estado: la calcula el sistema (HU3.4)', () => {
    expect(EstadoRendicion.safeParse('ATRASADA').success).toBe(false);
  });

  it('cada estado tiene su etiqueta visible', () => {
    expect(ETIQUETAS_ESTADO_RENDICION).toEqual({
      EN_CURSO: 'En curso',
      COMPLETA: 'Completa',
      ENVIADA: 'Enviada',
      APROBADA: 'Aprobada',
      RECHAZADA: 'Rechazada',
    });
  });

  it.each(['en_curso', 'ANULADA', '', 'OTRO'])('rechaza %j con un mensaje claro', (valor) => {
    const r = EstadoRendicion.safeParse(valor);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(MENSAJE_ESTADO_RENDICION);
  });
});

describe('HistorialEstadoRendicionSchema', () => {
  it('la primera entrada no tiene estado anterior', () => {
    const r = HistorialEstadoRendicionSchema.parse(ALTA);
    expect(r).toEqual({ estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: new Date(FECHA) });
  });

  it('un cambio lleva el estado anterior y el nuevo', () => {
    const r = HistorialEstadoRendicionSchema.parse({
      estadoAnterior: 'EN_CURSO',
      estadoNuevo: 'COMPLETA',
      fecha: FECHA,
    });
    expect(r.estadoAnterior).toBe('EN_CURSO');
    expect(r.estadoNuevo).toBe('COMPLETA');
  });

  it.each([
    ['sin estado nuevo', { estadoAnterior: null, fecha: FECHA }],
    ['sin fecha', { estadoAnterior: null, estadoNuevo: 'EN_CURSO' }],
    ['con un estado desconocido', { ...ALTA, estadoNuevo: 'ATRASADA' }],
  ])('rechaza una entrada %s', (_caso, entrada) => {
    expect(HistorialEstadoRendicionSchema.safeParse(entrada).success).toBe(false);
  });
});

describe('RendicionSchema con estado', () => {
  it('lee el estado, independiente de la vigencia', () => {
    const anulada = RendicionSchema.parse({
      ...RENDICION,
      estado: 'COMPLETA',
      vigencia: 'ANULADA',
      anuladaEn: FECHA,
    });
    expect(anulada).toMatchObject({ estado: 'COMPLETA', vigencia: 'ANULADA' });
  });

  it('el estado es obligatorio en la respuesta', () => {
    const { estado: _estado, ...sinEstado } = RENDICION;
    expect(RendicionSchema.safeParse(sinEstado).success).toBe(false);
  });

  it('el resumen del listado lleva el estado', () => {
    const r = RendicionResumenSchema.parse({
      ...RENDICION,
      estado: 'ENVIADA',
      resumen: { totalItems: 2, completados: 2 },
    });
    expect(r.estado).toBe('ENVIADA');
  });
});

describe('RendicionDetalleSchema con historial', () => {
  it('lee el historial en el orden en que viene', () => {
    const r = RendicionDetalleSchema.parse({
      ...RENDICION,
      estado: 'COMPLETA',
      items: [],
      historial: [
        ALTA,
        { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: '2026-11-04T12:00:00.000Z' },
      ],
    });
    expect(r.historial.map((h) => h.estadoNuevo)).toEqual(['EN_CURSO', 'COMPLETA']);
    expect(r.historial[1]?.fecha).toBeInstanceOf(Date);
  });

  it('el historial es obligatorio en el detalle', () => {
    expect(RendicionDetalleSchema.safeParse({ ...RENDICION, items: [] }).success).toBe(false);
  });
});

describe('ListarRendicionesQuerySchema: filtro por estado', () => {
  it('es opcional: sin el parámetro no se filtra', () => {
    expect(ListarRendicionesQuerySchema.parse({})).toEqual({});
  });

  it.each(EstadoRendicion.options)('acepta %s', (estado) => {
    expect(ListarRendicionesQuerySchema.parse({ estado })).toEqual({ estado });
  });

  it('se combina con la vigencia y el período', () => {
    expect(
      ListarRendicionesQuerySchema.parse({
        estado: 'ENVIADA',
        vigencia: 'TODAS',
        anio: '2026',
      }),
    ).toEqual({ estado: 'ENVIADA', vigencia: 'TODAS', anio: 2026 });
  });

  it.each(['en_curso', 'ATRASADA', 'ACTIVA', '', ['EN_CURSO', 'COMPLETA']])(
    'rechaza %j en `estado`, con su mensaje',
    (estado) => {
      const r = ListarRendicionesQuerySchema.safeParse({ estado });
      expect(r.success).toBe(false);
      expect(r.error?.issues).toEqual([
        expect.objectContaining({ path: ['estado'], message: MENSAJE_ESTADO_RENDICION }),
      ]);
    },
  );
});
