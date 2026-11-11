import { useCallback, useEffect } from 'react';
import { useSearchParams, type To } from 'react-router';

/** El parámetro de la URL con la rendición del panel de resumen (HU3.5). */
export const PARAMETRO_RENDICION = 'rendicion';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La rendición abierta en el panel de resumen de la pantalla Rendiciones (HU3.5), guardada en la
 * URL junto con el mes y los filtros (`?rendicion=<id>`): sobrevive a una recarga y Atrás/Adelante
 * la restauran. Este hook no toca los otros parámetros.
 *
 * - Abrir es un enlace (`destinoDe`) que agrega el parámetro, con una entrada nueva en el historial,
 *   como elegir un filtro. Cerrar lo quita, también con una entrada nueva.
 * - URL canónica, como los filtros: un valor que no es un id, o repetido, se quita con `replace`.
 *   Si el id no está en el listado o no se puede cargar, lo descarta la pantalla (`descartar`).
 */
export function useRendicionAbierta() {
  const [params, setParams] = useSearchParams();
  const valores = params.getAll(PARAMETRO_RENDICION);
  const unico = valores.length === 1 ? valores[0] : undefined;
  const rendicionId = unico !== undefined && ID.test(unico) ? unico : null;

  const quitar = useCallback(
    (reemplazar: boolean) =>
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          siguientes.delete(PARAMETRO_RENDICION);
          return siguientes;
        },
        { replace: reemplazar },
      ),
    [setParams],
  );

  const invalido = valores.length > 0 && rendicionId === null;
  useEffect(() => {
    if (invalido) quitar(true);
  }, [invalido, quitar]);

  return {
    /** El id de la rendición abierta, o `null` si el panel está cerrado. */
    rendicionId,
    /** El enlace que abre el panel con esa rendición, sin perder el mes ni los filtros. */
    destinoDe: (id: string): To => {
      const siguientes = new URLSearchParams(params);
      siguientes.set(PARAMETRO_RENDICION, id);
      return { search: `?${siguientes.toString()}` };
    },
    /** Cierra el panel (la X o Escape). */
    cerrar: useCallback(() => quitar(false), [quitar]),
    /**
     * Quita una rendición que no se puede mostrar (no está en el listado o no existe), con
     * `replace`: no deja en el historial una entrada que no se puede abrir.
     */
    descartar: useCallback(() => quitar(true), [quitar]),
  };
}
