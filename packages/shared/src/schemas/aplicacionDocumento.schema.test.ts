import { describe, expect, it } from 'vitest';

import {
  AplicacionConDocumentoSchema,
  AplicacionDocumentoSchema,
  AplicarDocumentoSchema,
  CandidatoAplicacionSchema,
  DocumentoConAplicacionesSchema,
  HistorialDeItemSchema,
  MAX_ITEMS_A_APLICAR,
  MENSAJE_ITEM_IDS,
  ReemplazarDocumentoDeItemSchema,
} from './aplicacionDocumento.schema.js';
import { ItemChecklistSchema, RendicionDetalleSchema } from './rendicion.schema.js';

const id = (n: number) => `b1c2d3e4-f5a6-4789-8abc-${String(n).padStart(12, '0')}`;

const DOCUMENTO_ID = id(1);
const ITEM_ID = id(2);
const TIPO_ID = id(3);

const vigente = {
  id: id(10),
  documentoId: DOCUMENTO_ID,
  itemChecklistId: ITEM_ID,
  estado: 'VIGENTE',
  aplicadaEn: '2026-10-29T12:00:00.000Z',
  reemplazadaEn: null,
  reemplazaAId: null,
};

const reemplazada = {
  ...vigente,
  id: id(11),
  estado: 'REEMPLAZADA',
  reemplazadaEn: '2026-10-30T09:00:00.000Z',
};

const documento = {
  id: DOCUMENTO_ID,
  tipoDocumento: { id: TIPO_ID, nombre: 'Print' },
  anio: 2026,
  mes: 10,
  nombreOriginal: 'print-semana-1.png',
  tipoContenido: 'image/png',
  tamanioBytes: 1024,
  creadoEn: '2026-10-29T11:00:00.000Z',
  actualizadoEn: '2026-10-29T11:00:00.000Z',
};

const cliente = { id: id(20), denominacion: 'Municipio de Ejemplo', estado: 'ACTIVO' };
const rendicion = { id: id(21), anio: 2026, mes: 10, numeroFactura: 'B 00002-00001482' };
const item = {
  id: ITEM_ID,
  tipoDocumentoId: TIPO_ID,
  nombreTipoDocumento: 'Print',
  ordinal: 2,
  totalOrdinal: 5,
  diaAproximado: 8,
};

describe('AplicarDocumentoSchema', () => {
  it('acepta uno o varios ítems', () => {
    expect(AplicarDocumentoSchema.parse({ itemIds: [id(1)] })).toEqual({ itemIds: [id(1)] });
    expect(AplicarDocumentoSchema.parse({ itemIds: [id(1), id(2)] })).toEqual({
      itemIds: [id(1), id(2)],
    });
  });

  it('ignora otros campos: el documento va en la ruta', () => {
    expect(AplicarDocumentoSchema.parse({ itemIds: [id(1)], documentoId: id(9) })).toEqual({
      itemIds: [id(1)],
    });
  });

  it(`acepta hasta ${MAX_ITEMS_A_APLICAR} ítems y rechaza uno más`, () => {
    const ids = Array.from({ length: MAX_ITEMS_A_APLICAR + 1 }, (_, n) => id(n));
    expect(AplicarDocumentoSchema.safeParse({ itemIds: ids.slice(1) }).success).toBe(true);
    expect(AplicarDocumentoSchema.safeParse({ itemIds: ids }).success).toBe(false);
  });

  it.each([
    ['una lista vacía', { itemIds: [] }],
    ['un ítem repetido', { itemIds: [id(1), id(1)] }],
    ['un id que no es uuid', { itemIds: ['no-es-uuid'] }],
    ['un texto en vez de una lista', { itemIds: id(1) }],
    ['sin el campo', {}],
  ])('rechaza %s con un mensaje en español', (_caso, cuerpo) => {
    const r = AplicarDocumentoSchema.safeParse(cuerpo);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]).toMatchObject({ message: MENSAJE_ITEM_IDS });
      expect(r.error.issues[0]?.path[0]).toBe('itemIds');
    }
  });
});

