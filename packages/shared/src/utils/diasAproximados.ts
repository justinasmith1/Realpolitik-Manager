// Reglas de la cantidad y de los días aproximados de un requisito. La base solo garantiza que los
// días sean 1..31 y que haya ninguno o exactamente `cantidad` (ck_requisito_dias_*); el orden, la
// repetición y el tope de `cantidad` se definen acá y no van en la base.

/** Primer día del mes que puede tener un día aproximado. */
export const DIA_MIN = 1;

/** Último día del mes que puede tener un día aproximado. */
export const DIA_MAX = 31;

/**
 * Máximo de documentos por requisito y por rendición. **PROVISORIO**: el negocio no lo confirmó.
 * Existe porque abrir una rendición crea un ítem por unidad, y sin tope una cantidad enorme
 * crearía miles de ítems mientras la API no tenga autenticación. Cambiarlo es cambiar este valor.
 */
export const CANTIDAD_MAX = 100;

/**
 * Lee días escritos a mano y separados por coma (`"1, 8, 15"`), por ejemplo desde un input de
 * texto del front. Ignora los elementos vacíos (`"1,,8,"` → `[1, 8]`).
 *
 * Un elemento que no es un entero positivo (`"a"`, `"1.5"`, `"-3"`, `"0"`) queda como `NaN` en su
 * posición, en vez de descartarse: así el schema lo rechaza con su propio mensaje y no se pierde
 * en silencio lo que la persona escribió. No valida el rango (`DIA_MIN`..`DIA_MAX`), que es del
 * schema. Conserva el orden y los repetidos tal como se escribieron.
 */
export function parsearDiasEscritos(texto: string): number[] {
  return texto
    .split(',')
    .map((elemento) => elemento.trim())
    .filter((elemento) => elemento !== '')
    .map((elemento) => {
      if (!/^\d+$/.test(elemento)) return NaN;
      const dia = Number(elemento);
      return dia >= 1 ? dia : NaN;
    });
}

/**
 * Por qué los días no sirven para esa cantidad, o `null` si están bien: la lista está vacía o
 * tiene exactamente `cantidad` días (uno por documento).
 *
 * Es una función pura sobre el estado completo (cantidad + días): en un PATCH el schema solo ve lo
 * que viaja en el pedido, y el backend la vuelve a aplicar sobre el estado resultante (lo enviado
 * más lo guardado). Se exporta para que sea la misma regla.
 */
export function problemaDeDias(cantidad: number, dias: readonly number[]): string | null {
  if (dias.length === 0 || dias.length === cantidad) return null;
  const documentos = cantidad === 1 ? '1 día aproximado' : `${cantidad} días aproximados`;
  return `Cargá ${documentos} (uno por documento) o dejá la lista vacía.`;
}
