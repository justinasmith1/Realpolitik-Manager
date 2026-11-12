// Datos y utilidades compartidos por los tests del módulo de rendiciones. Datos ficticios.

export const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
export const RENDICION_ID = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
export const OTRA_ID = 'e1f2a3b4-c5d6-4789-8abc-def012345699';

/** Mediados de octubre de 2026 en Buenos Aires: el período máximo es noviembre. */
export const HOY = new Date('2026-10-15T12:00:00-03:00');

export const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const errorJson = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: 'x', ...(details === undefined ? {} : { details }) } }, status);

export const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

const FECHA = '2026-10-15T15:00:00.000Z';

export function rendicionJson(extra: Record<string, unknown> = {}) {
  return {
    id: RENDICION_ID,
    clienteId: CLIENTE_ID,
    anio: 2026,
    mes: 10,
    numeroFactura: 'A 00001-00000001',
    emisor: 'SOCIEDAD',
    estado: 'EN_CURSO',
    vigencia: 'ACTIVA',
    anuladaEn: null,
    creadoEn: FECHA,
    actualizadoEn: FECHA,
    // Solo lo lee el detalle; el listado lo ignora.
    historial: [{ estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: FECHA }],
    ...extra,
  };
}

export function itemJson(extra: Record<string, unknown> = {}) {
  return {
    id: 'f1a2b3c4-d5e6-4789-8abc-def012345678',
    requisitoClienteId: 'd1e2f3a4-b5c6-4789-8abc-def012345678',
    tipoDocumentoId: 'c1d2e3f4-a5b6-4789-8abc-def012345678',
    nombreTipoDocumento: 'Factura',
    ordinal: 1,
    totalOrdinal: 1,
    diaAproximado: null,
    canalEntrega: 'CORREO',
    completado: false,
    completadoEn: null,
    creadoEn: FECHA,
    actualizadoEn: FECHA,
    ...extra,
  };
}

/** Un documento vigente de un ítem (HU2.8): un ítem reunido lo tiene. */
export const documentoJson = (extra: Record<string, unknown> = {}) => ({
  aplicacionId: 'b1c2d3e4-f5a6-4789-8abc-000000000101',
  documentoId: 'b1c2d3e4-f5a6-4789-8abc-000000000201',
  nombreOriginal: 'factura.pdf',
  tipoContenido: 'application/pdf',
  tamanioBytes: 1024,
  aplicadaEn: FECHA,
  ...extra,
});

/** Un ítem reunido: completado y con su documento vigente. */
export const itemReunidoJson = (extra: Record<string, unknown> = {}) =>
  itemJson({ completado: true, completadoEn: FECHA, documento: documentoJson(), ...extra });

export const resumenJson = (extra: Record<string, unknown> = {}) => ({
  ...rendicionJson(),
  resumen: { totalItems: 4, completados: 1 },
  ...extra,
});
