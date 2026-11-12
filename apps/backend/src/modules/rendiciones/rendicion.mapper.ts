import type {
  ItemChecklist as ItemChecklistRow,
  Prisma,
  Rendicion as RendicionRow,
} from '@prisma/client';
import {
  esAtrasada,
  ESTADOS_CON_FECHA,
  fechaDelPaso,
  ItemChecklistSchema,
  periodoAMeses,
  RendicionAtrasadaSchema,
  RendicionDelMesSchema,
  RendicionDetalleSchema,
  RendicionResumenSchema,
  RendicionSchema,
  type ItemChecklist,
  type Rendicion,
  type RendicionAtrasada,
  type RendicionDelMes,
  type RendicionDetalle,
  type RendicionResumen,
} from '@realpolitik/shared';

// Filas de Prisma → rendición del contrato (sección 4.5). Los campos se copian uno por uno:
// `isDeleted` y `deletedAt` no salen; la vigencia se deriva de la baja lógica (`ANULADA` y su
// fecha en `anuladaEn`). `createdAt`/`updatedAt`/`completadoAt` pasan a `creadoEn`/
// `actualizadoEn`/`completadoEn`. Cada salida se valida con el schema de shared: un dato que no
// cumple el contrato termina en un 500, no en un JSON inválido.

/**
 * La aplicación vigente de un ítem (HU2.8, ADR-0004) con los datos del archivo que se muestran.
 * Nunca el hash ni la clave del almacenamiento. Como hay a lo sumo una vigente por ítem (índice
 * único parcial), la lista tiene cero o un elemento.
 */
export const APLICACION_VIGENTE = {
  where: { reemplazadaEn: null },
  select: {
    id: true,
    documentoId: true,
    aplicadaEn: true,
    documento: { select: { nombreOriginal: true, tipoContenido: true, tamanioBytes: true } },
  },
} satisfies Prisma.ItemChecklist$aplicacionesArgs;

type AplicacionVigenteRow = Prisma.AplicacionDocumentoGetPayload<typeof APLICACION_VIGENTE>;

/**
 * El historial de estados de una rendición (HU3.1), del cambio más viejo al más nuevo. Dos cambios
 * con la misma fecha quedan en el orden en que se registraron.
 */
export const HISTORIAL_EN_ORDEN = {
  orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
  select: { estadoAnterior: true, estadoNuevo: true, fecha: true, fechaEfectiva: true },
} satisfies Prisma.Rendicion$historialArgs;

type HistorialRow = Prisma.HistorialEstadoRendicionGetPayload<typeof HISTORIAL_EN_ORDEN>;

/**
 * Una columna `DATE` de PostgreSQL → día del contrato (`AAAA-MM-DD`). Prisma la lee como la
 * medianoche UTC de ese día, así que el día es la parte de la fecha en UTC (no en Buenos Aires,
 * que sería el día anterior).
 */
export const diaDeColumnaDate = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Un día del contrato (`AAAA-MM-DD`) → valor para una columna `DATE` de Prisma. */
export const columnaDateDeDia = (dia: string): Date => new Date(`${dia}T00:00:00.000Z`);

/** La fecha efectiva de una entrada como día, o `null` si no tiene. */
const diaEfectivoDe = (fecha: Date | null | undefined): string | null =>
  fecha instanceof Date ? diaDeColumnaDate(fecha) : null;

const entradaDeHistorial = (row: HistorialRow) => ({
  estadoAnterior: row.estadoAnterior,
  estadoNuevo: row.estadoNuevo,
  fecha: row.fecha,
  fechaEfectiva: diaEfectivoDe(row.fechaEfectiva),
});

/** Un ítem y, si se cargó, su aplicación vigente. */
export type ItemConDocumento = ItemChecklistRow & { aplicaciones?: AplicacionVigenteRow[] };

export type RendicionConItems = RendicionRow & {
  items: ItemConDocumento[];
  historial: HistorialRow[];
};

export interface ResumenDeAvance {
  totalItems: number;
  completados: number;
}

