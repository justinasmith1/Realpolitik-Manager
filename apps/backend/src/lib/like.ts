/**
 * Escapa `\`, `%` y `_` para que un texto escrito por el usuario se busque literalmente.
 *
 * Prisma traduce `contains` a `ILIKE '%' || valor || '%'` y no escapa el valor: sin esto, un
 * `%` o un `_` en la búsqueda serían comodines (con `q=%` aparecen todos los clientes) y una
 * `\` escaparía el carácter siguiente. En PostgreSQL la barra invertida es el escape
 * predeterminado de `LIKE`, así que no hace falta una cláusula `ESCAPE`. El valor sigue
 * viajando como parámetro, no se arma ningún SQL a mano.
 */
export function escaparComodinesDeLike(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}
