// Lógica pura de las preferencias de columnas de una tabla: qué columnas opcionales se ven y en
// qué orden. No conoce ningún módulo, ni React, ni dónde se guarda la preferencia.
//
// Las columnas fijas de cada tabla (p. ej. la primera y la de acciones) no forman parte de la
// preferencia: las resuelve la tabla.

/** Identifica una preferencia: de qué tabla y de quién. */
export interface ColumnPreferencesScope {
  /** Tabla a la que pertenece la preferencia, p. ej. `'clientes'`. */
  tableId: string;
  /** Dueño de la preferencia. Ver `ANONYMOUS_OWNER_KEY`. */
  ownerKey: string;
}

/**
 * Dueño de las preferencias mientras no haya autenticación: todas las personas que usan el mismo
 * navegador comparten la misma. Con usuarios, el dueño pasa a ser el id del usuario de la sesión
 * y cada uno tiene la suya en ese navegador.
 */
export const ANONYMOUS_OWNER_KEY = 'anonymous';

/**
 * Deja solo los ids que la tabla ofrece, sin repetir y en el orden recibido. El orden es el orden
 * de las columnas.
 */
export function sanitizeColumnIds<Id extends string>(
  ids: readonly string[],
  availableIds: readonly Id[],
): Id[] {
  const available = new Set<string>(availableIds);
  const isAvailable = (id: string): id is Id => available.has(id);
  const seen = new Set<string>();
  const result: Id[] = [];
  for (const id of ids) {
    if (!isAvailable(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Columnas a mostrar. `stored` es la preferencia guardada; `null` es que nunca se personalizó y
 * entonces valen los defaults vigentes. Una preferencia guardada se respeta tal cual, incluso
 * vacía: una columna nueva que se agregue después no aparece sola para quien ya eligió las suyas.
 */
export function resolveVisibleIds<Id extends string>(
  stored: readonly string[] | null,
  availableIds: readonly Id[],
  defaultIds: readonly Id[],
): Id[] {
  return sanitizeColumnIds(stored ?? defaultIds, availableIds);
}

/**
 * Muestra u oculta una columna. Ocultarla conserva el orden de las demás; mostrarla la agrega al
 * final de las visibles, sin adivinar una posición "original": desde ahí se puede reordenar.
 */
export function toggleVisibleId<Id extends string>(visibleIds: readonly Id[], id: Id): Id[] {
  return visibleIds.includes(id)
    ? visibleIds.filter((visible) => visible !== id)
    : [...visibleIds, id];
}

/**
 * Lleva la columna `activeId` a la posición que ocupa `overId`, corriendo las del medio. Si alguna
 * de las dos no está visible, o son la misma, devuelve el orden sin cambios.
 */
export function reorderVisibleIds<Id extends string>(
  visibleIds: readonly Id[],
  activeId: string,
  overId: string,
): Id[] {
  const from = visibleIds.findIndex((id) => id === activeId);
  const to = visibleIds.findIndex((id) => id === overId);
  const next = [...visibleIds];
  if (from === -1 || to === -1 || from === to) return next;
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
