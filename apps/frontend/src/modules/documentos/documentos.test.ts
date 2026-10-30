import {
  MENSAJE_FORMATO_DOCUMENTO,
  MENSAJE_TAMANIO_DOCUMENTO,
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
  type CandidatoAplicacion,
} from '@realpolitik/shared';

import { ApiClientError } from '@/lib/http';
import {
  interpretarFalloAplicacion,
  interpretarFalloCarga,
  interpretarFalloReemplazo,
  sinDocumentosHabilitados,
} from '@/modules/documentos/api/documentos.api';
import {
  agruparCandidatos,
  cantidadDeItems,
  formatoLegible,
  problemaDelArchivo,
  resumenDeSeleccion,
  tamanioLegible,
} from '@/modules/documentos/documentos.etiquetas';

const archivo = (nombre: string, bytes: number) =>
  new File([new Uint8Array(bytes)], nombre, { type: 'application/octet-stream' });

describe('problemaDelArchivo (antes de subir)', () => {
  it.each(['a.pdf', 'Foto.JPG', 'foto.jpeg', 'b.png', 'nota.docx'])('acepta %s', (nombre) => {
    expect(problemaDelArchivo(archivo(nombre, 10))).toBeNull();
  });

  it.each(['programa.exe', 'nota.doc', 'sin-extension', 'planilla.xlsx'])(
    'rechaza %s',
    (nombre) => {
      expect(problemaDelArchivo(archivo(nombre, 10))).toBe(MENSAJE_FORMATO_DOCUMENTO);
    },
  );

  it('rechaza un archivo vacío o de más de 10 MB', () => {
    expect(problemaDelArchivo(archivo('a.pdf', 0))).toBe(MENSAJE_TAMANIO_DOCUMENTO);
    expect(problemaDelArchivo(archivo('a.pdf', TAMANIO_MAXIMO_DOCUMENTO_BYTES + 1))).toBe(
      MENSAJE_TAMANIO_DOCUMENTO,
    );
  });
});

describe('etiquetas', () => {
  it('nombra cantidades, tamaños y formatos como los lee la operadora', () => {
    expect(cantidadDeItems(0)).toBe('Sin aplicar');
    expect(cantidadDeItems(1)).toBe('1 ítem');
    expect(cantidadDeItems(4)).toBe('4 ítems');
    expect(resumenDeSeleccion(1, 1)).toBe('1 ítem en 1 rendición');
    expect(resumenDeSeleccion(3, 2)).toBe('3 ítems en 2 rendiciones');
    expect(tamanioLegible(512)).toBe('512 B');
    expect(tamanioLegible(2048)).toBe('2 KB');
    expect(tamanioLegible(2.5 * 1024 * 1024)).toBe('2,5 MB');
    expect(formatoLegible('image/jpeg')).toBe('JPG');
    expect(formatoLegible('application/msword')).toBe('application/msword');
  });
});

describe('agruparCandidatos', () => {
  const candidato = (cliente: string, rendicion: string, itemId: string): CandidatoAplicacion => ({
    cliente: { id: cliente, denominacion: cliente, estado: 'ACTIVO' },
    rendicion: { id: rendicion, anio: 2026, mes: 10, numeroFactura: rendicion },
    item: {
      id: itemId,
      tipoDocumentoId: 't',
      nombreTipoDocumento: 'Print',
      ordinal: 1,
      totalOrdinal: 1,
      diaAproximado: null,
    },
    elegibilidad: 'ELEGIBLE',
  });

  it('agrupa por cliente y rendición, respetando el orden de la API', () => {
    const grupos = agruparCandidatos([
      candidato('A', 'r1', 'i1'),
      candidato('A', 'r1', 'i2'),
      candidato('A', 'r2', 'i3'),
      candidato('B', 'r3', 'i4'),
    ]);
    expect(
      grupos.map((g) => [
        g.cliente.id,
        g.rendiciones.map((r) => [r.rendicion.id, r.items.map((i) => i.id)]),
      ]),
    ).toEqual([
      [
        'A',
        [
          ['r1', ['i1', 'i2']],
          ['r2', ['i3']],
        ],
      ],
      ['B', [['r3', ['i4']]]],
    ]);
  });
});

