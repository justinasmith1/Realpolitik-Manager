/**
 * Vuelta desde la matriz al listado. Solo viaja la query string que ya estaba en la URL
 * (`location.search`): así entran los filtros de hoy y cualquiera que se sume después, sin
 * copiar el cliente ni aceptar una dirección de retorno armada a mano.
 */
export const BUSQUEDA_DE_CLIENTES = 'busquedaClientes';

/** State para `navigate` al abrir la matriz desde el listado. */
export function stateDeListado(search: string): { busquedaClientes: string } {
  return { [BUSQUEDA_DE_CLIENTES]: search };
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
 * Query string para volver a `/clientes`, o `''` si el state no es una búsqueda.
 * Una URL, un path o un fragmento se descartan: la vuelta siempre es el listado.
 */
export function busquedaParaVolver(state: unknown): string {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    return '';
  }
  if (!(BUSQUEDA_DE_CLIENTES in state)) {
    return '';
  }
  const valor = (state as Record<string, unknown>)[BUSQUEDA_DE_CLIENTES];
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
