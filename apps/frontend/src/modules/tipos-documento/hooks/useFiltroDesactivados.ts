import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';

/** Parámetro de la URL que incluye los tipos desactivados en el listado (`?desactivados=1`). */
export const PARAMETRO_DESACTIVADOS = 'desactivados';

/**
 * Filtro "Incluir desactivados" del catálogo, guardado en la URL: se puede compartir, sobrevive
 * a una recarga y Atrás/Adelante lo restauran. Sin el parámetro, solo activos (la vista por
 * defecto); con `desactivados=1`, todos. Los demás parámetros de la URL no se tocan.
 */
export function useFiltroDesactivados() {
  const [params, setParams] = useSearchParams();
  const valores = params.getAll(PARAMETRO_DESACTIVADOS);
  const incluirDesactivados = valores[0] === '1';

  const actualizar = useCallback(
    (incluir: boolean, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          if (incluir) siguientes.set(PARAMETRO_DESACTIVADOS, '1');
          else siguientes.delete(PARAMETRO_DESACTIVADOS);
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  // URL canónica, como en clientes: un valor que la interfaz no reconoce (`desactivados=0`,
  // `=true`, repetido) se quita o se deja como `desactivados=1`, según lo que se está mostrando.
  // Con `replace`, para no dejar una entrada extra en el historial.
  const canonica = valores.length === 0 || (valores.length === 1 && incluirDesactivados);
  useEffect(() => {
    if (!canonica) actualizar(incluirDesactivados, true);
  }, [canonica, incluirDesactivados, actualizar]);

  const cambiarIncluirDesactivados = useCallback(
    (incluir: boolean) => actualizar(incluir, false),
    [actualizar],
  );

  return { incluirDesactivados, cambiarIncluirDesactivados };
}
