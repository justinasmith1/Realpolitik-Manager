// Dónde se guardan las preferencias de columnas. El hook y las tablas dependen solo de la interfaz
// `ColumnPreferencesStorage`: hoy la implementa `localStorage`; mañana puede implementarla un
// backend de preferencias por usuario sin tocar el picker ni las tablas.
//
// Limitación de `localStorage`: la preferencia vive en ese navegador y para ese origin (localhost
// y el deploy tienen cada uno la suya) y no se sincroniza entre computadoras.

import type { ColumnPreferencesScope } from '@/components/data-table/columnPreferences';

/**
 * Persistencia de una preferencia. Guarda solo los ids de las columnas opcionales visibles, en
 * orden; nunca labels, definiciones de columnas ni datos de la tabla.
 *
 * Las implementaciones no lanzan: una preferencia de UI que no se puede leer o guardar no debe
 * romper la pantalla. Ante cualquier fallo, `load` devuelve `null` (se usan los defaults).
 */
export interface ColumnPreferencesStorage {
  /** Ids guardados, sin validar contra la tabla; `null` si no hay preferencia o es ilegible. */
  load(scope: ColumnPreferencesScope): readonly string[] | null;
  save(scope: ColumnPreferencesScope, ids: readonly string[]): void;
  /** Borra la preferencia: quien no tiene una recibe los defaults vigentes. */
  remove(scope: ColumnPreferencesScope): void;
}

const NAMESPACE = 'realpolitik-manager';
const FEATURE = 'table-columns';

/**
 * Versión del contrato guardado. Va en la clave y en el contenido: si el formato cambia de forma
 * incompatible (o se renombran ids), se sube y los datos viejos se ignoran en vez de
 * interpretarlos mal. Agregar o quitar columnas no la cambia.
 */
export const COLUMN_PREFERENCES_VERSION = 1;

interface StoredColumnPreferences {
  version: typeof COLUMN_PREFERENCES_VERSION;
  ids: string[];
}

/** `realpolitik-manager:table-columns:v1:<tableId>:<ownerKey>`. */
export function columnPreferencesKey({ tableId, ownerKey }: ColumnPreferencesScope): string {
  // Los segmentos variables se codifican para que un `:` en ellos no pueda generar la misma
  // clave para dos preferencias distintas.
  return [
    NAMESPACE,
    FEATURE,
    `v${COLUMN_PREFERENCES_VERSION}`,
    encodeURIComponent(tableId),
    encodeURIComponent(ownerKey),
  ].join(':');
}

export function serializeColumnPreferences(ids: readonly string[]): string {
  const stored: StoredColumnPreferences = { version: COLUMN_PREFERENCES_VERSION, ids: [...ids] };
  return JSON.stringify(stored);
}

/**
 * Lee lo guardado sin confiar en él: JSON corrupto, otra forma u otra versión dan `null`.
 * `ids: []` es una preferencia válida (solo las columnas fijas), no un dato ilegible.
 */
export function parseColumnPreferences(raw: string | null): readonly string[] | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { version, ids } = value as Partial<Record<keyof StoredColumnPreferences, unknown>>;
  if (version !== COLUMN_PREFERENCES_VERSION) return null;
  if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string')) {
    return null;
  }
  return ids;
}

type WebStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Implementación sobre Web Storage. Se usa `localStorage` y no `sessionStorage` porque la
 * preferencia tiene que sobrevivir a cerrar y volver a abrir el navegador.
 *
 * `getWebStorage` se resuelve en cada operación: el solo acceso a `window.localStorage` puede
 * lanzar (almacenamiento bloqueado por el navegador) y eso también cae en los defaults.
 */
export function createLocalStorageColumnPreferencesStorage(
  getWebStorage: () => WebStorage = () => window.localStorage,
): ColumnPreferencesStorage {
  return {
    load(scope) {
      try {
        return parseColumnPreferences(getWebStorage().getItem(columnPreferencesKey(scope)));
      } catch {
        return null;
      }
    },
    save(scope, ids) {
      try {
        getWebStorage().setItem(columnPreferencesKey(scope), serializeColumnPreferences(ids));
      } catch {
        // Sin espacio o almacenamiento bloqueado: la elección sigue valiendo en pantalla, solo
        // que no se recuerda.
      }
    },
    remove(scope) {
      try {
        getWebStorage().removeItem(columnPreferencesKey(scope));
      } catch {
        // Igual que al guardar: no es un error para quien usa la pantalla.
      }
    },
  };
}
