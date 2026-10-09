import {
  ClienteSector,
  ClienteSubtipoPublico,
  cambiarSector,
  type ClienteSectorType,
  type ClienteSubtipoPublicoType,
} from '@realpolitik/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Espera tras la última tecla antes de buscar. */
export const RETARDO_BUSQUEDA_MS = 300;

/**
 * Filtros del listado, guardados en los search params de la URL (`q`, `sector`, `subtipo`):
 * se pueden compartir y sobreviven a una recarga. El texto de búsqueda se escribe en un
 * estado local (`textoBusqueda`) y llega a la URL, y de ahí a la consulta, con debounce.
 */
export function useFiltrosClientes() {
  const [params, setParams] = useSearchParams();

  const sector = ClienteSector.safeParse(params.get('sector')).data;
  // El subtipo solo existe en el sector público: un valor suelto con sector PRIVADO se ignora.
  const subtipoDeUrl = ClienteSubtipoPublico.safeParse(params.get('subtipo')).data;
  const subtipo = sector === 'PRIVADO' ? undefined : subtipoDeUrl;
  const q = params.get('q') ?? '';

  const [textoBusqueda, setTextoBusqueda] = useState(q);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelarBusquedaPendiente = useCallback(() => clearTimeout(temporizador.current), []);
  useEffect(() => cancelarBusquedaPendiente, [cancelarBusquedaPendiente]);

  // Si la URL cambia por fuera (botón "atrás", limpiar), el input la acompaña. Se ajusta
  // durante el render y no en un efecto, para no pintar un cuadro con el texto viejo.
  const [qPrevia, setQPrevia] = useState(q);
  if (q !== qPrevia) {
    setQPrevia(q);
    setTextoBusqueda((actual) => (actual.trim() === q ? actual : q));
  }

  const actualizar = useCallback(
    (cambios: Record<string, string | undefined>, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          for (const [clave, valor] of Object.entries(cambios)) {
            if (valor === undefined || valor === '') siguientes.delete(clave);
            else siguientes.set(clave, valor);
          }
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  const cambiarTexto = (texto: string) => {
    setTextoBusqueda(texto);
    cancelarBusquedaPendiente();
    temporizador.current = setTimeout(
      () => actualizar({ q: texto.trim() }, true),
      RETARDO_BUSQUEDA_MS,
    );
  };

  const elegirSector = (nuevo: ClienteSectorType | undefined) => {
    const siguiente = cambiarSector({ sector, subtipo }, nuevo);
    actualizar({ sector: siguiente.sector, subtipo: siguiente.subtipo }, false);
  };

  const elegirSubtipo = (nuevo: ClienteSubtipoPublicoType | undefined) =>
    actualizar({ subtipo: nuevo }, false);

  const limpiar = () => {
    cancelarBusquedaPendiente();
    setTextoBusqueda('');
    actualizar({ q: undefined, sector: undefined, subtipo: undefined }, false);
  };

  return {
    /** Filtros vigentes: los que usa la consulta. */
    filtros: { q: q === '' ? undefined : q, sector, subtipo },
    hayFiltros: q !== '' || sector !== undefined || subtipo !== undefined,
    textoBusqueda,
    cambiarTexto,
    elegirSector,
    elegirSubtipo,
    limpiar,
  };
}
