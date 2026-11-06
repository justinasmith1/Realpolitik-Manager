import { EstadoRendicion, type EstadoRendicionType } from '@realpolitik/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { RETARDO_BUSQUEDA_MS } from '@/modules/clientes/hooks/useFiltrosClientes';
import { esTipoDeCliente, type TipoDeCliente } from '@/modules/rendiciones/rendiciones.etiquetas';
import type { FiltrosDelMes } from '@/modules/rendiciones/rendicionesDelMes.filtros';

/** Largo máximo del texto buscado (nombre corto del cliente o número de factura). */
export const MAX_BUSQUEDA_RENDICIONES = 100;

/** Un solo valor del parámetro; ausente o repetido, `undefined`. */
const unico = (valores: string[]): string | undefined =>
  valores.length === 1 ? valores[0] : undefined;

function leerEstado(valores: string[]): EstadoRendicionType | undefined {
  const valor = unico(valores);
  return valor === undefined ? undefined : EstadoRendicion.safeParse(valor).data;
}

function leerTipo(valores: string[]): TipoDeCliente | undefined {
  const valor = unico(valores);
  return valor !== undefined && esTipoDeCliente(valor) ? valor : undefined;
}

function leerBusqueda(valores: string[]): string | undefined {
  const valor = unico(valores)?.trim();
  return valor === undefined || valor === '' || valor.length > MAX_BUSQUEDA_RENDICIONES
    ? undefined
    : valor;
}

/**
 * Filtros de la pantalla Rendiciones (HU3.3), guardados en la URL junto con el mes
 * (`?anio=2026&mes=10&estado=EN_CURSO&tipo=MUNICIPAL&q=solano`): se pueden compartir, sobreviven a
 * una recarga y Atrás/Adelante los restauran. Al cambiar de mes se mantienen (el mes lo maneja
 * `useMesDeRendiciones`, que no toca estos parámetros).
 *
 * - `estado`: un estado de la rendición (el schema de shared). `tipo`: uno de `TIPOS_DE_CLIENTE`.
 *   `q`: el texto buscado, recortado.
 * - URL canónica, como el mes: un valor inválido o repetido (o un `q` vacío) se quita, con
 *   `replace`, para no dejar una entrada extra en el historial.
 * - Estado y tipo se eligen tocando: tocar el que ya está activo lo quita.
 * - El texto del buscador se escribe en un estado local y llega a la URL con un retardo.
 */
export function useFiltrosRendicionesDelMes() {
  const [params, setParams] = useSearchParams();
  const crudos = {
    estado: params.getAll('estado'),
    tipo: params.getAll('tipo'),
    q: params.getAll('q'),
  };
  const estado = leerEstado(crudos.estado);
  const tipo = leerTipo(crudos.tipo);
  const q = leerBusqueda(crudos.q);

  const actualizar = useCallback(
    (cambios: Partial<Record<keyof FiltrosDelMes, string | undefined>>, reemplazar: boolean) => {
      setParams(
        (previos) => {
          const siguientes = new URLSearchParams(previos);
          for (const [clave, valor] of Object.entries(cambios)) {
            if (valor === undefined) siguientes.delete(clave);
            else siguientes.set(clave, valor);
          }
          return siguientes;
        },
        { replace: reemplazar },
      );
    },
    [setParams],
  );

  // URL canónica: lo que no se pudo leer se quita. Un `q` válido pero con espacios alrededor
  // queda como está: se recorta al leerlo.
  const estadoInvalido = crudos.estado.length > 0 && estado === undefined;
  const tipoInvalido = crudos.tipo.length > 0 && tipo === undefined;
  const busquedaInvalida = crudos.q.length > 0 && q === undefined;
  useEffect(() => {
    const aQuitar: Partial<Record<keyof FiltrosDelMes, undefined>> = {};
    if (estadoInvalido) aQuitar.estado = undefined;
    if (tipoInvalido) aQuitar.tipo = undefined;
    if (busquedaInvalida) aQuitar.q = undefined;
    if (Object.keys(aQuitar).length > 0) actualizar(aQuitar, true);
  }, [estadoInvalido, tipoInvalido, busquedaInvalida, actualizar]);

  // El buscador: estado local, y a la URL con retardo.
  const [textoBusqueda, setTextoBusqueda] = useState(q ?? '');
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelarBusquedaPendiente = useCallback(() => clearTimeout(temporizador.current), []);
  useEffect(() => cancelarBusquedaPendiente, [cancelarBusquedaPendiente]);

  // Si la URL cambia por fuera (Atrás, "Limpiar filtros"), el buscador la acompaña. Se ajusta
  // durante el render, como en Clientes, para no pintar un cuadro con el texto viejo.
  const [qPrevia, setQPrevia] = useState(q);
  if (q !== qPrevia) {
    setQPrevia(q);
    setTextoBusqueda((actual) => (actual.trim() === (q ?? '') ? actual : (q ?? '')));
  }

  const cambiarTexto = (texto: string) => {
    setTextoBusqueda(texto);
    cancelarBusquedaPendiente();
    temporizador.current = setTimeout(() => {
      const recortado = texto.trim();
      actualizar({ q: recortado === '' ? undefined : recortado }, true);
    }, RETARDO_BUSQUEDA_MS);
  };

  return {
    /** Los filtros vigentes, para filtrar el listado. */
    filtros: { estado, tipo, q } satisfies FiltrosDelMes,
    textoBusqueda,
    cambiarTexto,
    /** Elige un estado; el que ya está activo, o `undefined` ("Todas"), lo quita. */
    elegirEstado: (nuevo: EstadoRendicionType | undefined) =>
      actualizar({ estado: nuevo === estado ? undefined : nuevo }, false),
    /** Elige un tipo de cliente; el que ya está activo, o `undefined` ("Todos"), lo quita. */
    elegirTipo: (nuevo: TipoDeCliente | undefined) =>
      actualizar({ tipo: nuevo === tipo ? undefined : nuevo }, false),
    /** Quita solo la búsqueda (también la que estaba por llegar a la URL). */
    quitarBusqueda: () => {
      cancelarBusquedaPendiente();
      setTextoBusqueda('');
      actualizar({ q: undefined }, false);
    },
    /** Quita los tres filtros y deja solo el mes. */
    limpiar: () => {
      cancelarBusquedaPendiente();
      setTextoBusqueda('');
      actualizar({ estado: undefined, tipo: undefined, q: undefined }, false);
    },
  };
}
