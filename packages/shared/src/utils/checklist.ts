import type { CanalEntrega } from '../schemas/cliente.schema.js';

import { problemaDeDias } from './diasAproximados.js';

// Generación del checklist de una rendición (ADR-0003, contrato sección 4.5). Son funciones
// puras: no leen la base ni el reloj, no mutan lo que reciben y dan siempre el mismo resultado.

/** Por qué no se pudo generar el checklist. */
export type CodigoErrorChecklist = 'MATRIZ_VACIA' | 'CANTIDAD_INVALIDA' | 'DIAS_INCOHERENTES';

const CODIGOS: readonly CodigoErrorChecklist[] = [
  'MATRIZ_VACIA',
  'CANTIDAD_INVALIDA',
  'DIAS_INCOHERENTES',
];

const NOMBRE_DEL_ERROR = 'ChecklistError';

/**
 * Error de `generarChecklist`. El `codigo` dice qué pasó para que el backend lo traduzca
 * (`MATRIZ_VACIA` a un 409). Para reconocerlo usá `esChecklistError`, no `instanceof`.
 */
export class ChecklistError extends Error {
  readonly codigo: CodigoErrorChecklist;

  constructor(codigo: CodigoErrorChecklist, mensaje: string) {
    super(mensaje);
    this.name = NOMBRE_DEL_ERROR;
    this.codigo = codigo;
  }
}

/**
 * `true` si `e` es un `ChecklistError`. Compara por `name` y por `codigo` y no con `instanceof`:
 * el paquete se publica en ESM y en CJS, y si el backend carga las dos copias, un error lanzado
 * por una no es `instanceof` de la clase de la otra.
 */
export function esChecklistError(e: unknown): e is ChecklistError {
  if (typeof e !== 'object' || e === null) return false;
  const { name, codigo } = e as { name?: unknown; codigo?: unknown };
  return name === NOMBRE_DEL_ERROR && CODIGOS.some((conocido) => conocido === codigo);
}

/**
 * Un requisito de la matriz de un cliente, con lo mínimo que hace falta para generar ítems.
 * No lleva si el tipo de documento está activo: un requisito activo entra siempre, aunque su tipo
 * se haya desactivado después.
 */
export interface RequisitoDeMatriz {
  /** Id del requisito: queda en el ítem solo como trazabilidad. */
  id: string;
  tipoDocumentoId: string;
  /** Nombre del tipo hoy: el ítem lo copia como foto. */
  nombreTipoDocumento: string;
  cantidad: number;
  diasAproximados: readonly number[];
  /** Canal propio del requisito; `null` = usa el del cliente. */
  canalEntrega: CanalEntrega | null;
  /** Baja lógica: un requisito dado de baja no entra en el checklist. */
  isDeleted: boolean;
}

/**
 * Un ítem a crear en una rendición, todavía sin `id`, fechas ni `completado` (nace en `false`):
 * eso lo completa el backend al guardarlo. Es independiente del `ItemChecklist` de lectura.
 */
export interface ItemChecklistNuevo {
  requisitoClienteId: string;
  tipoDocumentoId: string;
  nombreTipoDocumento: string;
  /** Número de este documento dentro del requisito, de 1 a `totalOrdinal`. */
  ordinal: number;
  /** Cantidad del requisito. */
  totalOrdinal: number;
  /** Día de esta ocurrencia, o `null` si el requisito no tiene días. */
  diaAproximado: number | null;
  /** Canal efectivo ya resuelto: nunca `null`. */
  canalEntrega: CanalEntrega;
}

/** Lo que define la posición de un ítem en el checklist. */
export interface PosicionEnChecklist {
  nombreTipoDocumento: string;
  requisitoClienteId: string;
  ordinal: number;
}

/**
 * Orden del checklist, el único: por nombre del tipo (comparación en español), por id del
 * requisito si dos tienen el mismo nombre, y por `ordinal`. Lo usa `generarChecklist` y quien
 * muestre ítems ya guardados (p. ej. el detalle de una rendición), para que el checklist se vea
 * en el mismo orden al abrirlo y al consultarlo, sin depender del orden de la base.
 */
