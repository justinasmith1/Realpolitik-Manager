import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { enfocarYMostrar } from '@/lib/focus';

/** Cuánto queda visible el aviso de la página antes de retirarse solo. */
export const DURACION_AVISO_MS = 8000;

/**
 * Resultado de la última acción, sobre el listado. `id` distingue cada aviso: el cierre de uno
 * (su temporizador, su animación de salida) nunca alcanza a otro que lo reemplazó. `cerrando` =
 * está en la animación de salida.
 */
export interface AvisoDePagina {
  id: number;
  variante: 'success' | 'destructive';
  texto: string;
  cerrando: boolean;
}

interface OpcionesAvisoDePagina {
  /** El `Alert` del aviso, ya montado (la página le pasa esta ref en `ref`). */
  avisoRef: RefObject<HTMLElement | null>;
  /** A dónde va el foco si estaba en el aviso al cerrarse (p. ej. el título de la página). */
  destinoDelFoco: RefObject<HTMLElement | null>;
}

/**
 * Estado del aviso de una página, con el comportamiento del de clientes: uno solo a la vez (uno
 * nuevo reemplaza al anterior), se retira solo a los `DURACION_AVISO_MS` o con su botón de
 * cerrar, siempre con la animación de salida del `Alert` (que respeta el movimiento reducido).
 *
 * Las refs son de la página, como en clientes: el hook no devuelve ninguna, así su resultado se
 * puede leer en el render. La página renderiza el `Alert` con `avisoRef`, `cerrar(id)` en
 * `onCerrar` y `quitar(id)` al terminar la animación de salida. Si el foco estaba en el aviso al
 * cerrarse, pasa a `destinoDelFoco`: así no se pierde cuando el aviso se quita.
 */
export function useAvisoDePagina({ avisoRef, destinoDelFoco }: OpcionesAvisoDePagina) {
  const [aviso, setAviso] = useState<AvisoDePagina | null>(null);
  const ultimoId = useRef(0);

  const avisar = useCallback((variante: AvisoDePagina['variante'], texto: string) => {
    ultimoId.current += 1;
    setAviso({ id: ultimoId.current, variante, texto, cerrando: false });
  }, []);

  /** Lo quita sin animación: al empezar otra acción, el resultado anterior ya no aplica. */
  const limpiar = useCallback(() => setAviso(null), []);

  /** Empieza la salida del aviso `id` (la X y el temporizador pasan por acá). */
  const cerrar = useCallback(
    (id: number) => {
      if (avisoRef.current?.contains(document.activeElement)) {
        enfocarYMostrar(destinoDelFoco.current);
      }
      setAviso((actual) =>
        actual?.id === id && !actual.cerrando ? { ...actual, cerrando: true } : actual,
      );
    },
    [avisoRef, destinoDelFoco],
  );

  /** Terminada la animación de salida del aviso `id`, lo quita (si sigue siendo ese). */
  const quitar = useCallback((id: number) => {
    setAviso((actual) => (actual?.id === id ? null : actual));
  }, []);

  // Cada aviso trae su propia cuenta: la del anterior se cancela, y cerrarlo antes también.
  const idDelAviso = aviso?.id;
  const avisoCerrando = aviso?.cerrando ?? false;
  useEffect(() => {
    if (idDelAviso === undefined || avisoCerrando) return;
    const temporizador = setTimeout(() => cerrar(idDelAviso), DURACION_AVISO_MS);
    return () => clearTimeout(temporizador);
  }, [idDelAviso, avisoCerrando, cerrar]);

  return { aviso, avisar, limpiar, cerrar, quitar };
}
