import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';

export type FiltroEstadoMatriz = 'TODAS' | 'CONFIGURADAS' | 'PENDIENTES';

const PARAMETRO = 'matrizConfigurada';

/**
 * Filtro por estado de la pestaña Requisitos, guardado en el search param `matrizConfigurada`
 * (los mismos valores que usa la API): `false` son los pendientes, `true` los configurados y sin
 * parámetro se ven todos. Se puede compartir y sobrevive a una recarga. La búsqueda por texto y el
 * orden no viajan en la URL.
 */
export function useFiltroMatrices() {
  const [params, setParams] = useSearchParams();

  const valorEnUrl = params.get(PARAMETRO);
  const filtroEstado: FiltroEstadoMatriz =
    valorEnUrl === 'false' ? 'PENDIENTES' : valorEnUrl === 'true' ? 'CONFIGURADAS' : 'TODAS';

  const actualizar = useCallback(
    (valor: string | undefined, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          if (valor === undefined) siguientes.delete(PARAMETRO);
          else siguientes.set(PARAMETRO, valor);
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  // URL canónica: cualquier valor distinto de `true` o `false` (`foo`, `FALSE`, vacío) ya se
  // muestra como Todos, pero la dirección compartida diría otra cosa. Se quita con `replace`
  // para no dejar una entrada extra en el historial. Los demás parámetros no se tocan.
  useEffect(() => {
    if (valorEnUrl !== null && valorEnUrl !== 'true' && valorEnUrl !== 'false') {
      actualizar(undefined, true);
    }
  }, [valorEnUrl, actualizar]);

  const elegirEstado = (nuevo: FiltroEstadoMatriz) =>
    actualizar(
      nuevo === 'PENDIENTES' ? 'false' : nuevo === 'CONFIGURADAS' ? 'true' : undefined,
      false,
    );

  return { filtroEstado, elegirEstado };
}
