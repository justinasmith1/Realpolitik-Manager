import { useCallback, useMemo, useState } from 'react';

import {
  ANONYMOUS_OWNER_KEY,
  resolveVisibleIds,
  sanitizeColumnIds,
  type ColumnPreferencesScope,
} from '@/components/data-table/columnPreferences';
import {
  createLocalStorageColumnPreferencesStorage,
  type ColumnPreferencesStorage,
} from '@/components/data-table/columnPreferencesStorage';

const defaultStorage = createLocalStorageColumnPreferencesStorage();

export interface UseColumnPreferencesOptions<Id extends string> {
  tableId: string;
  /** Columnas opcionales que ofrece la tabla, en el orden en que se listan. */
  availableIds: readonly Id[];
  /** Visibles, y en qué orden, para quien nunca personalizó. */
  defaultIds: readonly Id[];
  /** Hoy siempre `'anonymous'`; con auth, el id del usuario de la sesión. */
  ownerKey?: string | undefined;
  /** Por defecto `localStorage`. Se espera una instancia estable (definida fuera del render). */
  storage?: ColumnPreferencesStorage | undefined;
}

export interface ColumnPreferences<Id extends string> {
  /** Columnas opcionales visibles, en el orden en que se muestran. */
  visibleIds: readonly Id[];
  /** Reemplaza la selección (visibilidad y orden) y la guarda en el momento. */
  setVisibleIds: (ids: readonly Id[]) => void;
  /** Borra la personalización y vuelve a los defaults vigentes. */
  reset: () => void;
  /** Hay una preferencia guardada, aunque sea vacía o igual a los defaults. */
  isCustomized: boolean;
}

interface LoadedPreferences extends ColumnPreferencesScope {
  /** `null`: nunca se personalizó. `[]`: se eligió no ver ninguna columna opcional. */
  stored: readonly string[] | null;
}

/**
 * Columnas opcionales visibles de una tabla, persistidas por tabla y por dueño. Cada cambio se
 * guarda solo; montar la tabla nunca escribe, así quien no personalizó sigue recibiendo los
 * defaults aunque cambien.
 */
export function useColumnPreferences<Id extends string>({
  tableId,
  availableIds,
  defaultIds,
  ownerKey = ANONYMOUS_OWNER_KEY,
  storage = defaultStorage,
}: UseColumnPreferencesOptions<Id>): ColumnPreferences<Id> {
  const [loaded, setLoaded] = useState<LoadedPreferences>(() => ({
    tableId,
    ownerKey,
    stored: storage.load({ tableId, ownerKey }),
  }));

  // Otra tabla u otro dueño (p. ej. cambio de usuario): se lee su preferencia. Se ajusta durante
  // el render y no en un efecto, para no pintar un cuadro con las columnas del anterior.
  let current = loaded;
  if (loaded.tableId !== tableId || loaded.ownerKey !== ownerKey) {
    current = { tableId, ownerKey, stored: storage.load({ tableId, ownerKey }) };
    setLoaded(current);
  }
  const { stored } = current;

  const visibleIds = useMemo(
    () => resolveVisibleIds(stored, availableIds, defaultIds),
    [stored, availableIds, defaultIds],
  );

  const setVisibleIds = useCallback(
    (ids: readonly Id[]) => {
      const next = sanitizeColumnIds(ids, availableIds);
      storage.save({ tableId, ownerKey }, next);
      setLoaded({ tableId, ownerKey, stored: next });
    },
    [availableIds, ownerKey, storage, tableId],
  );

  const reset = useCallback(() => {
    // Se borra en vez de guardar los defaults: si los defaults cambian, quien hizo reset los
    // recibe como alguien que nunca personalizó.
    storage.remove({ tableId, ownerKey });
    setLoaded({ tableId, ownerKey, stored: null });
  }, [ownerKey, storage, tableId]);

  return { visibleIds, setVisibleIds, reset, isCustomized: stored !== null };
}
