/**
 * Vuelta desde la matriz al listado o a la pestaña Requisitos. Solo viaja la query string que ya
 * estaba en la URL (`location.search`): así entran los filtros de hoy y cualquiera que se sume
 * después, sin copiar el cliente ni aceptar una dirección de retorno armada a mano.
 */
export const BUSQUEDA_DE_CLIENTES = 'busquedaClientes';

/** State para `navigate` al abrir la matriz desde el listado. */
export function stateDeListado(search: string): { busquedaClientes: string } {
  return { [BUSQUEDA_DE_CLIENTES]: search };
}

export const ORIGEN_REQUISITOS = 'requisitos';

/** State para `navigate` al abrir la matriz desde la fila de la pestaña Requisitos. */
export function stateDeRequisitos(search: string): { origen: 'requisitos'; busqueda: string } {
  return { origen: ORIGEN_REQUISITOS, busqueda: search };
}

const ORIGEN_DE_CONTROL = 'http://vuelta.local';
const LARGO_MAXIMO = 2048;

/** Un control, una barra invertida o un fragmento no forman parte de una búsqueda. */
function tieneCaracterProhibido(valor: string): boolean {
  for (const caracter of valor) {
    const codigo = caracter.codePointAt(0) ?? 0;
    if (codigo <= 31 || codigo === 127 || caracter === '\\' || caracter === '#') {
      return true;
    }
  }
  return false;
}

/**
 * La query string es `''` salvo que el valor sea una búsqueda: texto que empieza con `?`, sin
 * control, barra invertida ni fragmento, de largo acotado y que resuelva al mismo origen y raíz.
 * Una URL, un path o un fragmento se descartan.
 */
function busquedaValida(valor: unknown): string {
  if (typeof valor !== 'string' || valor === '') {
    return '';
  }
  if (!valor.startsWith('?') || valor.length > LARGO_MAXIMO || tieneCaracterProhibido(valor)) {
    return '';
  }
  try {
    const url = new URL(valor, ORIGEN_DE_CONTROL);
    if (url.origin !== ORIGEN_DE_CONTROL || url.pathname !== '/') {
      return '';
    }
  } catch {
    return '';
  }
  return valor;
}

function leer(state: unknown, clave: string): unknown {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return undefined;
  }
  return (state as Record<string, unknown>)[clave];
}

/**
 * Query string para volver a `/clientes`, o `''` si el state no es una búsqueda.
 * Una URL, un path o un fragmento se descartan: la vuelta siempre es el listado.
 */
export function busquedaParaVolver(state: unknown): string {
  return busquedaValida(leer(state, BUSQUEDA_DE_CLIENTES));
}

export type DestinoDeVuelta = {
  origen: 'clientes' | 'requisitos';
  pathname: '/clientes' | '/clientes/matrices';
  search: string;
};

/**
 * A dónde lleva "Volver" desde la matriz de un cliente. El `pathname` es una de dos rutas fijas:
 * nunca sale del state. Del state solo se lee la query string, y pasa por la misma validación.
 */
export function destinoDeVuelta(state: unknown): DestinoDeVuelta {
  if (leer(state, 'origen') === ORIGEN_REQUISITOS) {
    return {
      origen: 'requisitos',
      pathname: '/clientes/matrices',
      search: busquedaValida(leer(state, 'busqueda')),
    };
  }
  return { origen: 'clientes', pathname: '/clientes', search: busquedaParaVolver(state) };
}