const http = (status: number, details?: unknown, code = 'X') =>
  new ApiClientError({
    kind: 'http',
    message: `HTTP ${status}`,
    status,
    payload: { error: { code, message: 'x', details } },
  });

describe('interpretarFalloCarga', () => {
  it('clasifica los fallos de la carga', () => {
    expect(
      interpretarFalloCarga(
        http(400, [{ campo: 'archivo', mensaje: 'El formato no está admitido.' }]),
      ),
    ).toEqual({ tipo: 'archivo', mensaje: 'El formato no está admitido.' });
    expect(interpretarFalloCarga(http(413))).toEqual({ tipo: 'demasiado-grande' });
    expect(interpretarFalloCarga(http(404))).toEqual({ tipo: 'tipo-inexistente' });
    expect(interpretarFalloCarga(http(409, { motivo: 'TIPO_DOCUMENTO_INACTIVO' }))).toEqual({
      tipo: 'tipo-inactivo',
    });
    expect(interpretarFalloCarga(http(503))).toEqual({ tipo: 'almacenamiento' });
    expect(
      interpretarFalloCarga(new ApiClientError({ kind: 'network', message: 'sin red' })),
    ).toEqual({ tipo: 'conexion' });
    expect(interpretarFalloCarga(http(500))).toEqual({ tipo: 'inesperado' });
  });
});

describe('interpretarFalloAplicacion', () => {
  it('lee el motivo y el ítem de un 409', () => {
    expect(
      interpretarFalloAplicacion(http(409, { motivo: 'ITEM_NO_PENDIENTE', itemId: 'i2' })),
    ).toEqual({ tipo: 'rechazado', motivo: 'ITEM_NO_PENDIENTE', itemId: 'i2' });
    expect(interpretarFalloAplicacion(http(409, { motivo: 'RENDICION_ANULADA' }))).toEqual({
      tipo: 'rechazado',
      motivo: 'RENDICION_ANULADA',
      itemId: null,
    });
  });

  it('un 409 desconocido, un 404 o un 500 no se confunden', () => {
    expect(interpretarFalloAplicacion(http(409, { motivo: 'OTRO' }))).toEqual({
      tipo: 'inesperado',
    });
    expect(interpretarFalloAplicacion(http(404))).toEqual({ tipo: 'no-existe' });
    expect(interpretarFalloAplicacion(http(500))).toEqual({ tipo: 'inesperado' });
  });
});

describe('interpretarFalloReemplazo', () => {
  it('distingue el vigente desactualizado, el mismo documento y los rechazos', () => {
    expect(interpretarFalloReemplazo(http(409, { motivo: 'APLICACION_DESACTUALIZADA' }))).toEqual({
      tipo: 'desactualizada',
    });
    expect(interpretarFalloReemplazo(http(409, { motivo: 'DOCUMENTO_YA_VIGENTE' }))).toEqual({
      tipo: 'ya-vigente',
    });
    expect(interpretarFalloReemplazo(http(409, { motivo: 'RENDICION_ANULADA' }))).toEqual({
      tipo: 'rechazado',
      motivo: 'RENDICION_ANULADA',
    });
    expect(interpretarFalloReemplazo(http(409, { motivo: 'ITEM_NO_PENDIENTE' }))).toEqual({
      tipo: 'inesperado',
    });
    expect(interpretarFalloReemplazo(http(404))).toEqual({ tipo: 'no-existe' });
    expect(
      interpretarFalloReemplazo(new ApiClientError({ kind: 'network', message: 'sin red' })),
    ).toEqual({ tipo: 'conexion' });
    expect(interpretarFalloReemplazo(http(500))).toEqual({ tipo: 'inesperado' });
  });
});

describe('sinDocumentosHabilitados', () => {
  it('solo un 404 del listado significa que el backend no tiene documentos', () => {
    expect(sinDocumentosHabilitados(http(404))).toBe(true);
    expect(sinDocumentosHabilitados(http(500))).toBe(false);
    expect(
      sinDocumentosHabilitados(new ApiClientError({ kind: 'network', message: 'sin red' })),
    ).toBe(false);
  });
});
