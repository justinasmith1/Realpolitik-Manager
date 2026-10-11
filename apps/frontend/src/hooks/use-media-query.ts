import { useSyncExternalStore } from 'react';

/**
 * ¿Coincide la media query? Misma técnica que `useIsMobile` (useSyncExternalStore): se suscribe
 * a los cambios sin setState en un efecto. Sin DOM (render del servidor) es `false`.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Debajo de este ancho de ventana el listado de clientes no entra como tabla sin recortar
 * columnas: se muestra como tarjetas. (Con el Sidebar expandido, la tabla necesita ~1000px.)
 */
const COMPACT_LAYOUT_QUERY = '(max-width: 1279px)';

export function useIsCompactLayout() {
  return useMediaQuery(COMPACT_LAYOUT_QUERY);
}
