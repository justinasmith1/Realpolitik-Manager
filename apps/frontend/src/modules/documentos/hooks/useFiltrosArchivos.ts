import { ListarDocumentosQuerySchema, mesActual } from '@realpolitik/shared';
import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';

const CAMPOS = ['anio', 'mes', 'tipo'] as const;
type Campo = (typeof CAMPOS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un valor del parámetro, solo si cumple lo que valida la API; si no, `undefined`. */
function leer(campo: Campo, valores: string[]): number | string | undefined {
  if (valores.length !== 1) return undefined;
  const [valor = ''] = valores;
  if (campo === 'tipo') return UUID.test(valor) ? valor : undefined;
  const resultado = ListarDocumentosQuerySchema.shape[campo].safeParse(valor);
  return resultado.success ? resultado.data : undefined;
}

/** El repositorio con un período y, si se pasa, un tipo ya elegidos (los lee `useFiltrosArchivos`). */
export function rutaDeArchivos({
  anio,
  mes,
  tipoDocumentoId,
}: {
  anio: number;
  mes: number;
  tipoDocumentoId?: string;
}): string {
  const params = new URLSearchParams({ anio: String(anio), mes: String(mes) });
  if (tipoDocumentoId !== undefined) params.set('tipo', tipoDocumentoId);
  return `/documentos/archivos?${params.toString()}`;
}

/**
 * Período y tipo del repositorio de archivos, guardados en la URL
 * (`/documentos/archivos?anio=2026&mes=10&tipo=…`): se pueden compartir, sobreviven a una recarga
 * y Atrás/Adelante los restauran. Mismo criterio que el filtro de rendiciones:
 *
 * - Sin parámetros: el mes actual (horario de Buenos Aires) y todos los tipos. El valor por
 *   defecto no se escribe en la URL.
 * - URL canónica: un valor que no cumple (`mes=13`, `tipo=x`, repetido) se quita con `replace`,
 *   sin dejar una entrada extra en el historial. Los demás parámetros no se tocan.
 *
 * La búsqueda por nombre no viaja en la URL (como en Requisitos): es local a la página.
 */
export function useFiltrosArchivos() {
  const [params, setParams] = useSearchParams();
  const actual = useMemo(() => mesActual(), []);
  const crudos = useMemo(
    () => ({ anio: params.getAll('anio'), mes: params.getAll('mes'), tipo: params.getAll('tipo') }),
    [params],
  );
  const leidos = {
    anio: leer('anio', crudos.anio) as number | undefined,
    mes: leer('mes', crudos.mes) as number | undefined,
    tipo: leer('tipo', crudos.tipo) as string | undefined,
  };

  const actualizar = useCallback(
    (cambios: Partial<Record<Campo, string | undefined>>, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          for (const campo of CAMPOS) {
            if (!(campo in cambios)) continue;
            const valor = cambios[campo];
            if (valor === undefined) siguientes.delete(campo);
            else siguientes.set(campo, valor);
          }
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  // Quita lo que no se pudo leer, para que la URL compartida diga lo que se ve.
  const invalidos = CAMPOS.filter(
    (campo) => crudos[campo].length > 0 && leidos[campo] === undefined,
  );
  const claveDeInvalidos = invalidos.join(',');
  useEffect(() => {
    if (claveDeInvalidos === '') return;
    actualizar(
      Object.fromEntries(claveDeInvalidos.split(',').map((campo) => [campo, undefined])),
      true,
    );
  }, [claveDeInvalidos, actualizar]);

  const anio = leidos.anio ?? actual.anio;
  const mes = leidos.mes ?? actual.mes;
  const tipoDocumentoId = leidos.tipo;

  /** Cambia el período. El mes actual no se escribe: es el valor por defecto. */
  const elegirPeriodo = (periodo: { anio: number; mes: number }) => {
    if (periodo.anio === anio && periodo.mes === mes) return;
    const esElActual = periodo.anio === actual.anio && periodo.mes === actual.mes;
    actualizar(
      {
        anio: esElActual ? undefined : String(periodo.anio),
        mes: esElActual ? undefined : String(periodo.mes),
      },
      false,
    );
  };

  /** `undefined`: todos los tipos. */
  const elegirTipo = (tipo: string | undefined) => {
    if (tipo === tipoDocumentoId) return;
    actualizar({ tipo }, false);
  };

  return { anio, mes, tipoDocumentoId, elegirPeriodo, elegirTipo };
}
