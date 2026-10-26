import {
  FILTRO_ESTADO_POR_DEFECTO,
  ListarRendicionesQuerySchema,
  type FiltroEstadoRendiciones,
  type ListarRendicionesQuery,
} from '@realpolitik/shared';
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';

type CampoDeFiltro = keyof ListarRendicionesQuery;
type ValorDeFiltro = ListarRendicionesQuery[CampoDeFiltro];

const CAMPOS: readonly CampoDeFiltro[] = ['anio', 'mes', 'estado'];

/** Un valor del parámetro, solo si cumple el schema de shared (el mismo que valida el backend). */
function leer<C extends CampoDeFiltro>(
  campo: C,
  valores: string[],
): ListarRendicionesQuery[C] | undefined {
  if (valores.length !== 1) return undefined;
  const resultado = ListarRendicionesQuerySchema.shape[campo].safeParse(valores[0]);
  return resultado.success ? (resultado.data as ListarRendicionesQuery[C]) : undefined;
}

/**
 * Filtros de año, mes y estado del listado de rendiciones, guardados en la URL
 * (`?anio=2026&mes=10&estado=ANULADA`): se pueden compartir, sobreviven a una recarga y
 * Atrás/Adelante los restauran. Mismo criterio que `useFiltroDesactivados`:
 *
 * - Sin parámetros, sin filtro de período y solo las activas. Un filtro en su valor por defecto
 *   ("Todos" en año y mes, "Activas" en estado) no deja el parámetro en la URL.
 * - URL canónica: un valor que no cumple el schema (`anio=abc`, `mes=13`, `estado=x`, repetido)
 *   o un `estado=ACTIVA` explícito se quitan, con `replace`, para no dejar una entrada extra en
 *   el historial.
 * - Los demás parámetros de la URL no se tocan.
 */
export function useFiltroRendiciones() {
  const [params, setParams] = useSearchParams();
  const crudos = useMemo(
    () => ({
      anio: params.getAll('anio'),
      mes: params.getAll('mes'),
      estado: params.getAll('estado'),
    }),
    [params],
  );
  const anio = leer('anio', crudos.anio);
  const mes = leer('mes', crudos.mes);
  const estadoLeido = leer('estado', crudos.estado);
  // El valor por defecto no se guarda: se trata como si no estuviera.
  const estadoElegido = estadoLeido === FILTRO_ESTADO_POR_DEFECTO ? undefined : estadoLeido;

  const actualizar = useCallback(
    (cambios: Partial<Record<CampoDeFiltro, ValorDeFiltro>>, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          for (const campo of CAMPOS) {
            if (!(campo in cambios)) continue;
            const valor = cambios[campo];
            if (valor === undefined) siguientes.delete(campo);
            else siguientes.set(campo, String(valor));
          }
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  // Hay parámetro pero no se pudo leer, o es el valor por defecto: se quita (URL canónica).
  const canonica =
    (crudos.anio.length === 0 || anio !== undefined) &&
    (crudos.mes.length === 0 || mes !== undefined) &&
    (crudos.estado.length === 0 || estadoElegido !== undefined);
  useEffect(() => {
    if (!canonica) actualizar({ anio, mes, estado: estadoElegido }, true);
  }, [canonica, anio, mes, estadoElegido, actualizar]);

  const cambiarAnio = useCallback(
    (valor: number | undefined) => actualizar({ anio: valor }, false),
    [actualizar],
  );
  const cambiarMes = useCallback(
    (valor: number | undefined) => actualizar({ mes: valor }, false),
    [actualizar],
  );
  const cambiarEstado = useCallback(
    (valor: FiltroEstadoRendiciones) =>
      actualizar({ estado: valor === FILTRO_ESTADO_POR_DEFECTO ? undefined : valor }, false),
    [actualizar],
  );

  const filtros: ListarRendicionesQuery = useMemo(
    () => ({
      ...(anio === undefined ? {} : { anio }),
      ...(mes === undefined ? {} : { mes }),
      ...(estadoElegido === undefined ? {} : { estado: estadoElegido }),
    }),
    [anio, mes, estadoElegido],
  );

  return {
    filtros,
    /** El estado que se lista, con el valor por defecto ya aplicado. */
    estado: estadoElegido ?? FILTRO_ESTADO_POR_DEFECTO,
    /** Hay un filtro de período (año o mes). */
    hayFiltros: anio !== undefined || mes !== undefined,
    cambiarAnio,
    cambiarMes,
    cambiarEstado,
  };
}