describe('ReemplazarDocumentoDeItemSchema', () => {
  const pedido = { documentoId: id(5), aplicacionVigenteId: id(6) };

  it('acepta el documento nuevo y la aplicación vigente que se reemplaza', () => {
    expect(ReemplazarDocumentoDeItemSchema.parse(pedido)).toEqual(pedido);
  });

  it.each([
    ['un documento que no es uuid', { documentoId: 'x' }, 'documentoId'],
    ['una aplicación vigente que no es uuid', { aplicacionVigenteId: 'x' }, 'aplicacionVigenteId'],
    ['sin documento', { documentoId: undefined }, 'documentoId'],
    ['sin aplicación vigente', { aplicacionVigenteId: undefined }, 'aplicacionVigenteId'],
  ])('rechaza %s', (_caso, cambio, campo) => {
    const r = ReemplazarDocumentoDeItemSchema.safeParse({ ...pedido, ...cambio });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((issue) => issue.path.join('.'))).toEqual([campo]);
    }
  });
});

describe('AplicacionDocumentoSchema', () => {
  it('lee una aplicación vigente', () => {
    const r = AplicacionDocumentoSchema.parse(vigente);
    expect(r.estado).toBe('VIGENTE');
    expect(r.aplicadaEn).toBeInstanceOf(Date);
    expect(r.reemplazadaEn).toBeNull();
  });

  it('lee una reemplazada y la que la reemplazó', () => {
    expect(AplicacionDocumentoSchema.parse(reemplazada).reemplazadaEn).toBeInstanceOf(Date);
    expect(
      AplicacionDocumentoSchema.parse({ ...vigente, id: id(12), reemplazaAId: id(11) })
        .reemplazaAId,
    ).toBe(id(11));
  });

  it.each([
    ['vigente con fecha de reemplazo', { ...reemplazada, estado: 'VIGENTE' }],
    ['reemplazada sin fecha de reemplazo', { ...vigente, estado: 'REEMPLAZADA' }],
  ])('rechaza un estado incoherente: %s', (_caso, aplicacion) => {
    const r = AplicacionDocumentoSchema.safeParse(aplicacion);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['estado']);
  });

  it.each([
    ['un estado desconocido', { estado: 'BORRADA' }],
    ['un ítem que no es uuid', { itemChecklistId: 'x' }],
    ['un documento que no es uuid', { documentoId: 'x' }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(AplicacionDocumentoSchema.safeParse({ ...vigente, ...cambio }).success).toBe(false);
  });
});

describe('DocumentoConAplicacionesSchema', () => {
  const ubicacion = { cliente, rendicion: { ...rendicion, estado: 'ACTIVA' }, item };

  it('lee un documento sin aplicaciones (cargado y todavía sin aplicar)', () => {
    expect(
      DocumentoConAplicacionesSchema.parse({ ...documento, aplicaciones: [] }).aplicaciones,
    ).toEqual([]);
  });

  it('lee dónde está aplicado, también en una rendición anulada', () => {
    const r = DocumentoConAplicacionesSchema.parse({
      ...documento,
      aplicaciones: [
        { ...vigente, ubicacion },
        {
          ...reemplazada,
          ubicacion: { ...ubicacion, rendicion: { ...rendicion, id: id(22), estado: 'ANULADA' } },
        },
      ],
    });
    expect(r.aplicaciones.map((a) => a.ubicacion.rendicion.estado)).toEqual(['ACTIVA', 'ANULADA']);
    expect(r.aplicaciones[0]?.ubicacion.item.ordinal).toBe(2);
  });

  it('rechaza una aplicación sin ubicación o con un estado incoherente', () => {
    expect(
      DocumentoConAplicacionesSchema.safeParse({ ...documento, aplicaciones: [vigente] }).success,
    ).toBe(false);
    expect(
      DocumentoConAplicacionesSchema.safeParse({
        ...documento,
        aplicaciones: [{ ...vigente, estado: 'REEMPLAZADA', ubicacion }],
      }).success,
    ).toBe(false);
  });
});

describe('HistorialDeItemSchema', () => {
  it('lee el historial de un ítem, de la más reciente a la más vieja', () => {
    const r = HistorialDeItemSchema.parse({
      itemChecklistId: ITEM_ID,
      aplicaciones: [
        { ...vigente, id: id(12), reemplazaAId: id(11), documento: { ...documento, id: id(7) } },
        { ...reemplazada, documento },
      ],
    });
    expect(r.aplicaciones.map((a) => a.estado)).toEqual(['VIGENTE', 'REEMPLAZADA']);
    expect(r.aplicaciones[1]?.documento.nombreOriginal).toBe('print-semana-1.png');
  });

  it('un ítem sin documentos tiene el historial vacío', () => {
    expect(HistorialDeItemSchema.parse({ itemChecklistId: ITEM_ID, aplicaciones: [] })).toEqual({
      itemChecklistId: ITEM_ID,
      aplicaciones: [],
    });
  });

  it('cada paso exige su documento', () => {
    expect(AplicacionConDocumentoSchema.safeParse(vigente).success).toBe(false);
  });
});

