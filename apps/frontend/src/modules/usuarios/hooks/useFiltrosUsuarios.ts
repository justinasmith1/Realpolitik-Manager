import { BusquedaDeUsuariosSchema, RolUsuario, type RolUsuarioType } from '@realpolitik/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Espera tras la última tecla antes de buscar (la misma que en clientes). */
export const RETARDO_BUSQUEDA_MS = 300;

/** `?desactivados=1` incluye las cuentas desactivadas, como en tipos de documento. */
const PARAMETRO_DESACTIVADOS = 'desactivados';

/**
 * Filtros del listado de usuarios, en la URL (`q`, `rol`, `desactivados=1`), como en clientes: se
 * pueden compartir, sobreviven a una recarga y Atrás/Adelante los restauran. El texto de búsqueda
 * se escribe en un estado local y llega a la URL (y de ahí al pedido) con un debounce, para no
 * pedir el listado en cada tecla.
 */
export function useFiltrosUsuarios() {
  const [params, setParams] = useSearchParams();

  const qEnUrl = params.get('q') ?? '';
  const rolEnUrl = params.get('rol');
  const desactivadosEnUrl = params.getAll(PARAMETRO_DESACTIVADOS);
  // Lo que la API rechazaría (búsqueda larga o con caracteres de control, un rol desconocido) no
  // se pide: se ignora y la URL se corrige abajo.
  const busqueda = BusquedaDeUsuariosSchema.safeParse(qEnUrl);
  const q = busqueda.success ? busqueda.data : '';
  const rol = RolUsuario.safeParse(rolEnUrl).data;
  const incluirDesactivados = desactivadosEnUrl[0] === '1';

  const [textoBusqueda, setTextoBusqueda] = useState(q);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelarBusquedaPendiente = useCallback(() => clearTimeout(temporizador.current), []);
  useEffect(() => cancelarBusquedaPendiente, [cancelarBusquedaPendiente]);

  // Si la URL cambia por fuera (Atrás, "Limpiar filtros"), el campo la acompaña. Se ajusta durante
  // el render, como en clientes, para no pintar un cuadro con el texto viejo.
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

  // URL canónica: lo que la interfaz no reconoce se quita, con `replace` (sin una entrada extra en
  // el historial). `desactivados` solo vale `1`, una vez.
  const qInvalida = qEnUrl !== '' && !busqueda.success;
  const rolInvalido = rolEnUrl !== null && rol === undefined;
  const desactivadosInvalido =
    desactivadosEnUrl.length > 1 || (desactivadosEnUrl.length === 1 && !incluirDesactivados);
  useEffect(() => {
    const aQuitar: Record<string, string | undefined> = {};
    if (qInvalida) aQuitar.q = undefined;
    if (rolInvalido) aQuitar.rol = undefined;
    if (desactivadosInvalido)
      aQuitar[PARAMETRO_DESACTIVADOS] = incluirDesactivados ? '1' : undefined;
    if (Object.keys(aQuitar).length > 0) actualizar(aQuitar, true);
  }, [qInvalida, rolInvalido, desactivadosInvalido, incluirDesactivados, actualizar]);

  const cambiarTexto = (texto: string) => {
    setTextoBusqueda(texto);
    cancelarBusquedaPendiente();
    temporizador.current = setTimeout(
      () => actualizar({ q: texto.trim() }, true),
      RETARDO_BUSQUEDA_MS,
    );
  };

  const elegirRol = (nuevo: RolUsuarioType | undefined) => actualizar({ rol: nuevo }, false);

  const cambiarIncluirDesactivados = (incluir: boolean) =>
    actualizar({ [PARAMETRO_DESACTIVADOS]: incluir ? '1' : undefined }, false);

  const limpiar = () => {
    cancelarBusquedaPendiente();
    setTextoBusqueda('');
    actualizar({ q: undefined, rol: undefined, [PARAMETRO_DESACTIVADOS]: undefined }, false);
  };

  return {
    /** Los filtros vigentes: los que usa el pedido. */
    filtros: { q: q === '' ? undefined : q, rol, incluirDesactivados },
    /** Si la búsqueda o el rol acotan el listado (las desactivadas no cuentan: amplían). */
    hayBusqueda: q !== '' || rol !== undefined,
    hayFiltros: q !== '' || rol !== undefined || incluirDesactivados,
    textoBusqueda,
    cambiarTexto,
    elegirRol,
    cambiarIncluirDesactivados,
    limpiar,
  };
}
