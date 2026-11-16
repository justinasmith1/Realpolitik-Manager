import { describe, expect, it } from 'vitest';

import { ListarRendicionesQuerySchema } from './listarRendicionesQuery.schema.js';
import {
  ActualizarEstadoRendicionSchema,
  ETIQUETAS_ESTADO_RENDICION,
  EstadoRendicion,
  HistorialEstadoRendicionSchema,
  MENSAJE_ESTADO_RENDICION,
  OrigenCambioEstado,
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
// Una entrada sin responsable registrado (HU4.6): las dos claves van, en null.
const SIN_RESPONSABLE = { registradoPor: null, origen: null };
const ALTA = { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: FECHA, ...SIN_RESPONSABLE };

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
    expect(r).toEqual({
      estadoAnterior: null,
      estadoNuevo: 'EN_CURSO',
      fecha: new Date(FECHA),
      registradoPor: null,
      origen: null,
    });
  });

  it('un cambio lleva el estado anterior y el nuevo', () => {
    const r = HistorialEstadoRendicionSchema.parse({
      estadoAnterior: 'EN_CURSO',
      estadoNuevo: 'COMPLETA',
      fecha: FECHA,
      ...SIN_RESPONSABLE,
    });
    expect(r.estadoAnterior).toBe('EN_CURSO');
    expect(r.estadoNuevo).toBe('COMPLETA');
  });

  it('acepta motivo como texto, como null o sin el campo (HU3.8)', () => {
    const rechazo = {
      estadoAnterior: 'ENVIADA',
      estadoNuevo: 'RECHAZADA',
      fecha: FECHA,
      ...SIN_RESPONSABLE,
    };
    expect(
      HistorialEstadoRendicionSchema.parse({ ...rechazo, motivo: 'Faltó la factura' }).motivo,
    ).toBe('Faltó la factura');
    expect(HistorialEstadoRendicionSchema.parse({ ...rechazo, motivo: null }).motivo).toBeNull();
    expect(HistorialEstadoRendicionSchema.parse(rechazo).motivo).toBeUndefined();
  });

  it.each([
    ['sin estado nuevo', { estadoAnterior: null, fecha: FECHA, ...SIN_RESPONSABLE }],
    ['sin fecha', { estadoAnterior: null, estadoNuevo: 'EN_CURSO', ...SIN_RESPONSABLE }],
    ['con un estado desconocido', { ...ALTA, estadoNuevo: 'ATRASADA' }],
  ])('rechaza una entrada %s', (_caso, entrada) => {
    expect(HistorialEstadoRendicionSchema.safeParse(entrada).success).toBe(false);
  });
});

// Responsable del cambio (HU4.6): quién lo registró y si fue manual o automático. Es parte de la
// respuesta; el pedido no lo trae (sale de la sesión).
describe('OrigenCambioEstado', () => {
  it('son exactamente MANUAL y AUTOMATICO', () => {
    expect(OrigenCambioEstado.options).toEqual(['MANUAL', 'AUTOMATICO']);
  });

  it.each(['manual', 'SISTEMA', '', 1])('rechaza %j', (valor) => {
    expect(OrigenCambioEstado.safeParse(valor).success).toBe(false);
  });
});

describe('HistorialEstadoRendicionSchema: responsable y origen (HU4.6)', () => {
  const RESPONSABLE = { id: 'b2c3d4e5-f6a7-4890-8bcd-ef0123456789', nombre: 'Ana Pérez' };
  const CAMBIO = { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: FECHA } as const;

  it.each(['MANUAL', 'AUTOMATICO'] as const)('lee el responsable con origen %s', (origen) => {
    const r = HistorialEstadoRendicionSchema.parse({
      ...CAMBIO,
      registradoPor: RESPONSABLE,
      origen,
    });
    expect(r.registradoPor).toEqual(RESPONSABLE);
    expect(r.origen).toBe(origen);
  });

  it('una entrada sin responsable registrado trae los dos en null', () => {
    const r = HistorialEstadoRendicionSchema.parse({
      ...CAMBIO,
      registradoPor: null,
      origen: null,
    });
    expect(r).toMatchObject({ registradoPor: null, origen: null });
  });

  // El contrato exige las dos claves: `null` dice "sin registro"; que falte es un error del backend.
  it.each([
    ['sin registradoPor ni origen', {}],
    ['sin registradoPor', { origen: 'MANUAL' }],
    ['sin origen', { registradoPor: RESPONSABLE }],
  ])('rechaza una entrada %s', (_caso, campos) => {
    expect(HistorialEstadoRendicionSchema.safeParse({ ...CAMBIO, ...campos }).success).toBe(false);
  });

  it('del responsable solo expone el id y el nombre', () => {
    const r = HistorialEstadoRendicionSchema.parse({
      ...CAMBIO,
      registradoPor: { ...RESPONSABLE, email: 'ana@example.com', rol: 'ADMINISTRADOR' },
      origen: 'MANUAL',
    });
    expect(r.registradoPor).toEqual(RESPONSABLE);
  });

  it.each([
    ['un id que no es UUID', { registradoPor: { ...RESPONSABLE, id: '123' }, origen: 'MANUAL' }],
    ['un responsable sin nombre', { registradoPor: { id: RESPONSABLE.id }, origen: 'MANUAL' }],
    [
      'un nombre que no es texto',
      { registradoPor: { ...RESPONSABLE, nombre: 7 }, origen: 'MANUAL' },
    ],
    ['el responsable como texto', { registradoPor: 'Ana Pérez', origen: 'MANUAL' }],
    ['un origen desconocido', { registradoPor: RESPONSABLE, origen: 'SISTEMA' }],
    ['un origen que no es texto', { registradoPor: RESPONSABLE, origen: true }],
  ])('rechaza %s', (_caso, campos) => {
    expect(HistorialEstadoRendicionSchema.safeParse({ ...CAMBIO, ...campos }).success).toBe(false);
  });

  it('el pedido de cambio de estado no acepta un responsable: lo descarta', () => {
    const pedido = ActualizarEstadoRendicionSchema.parse({
      estado: 'COMPLETA',
      registradoPorId: RESPONSABLE.id,
      registradoPor: RESPONSABLE,
      origen: 'AUTOMATICO',
    });
    expect(pedido).toEqual({ estado: 'COMPLETA' });
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
        {
          estadoAnterior: 'EN_CURSO',
          estadoNuevo: 'COMPLETA',
          fecha: '2026-11-04T12:00:00.000Z',
          ...SIN_RESPONSABLE,
        },
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
