// Clave de unicidad del nombre de un tipo de documento (HU2.1, ADR-0003). Dos nombres con la
// misma clave son el mismo tipo: `Constancia ARCA`, `constancia  arca` y `Constancía ARCA`. La
// base la guarda en `TipoDocumento.nombreNormalizado`, con un índice único. Es la ÚNICA
// implementación de la regla: el backend y el seed la usan tal cual, sin copias.

/** Tilde combinante (U+0303), escrita como escape porque es invisible. Tras una `n` da la `ñ`. */
const TILDE_COMBINANTE = '\u0303';

/** Cualquier marca combinante de Unicode: acentos, diéresis, cedilla, tildes. */
const MARCA_COMBINANTE = /\p{M}/gu;

/** Secuencias de espacios en blanco (`\s` de JavaScript, incluye el espacio duro U+00A0). */
const ESPACIOS = /\s+/g;

/**
 * Normaliza un nombre de tipo de documento para comparar sin mayúsculas ni acentos:
 *
 * 1. Recorta los espacios de los bordes y colapsa los internos en uno solo.
 * 2. Descompone (NFD): cada letra acentuada queda como letra base + marca combinante.
 * 3. Pasa a minúsculas, sin depender del idioma del entorno (`toLowerCase`).
 * 4. Elimina las marcas combinantes, salvo la tilde de la `ñ`: en español la `ñ` es otra letra,
 *    así que `Año` y `Ano` dan claves distintas. Las demás tildes (`ã`, `õ`) sí se eliminan.
 * 5. Recompone (NFC): `n` + tilde vuelve a ser `ñ`, escrita igual venga como venga.
 *
 * Las letras que Unicode no descompone (`ø`, `ł`, `ß`) quedan como están. Es determinística e
 * idempotente, y el resultado nunca es más largo que la entrada: entra en la misma columna de
 * 100 caracteres que el nombre.
 */
export function normalizarNombreTipoDocumento(nombre: string): string {
  return nombre
    .trim()
    .replace(ESPACIOS, ' ')
    .normalize('NFD')
    .toLowerCase()
    .replace(MARCA_COMBINANTE, (marca: string, posicion: number, texto: string) =>
      marca === TILDE_COMBINANTE && texto[posicion - 1] === 'n' ? marca : '',
    )
    .normalize('NFC');
}