const camposDeRendicion = (row: RendicionRow) => ({
  id: row.id,
  clienteId: row.clienteId,
  anio: row.anio,
  mes: row.mes,
  numeroFactura: row.numeroFactura,
  emisor: row.emisor,
  numeroOc: row.numeroOc,
  montoMensual: row.montoMensual?.toNumber() ?? null,
  montoTotal: row.montoTotal?.toNumber() ?? null,
  estado: row.estado,
  vigencia: row.isDeleted ? 'ANULADA' : 'ACTIVA',
  anuladaEn: row.isDeleted ? row.deletedAt : null,
  creadoEn: row.createdAt,
  actualizadoEn: row.updatedAt,
});

const camposDeItem = (row: ItemConDocumento) => ({
  id: row.id,
  requisitoClienteId: row.requisitoClienteId,
  tipoDocumentoId: row.tipoDocumentoId,
  nombreTipoDocumento: row.nombreTipoDocumento,
  ordinal: row.ordinal,
  totalOrdinal: row.totalOrdinal,
  diaAproximado: row.diaAproximado,
  canalEntrega: row.canalEntrega,
  completado: row.completado,
  completadoEn: row.completadoAt,
  creadoEn: row.createdAt,
  actualizadoEn: row.updatedAt,
  // Solo si la consulta cargó las aplicaciones: el detalle siempre lo hace (`documento` es el
  // vigente o `null`). `ItemChecklistSchema.documento` todavía es opcional en el contrato.
  ...(row.aplicaciones !== undefined && { documento: documentoVigente(row.aplicaciones) }),
});

function documentoVigente(aplicaciones: readonly AplicacionVigenteRow[]) {
  const [vigente] = aplicaciones;
  if (vigente === undefined) return null;
  return {
    aplicacionId: vigente.id,
    documentoId: vigente.documentoId,
    nombreOriginal: vigente.documento.nombreOriginal,
    tipoContenido: vigente.documento.tipoContenido,
    tamanioBytes: vigente.documento.tamanioBytes,
    aplicadaEn: vigente.aplicadaEn,
  };
}

/** Rendición sin ítems: la respuesta de la anulación. */
export function toRendicionDto(row: RendicionRow): Rendicion {
  return RendicionSchema.parse(camposDeRendicion(row));
}

/** Ítem del checklist. */
export function toItemChecklistDto(row: ItemConDocumento): ItemChecklist {
  return ItemChecklistSchema.parse(camposDeItem(row));
}

/** Rendición con su checklist y su historial de estados: el detalle y la respuesta del alta. */
export function toRendicionDetalleDto(row: RendicionConItems): RendicionDetalle {
  return RendicionDetalleSchema.parse({
    ...camposDeRendicion(row),
    items: row.items.map(camposDeItem),
    historial: row.historial.map(entradaDeHistorial),
  });
}

/** Rendición con el avance de su checklist, sin ítems: el listado de un cliente. */
export function toRendicionResumenDto(
  row: RendicionRow,
  resumen: ResumenDeAvance,
): RendicionResumen {
  return RendicionResumenSchema.parse({ ...camposDeRendicion(row), resumen });
}

// ─── Pantalla Rendiciones (HU3.2) ─────────────────────────────────────────────

/**
 * Lo que lee el listado del mes de cada rendición: su cliente (nombre corto y tipología) y la
 * última entrada de su historial, la que la llevó al estado actual.
 */
export const SELECT_DEL_MES = {
  id: true,
  clienteId: true,
  anio: true,
  mes: true,
  numeroFactura: true,
  estado: true,
  cliente: { select: { denominacion: true, sector: true, subtipo: true } },
  historial: {
    orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: { estadoNuevo: true, fecha: true, fechaEfectiva: true },
  },
} satisfies Prisma.RendicionSelect;

type RendicionDelMesRow = Prisma.RendicionGetPayload<{ select: typeof SELECT_DEL_MES }>;

const tieneFecha = (estado: string): estado is (typeof ESTADOS_CON_FECHA)[number] =>
  (ESTADOS_CON_FECHA as readonly string[]).includes(estado);