export function compararItemsDeChecklist(a: PosicionEnChecklist, b: PosicionEnChecklist): number {
  const porNombre = a.nombreTipoDocumento.localeCompare(b.nombreTipoDocumento, 'es');
  if (porNombre !== 0) return porNombre;
  if (a.requisitoClienteId !== b.requisitoClienteId) {
    return a.requisitoClienteId < b.requisitoClienteId ? -1 : 1;
  }
  return a.ordinal - b.ordinal;
}

/** Lanza el error que corresponda si el requisito no se puede convertir en ítems. */
function validarRequisito(requisito: RequisitoDeMatriz): void {
  const { nombreTipoDocumento, cantidad, diasAproximados } = requisito;
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    throw new ChecklistError(
      'CANTIDAD_INVALIDA',
      `El requisito "${nombreTipoDocumento}" tiene una cantidad inválida (${cantidad}): tiene que ser un entero de al menos 1.`,
    );
  }
  const problema = problemaDeDias(cantidad, diasAproximados);
  if (problema !== null) {
    throw new ChecklistError(
      'DIAS_INCOHERENTES',
      `Los días aproximados del requisito "${nombreTipoDocumento}" no coinciden con su cantidad. ${problema}`,
    );
  }
}

/**
 * Genera los ítems del checklist de una rendición a partir de la matriz del cliente.
 *
 * - Entran **todos** los requisitos activos, aunque su tipo de documento esté desactivado; los
 *   dados de baja (`isDeleted`) no. Una matriz sin requisitos activos es un error `MATRIZ_VACIA`.
 * - Cada requisito genera un ítem por unidad de `cantidad` (`ordinal` de 1 a `totalOrdinal`), con
 *   el día de esa ocurrencia (`diasAproximados[ordinal - 1]`, o `null` sin días). Los días se
 *   toman tal como están guardados: ordenarlos es una regla de escritura.
 * - El canal es el efectivo: `requisito.canalEntrega ?? cliente.canalEntrega`.
 * - Copia el nombre del tipo (foto). No copia la nota, la descripción ni datos del cliente.
 * - Orden de salida: el de `compararItemsDeChecklist` (nombre del tipo en español, id del
 *   requisito si se repite el nombre, y `ordinal`).
 *
 * Valida los requisitos activos antes de generar nada: si uno es inválido (`CANTIDAD_INVALIDA`,
 * `DIAS_INCOHERENTES`) falla todo. Son errores defensivos, porque la base y los schemas ya lo
 * impiden. Sirve también para agregar un solo requisito a una rendición abierta: se la llama con
 * una matriz de un elemento.
 */
export function generarChecklist(
  matriz: readonly RequisitoDeMatriz[],
  cliente: { canalEntrega: CanalEntrega },
): ItemChecklistNuevo[] {
  const activos = matriz.filter((requisito) => !requisito.isDeleted);
  if (activos.length === 0) {
    throw new ChecklistError(
      'MATRIZ_VACIA',
      'El cliente no tiene requisitos activos: configurá su matriz antes de abrir una rendición.',
    );
  }
  activos.forEach(validarRequisito);

  // `flatMap` crea un arreglo nuevo: ordenarlo no toca lo que llegó.
  return activos
    .flatMap((requisito) =>
      Array.from({ length: requisito.cantidad }, (_, indice): ItemChecklistNuevo => ({
        requisitoClienteId: requisito.id,
        tipoDocumentoId: requisito.tipoDocumentoId,
        nombreTipoDocumento: requisito.nombreTipoDocumento,
        ordinal: indice + 1,
        totalOrdinal: requisito.cantidad,
        diaAproximado: requisito.diasAproximados[indice] ?? null,
        canalEntrega: requisito.canalEntrega ?? cliente.canalEntrega,
      })),
    )
    .sort(compararItemsDeChecklist);
}

/** Avance de un checklist. */
export interface Faltantes<T> {
  totalItems: number;
  completados: number;
  /** Los ítems sin completar, en el mismo orden en que llegaron. */
  faltantes: T[];
}

/**
 * Cuántos ítems tiene un checklist, cuántos están completos y cuáles faltan. Sirve para cualquier
 * ítem que tenga `completado` (el de lectura, el que arma el front). No muta la entrada.
 */
export function calcularFaltantes<T extends { completado: boolean }>(
  items: readonly T[],
): Faltantes<T> {
  const faltantes = items.filter((item) => !item.completado);
  return {
    totalItems: items.length,
    completados: items.length - faltantes.length,
    faltantes,
  };
}