describe('CandidatoAplicacionSchema', () => {
  const candidato = { cliente, rendicion, item, elegibilidad: 'ELEGIBLE' };

  it.each(['ELEGIBLE', 'YA_TIENE_ESTE_DOCUMENTO', 'TIENE_OTRO_DOCUMENTO'])(
    'lee un candidato %s',
    (elegibilidad) => {
      expect(CandidatoAplicacionSchema.parse({ ...candidato, elegibilidad }).elegibilidad).toBe(
        elegibilidad,
      );
    },
  );

  it('lleva el ítem exacto (Print 2/5) y el estado del cliente', () => {
    const r = CandidatoAplicacionSchema.parse({
      ...candidato,
      cliente: { ...cliente, estado: 'INACTIVO' },
    });
    expect(r.item).toMatchObject({ ordinal: 2, totalOrdinal: 5 });
    expect(r.cliente.estado).toBe('INACTIVO');
  });

  it.each([
    ['una elegibilidad desconocida', { elegibilidad: 'ANULADA' }],
    ['un ítem sin ordinal', { item: { ...item, ordinal: undefined } }],
    ['un ordinal 0', { item: { ...item, ordinal: 0 } }],
    ['una rendición sin factura', { rendicion: { ...rendicion, numeroFactura: undefined } }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(CandidatoAplicacionSchema.safeParse({ ...candidato, ...cambio }).success).toBe(false);
  });
});

describe('Compatibilidad: el documento del ítem en el checklist', () => {
  const itemChecklist = {
    id: ITEM_ID,
    requisitoClienteId: id(30),
    tipoDocumentoId: TIPO_ID,
    nombreTipoDocumento: 'Print',
    ordinal: 2,
    totalOrdinal: 5,
    diaAproximado: 8,
    canalEntrega: 'WHATSAPP',
    completado: false,
    completadoEn: null,
    creadoEn: '2026-10-20T12:00:00.000Z',
    actualizadoEn: '2026-10-20T12:00:00.000Z',
  };

  it('un ítem como lo devuelve hoy el backend (sin `documento`) se sigue leyendo igual', () => {
    const r = ItemChecklistSchema.parse(itemChecklist);
    expect(r).not.toHaveProperty('documento');
    expect(
      RendicionDetalleSchema.parse({
        id: id(21),
        clienteId: id(20),
        anio: 2026,
        mes: 10,
        numeroFactura: 'B 00002-00001482',
        estado: 'ACTIVA',
        anuladaEn: null,
        creadoEn: '2026-10-20T12:00:00.000Z',
        actualizadoEn: '2026-10-20T12:00:00.000Z',
        items: [itemChecklist],
      }).items,
    ).toHaveLength(1);
  });

  it('un ítem sin documento vigente trae `documento: null`', () => {
    expect(ItemChecklistSchema.parse({ ...itemChecklist, documento: null }).documento).toBeNull();
  });

  it('un ítem reunido trae su documento vigente', () => {
    const r = ItemChecklistSchema.parse({
      ...itemChecklist,
      completado: true,
      completadoEn: '2026-10-29T12:00:00.000Z',
      documento: {
        aplicacionId: id(10),
        documentoId: DOCUMENTO_ID,
        nombreOriginal: 'print-semana-1.png',
        tipoContenido: 'image/png',
        tamanioBytes: 1024,
        aplicadaEn: '2026-10-29T12:00:00.000Z',
      },
    });
    expect(r.documento?.aplicadaEn).toBeInstanceOf(Date);
    expect(r.documento?.documentoId).toBe(DOCUMENTO_ID);
  });

  it('rechaza un documento del ítem mal formado', () => {
    expect(
      ItemChecklistSchema.safeParse({ ...itemChecklist, documento: { documentoId: 'x' } }).success,
    ).toBe(false);
  });
});