/** Los datos de una fila de la pantalla Rendiciones, sin validar (los valida quien la arma). */
function datosDeFila(row: RendicionDelMesRow, avance: ResumenDeAvance, hoy: Date) {
  const [ultima] = row.historial;
  // La fecha es la de la entrada que la llevó al estado actual: la última, si coincide. En una
  // Enviada, la fecha de envío elegida (HU3.7), no la del registro.
  const ultimoPaso =
    tieneFecha(row.estado) && ultima !== undefined && ultima.estadoNuevo === row.estado
      ? {
          estado: row.estado,
          fecha: fechaDelPaso({
            fecha: ultima.fecha,
            fechaEfectiva: diaEfectivoDe(ultima.fechaEfectiva),
          }),
        }
      : null;
  return {
    id: row.id,
    clienteId: row.clienteId,
    cliente: row.cliente,
    numeroFactura: row.numeroFactura,
    estado: row.estado,
    avance: {
      reunidos: avance.completados,
      total: avance.totalItems,
      faltantes: avance.totalItems - avance.completados,
    },
    ultimoPaso,
    // HU3.4: se calcula con la regla de shared; las anuladas ya no llegan acá.
    atrasada: esAtrasada({ anio: row.anio, mes: row.mes }, row.estado, hoy),
  };
}

const SIN_ITEMS: ResumenDeAvance = { totalItems: 0, completados: 0 };

/** Porcentaje de ítems reunidos. Sin ítems, 0. */
const porcentaje = ({ avance }: RendicionDelMes) =>
  avance.total === 0 ? 0 : avance.reunidos / avance.total;

/**
 * El orden de la pantalla: primero las atrasadas (HU3.4: hay que mandarlas ya), después las
 * Rechazadas (hay que corregirlas), después el resto, de menor a mayor avance; a igual avance, por
 * nombre del cliente. La factura y el id solo desempatan para que el orden sea siempre el mismo.
 */
export function compararRendicionesDelMes(a: RendicionDelMes, b: RendicionDelMes): number {
  const atrasada = Number(b.atrasada) - Number(a.atrasada);
  if (atrasada !== 0) return atrasada;
  const rechazada = Number(b.estado === 'RECHAZADA') - Number(a.estado === 'RECHAZADA');
  if (rechazada !== 0) return rechazada;
  const avance = porcentaje(a) - porcentaje(b);
  if (avance !== 0) return avance;
  return (
    a.cliente.denominacion.localeCompare(b.cliente.denominacion, 'es', { sensitivity: 'base' }) ||
    a.numeroFactura.localeCompare(b.numeroFactura) ||
    a.id.localeCompare(b.id)
  );
}

/** Las filas de la pantalla Rendiciones, ya ordenadas. `hoy` decide cuáles están atrasadas. */
export function toRendicionesDelMesDto(
  rows: readonly RendicionDelMesRow[],
  avances: ReadonlyMap<string, ResumenDeAvance>,
  hoy: Date = new Date(),
): RendicionDelMes[] {
  return rows
    .map((row) =>
      RendicionDelMesSchema.parse(datosDeFila(row, avances.get(row.id) ?? SIN_ITEMS, hoy)),
    )
    .sort(compararRendicionesDelMes);
}

/**
 * El orden del listado de atrasadas (HU3.4): de la más vieja a la más nueva (período ascendente);
 * a igual período, por nombre del cliente. La factura y el id solo desempatan.
 */
export function compararRendicionesAtrasadas(a: RendicionAtrasada, b: RendicionAtrasada): number {
  return (
    periodoAMeses(a) - periodoAMeses(b) ||
    a.cliente.denominacion.localeCompare(b.cliente.denominacion, 'es', { sensitivity: 'base' }) ||
    a.numeroFactura.localeCompare(b.numeroFactura) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Las filas del listado de atrasadas, con su período, ya ordenadas. Las filas llegan filtradas por
 * la base con el mismo límite; igual se descarta cualquiera que la regla no marque, para que el
 * listado y la marca de cada fila no puedan contradecirse.
 */
export function toRendicionesAtrasadasDto(
  rows: readonly RendicionDelMesRow[],
  avances: ReadonlyMap<string, ResumenDeAvance>,
  hoy: Date = new Date(),
): RendicionAtrasada[] {
  return rows
    .map((row) =>
      RendicionAtrasadaSchema.parse({
        ...datosDeFila(row, avances.get(row.id) ?? SIN_ITEMS, hoy),
        anio: row.anio,
        mes: row.mes,
      }),
    )
    .filter((fila) => fila.atrasada)
    .sort(compararRendicionesAtrasadas);
}
