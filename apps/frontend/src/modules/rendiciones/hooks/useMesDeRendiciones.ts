import {
  ANIO_MAX,
  ANIO_MIN,
  ListarRendicionesDelMesQuerySchema,
  mesActual,
  mesesAPeriodo,
  periodoAMeses,
} from '@realpolitik/shared';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';

export interface Periodo {
  anio: number;
  mes: number;
}

/** El mes anterior o el siguiente (`desplazamiento` -1 o 1), cruzando de año si hace falta. */
export function mesCorrido(periodo: Periodo, desplazamiento: -1 | 1): Periodo {
  return mesesAPeriodo(periodoAMeses(periodo) + desplazamiento);
}

/** El período está dentro de los años que admite una rendición (2020 a 2100). */
const enRango = ({ anio }: Periodo) => anio >= ANIO_MIN && anio <= ANIO_MAX;

/**
 * El mes de la pantalla Rendiciones (HU3.2), guardado en la URL (`?anio=2026&mes=11`): se puede
 * compartir, sobrevive a una recarga y Atrás/Adelante lo restauran.
 *
 * - Sin parámetros, el mes actual en horario de Buenos Aires (como el backend), sin escribirlo.
 * - Un valor que no cumple el schema de shared (el mismo que valida el backend), repetido o con
 *   solo uno de los dos, vuelve al mes actual: los parámetros se quitan, con `replace`, para no
 *   dejar una entrada extra en el historial.
 * - Elegir otro mes guarda los dos parámetros. Los demás parámetros de la URL no se tocan.
 */
export function useMesDeRendiciones() {
  const [params, setParams] = useSearchParams();
  const anios = params.getAll('anio');
  const meses = params.getAll('mes');
  const hayParametros = anios.length > 0 || meses.length > 0;

  const resultado =
    anios.length === 1 && meses.length === 1
      ? ListarRendicionesDelMesQuerySchema.safeParse({ anio: anios[0], mes: meses[0] })
      : undefined;
  const leido = resultado?.success === true ? resultado.data : undefined;
  // `mesActual()` sin memo: si la pantalla queda abierta al cambiar de mes, el siguiente render ya
  // muestra el nuevo.
  const periodo: Periodo = leido ?? mesActual();

  const escribir = useCallback(
    (nuevo: Periodo | undefined, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          if (nuevo === undefined) {
            siguientes.delete('anio');
            siguientes.delete('mes');
          } else {
            siguientes.set('anio', String(nuevo.anio));
            siguientes.set('mes', String(nuevo.mes));
          }
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  // Hay parámetros pero no se pudieron leer: se quitan (URL canónica) y queda el mes actual.
  const invalidos = hayParametros && leido === undefined;
  useEffect(() => {
    if (invalidos) escribir(undefined, true);
  }, [invalidos, escribir]);

  const anterior = mesCorrido(periodo, -1);
  const siguiente = mesCorrido(periodo, 1);

  return {
    periodo,
    /** El mes anterior, o `null` si queda fuera del rango (antes de enero de 2020). */
    anterior: enRango(anterior) ? anterior : null,
    /** El mes siguiente, o `null` si queda fuera del rango (después de diciembre de 2100). */
    siguiente: enRango(siguiente) ? siguiente : null,
    elegir: useCallback((nuevo: Periodo) => escribir(nuevo, false), [escribir]),
  };
}
