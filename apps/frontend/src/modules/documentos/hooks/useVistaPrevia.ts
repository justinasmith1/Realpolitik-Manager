import { useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import {
  descargarArchivo,
  interpretarFalloDescarga,
} from '@/modules/documentos/api/documentos.api';
import { admiteVistaPrevia } from '@/modules/documentos/vistaPrevia';

/** Lo que hace falta para mostrar un documento: el id, cómo se llama y su formato. */
export interface DocumentoAVer {
  id: string;
  nombreOriginal: string;
  tipoContenido: string;
}

/**
 * Fuera del prefijo `documentos`: aplicar o reemplazar invalida los documentos, y eso no tiene
 * que volver a bajar el archivo que se está mirando.
 */
const vistaPreviaQueryKey = (id: string) => ['vista-previa', id] as const;

interface UrlLocal {
  subscribe: (onChange: () => void) => () => void;
  get: () => string | null;
}

/**
 * La URL local (`blob:`) de un contenido, que existe solo mientras alguien la usa: se crea al
 * suscribirse y se libera al dejar de usarla. Con `useSyncExternalStore` y no con un efecto que
 * guarda la URL en el estado (react-hooks/set-state-in-effect); y la doble suscripción de
 * StrictMode crea otra URL en vez de quedarse con una ya liberada.
 */
function urlLocalDe(contenido: Blob | undefined, tipo: string | null): UrlLocal {
  let url: string | null = null;
  return {
    subscribe: (onChange) => {
      if (contenido === undefined || tipo === null) return () => undefined;
      // Con el formato que el backend verificó al cargarlo, no con el de la respuesta.
      const creada = URL.createObjectURL(contenido.slice(0, contenido.size, tipo));
      url = creada;
      onChange();
      return () => {
        URL.revokeObjectURL(creada);
        if (url === creada) url = null;
      };
    },
    get: () => url,
  };
}

const sinUrlEnElServidor = () => null;

/**
 * El contenido de un documento para mostrarlo (HU3.11). Se pide igual que la descarga (con la
 * sesión, a través del backend) y se expone con una URL local que vive solo en esta pestaña y se
 * libera cuando cambia el documento, se cierra o se desmonta. No se guarda en la caché ni se
 * reintenta solo: el visor ofrece reintentar. Sin documento, o con uno que no se puede ver, no
 * pide nada.
 *
 * Es una query: si falla, pasa por el manejo global como cualquier otra (un 401 confirma la
 * sesión y, si era atrasado, la vuelve a pedir; un 403 revalida). `fallo` dice por qué, solo para
 * el texto del aviso (HU4.4, CA12).
 */
export function useVistaPrevia(documento: DocumentoAVer | null) {
  const visible = documento !== null && admiteVistaPrevia(documento.tipoContenido);
  const consulta = useQuery({
    queryKey: vistaPreviaQueryKey(documento?.id ?? ''),
    queryFn: ({ signal }) => descargarArchivo(documento?.id ?? '', signal),
    enabled: visible,
    retry: false,
    gcTime: 0,
  });
  const contenido = visible ? consulta.data : undefined;
  const tipo = documento?.tipoContenido ?? null;
  const urlLocal = useMemo(() => urlLocalDe(contenido, tipo), [contenido, tipo]);
  const url = useSyncExternalStore(urlLocal.subscribe, urlLocal.get, sinUrlEnElServidor);

  return {
    url,
    cargando: visible && !consulta.isError && url === null,
    error: visible && consulta.isError,
    fallo: visible && consulta.isError ? interpretarFalloDescarga(consulta.error) : null,
    reintentar: () => void consulta.refetch(),
  };
}
