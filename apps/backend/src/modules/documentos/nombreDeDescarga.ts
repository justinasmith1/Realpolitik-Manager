// `Content-Disposition` de una descarga (RFC 6266 y RFC 8187). El nombre original es un dato no
// confiable: nunca se copia tal cual en una cabecera.

/** Lo que se usa si del nombre no queda nada. */
const NOMBRE_DE_RESPALDO = 'documento';

/**
 * Versión ASCII del nombre, para `filename=`: sin acentos, y cualquier carácter fuera de un
 * conjunto seguro pasa a `_`. Así no puede cerrar las comillas, agregar parámetros ni partir la
 * cabecera (comillas, `;`, `\`, saltos de línea, caracteres de control).
 */
function nombreAscii(nombre: string): string {
  const limpio = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .trim();
  return /[A-Za-z0-9]/.test(limpio) ? limpio : NOMBRE_DE_RESPALDO;
}

/** Codificación de RFC 8187 (`filename*`): todo lo que no es un `attr-char` va en %XX (UTF-8). */
const codificar = (nombre: string): string =>
  encodeURIComponent(nombre).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<utf-8>`. Siempre `attachment`: el navegador
 * descarga el archivo y no lo abre en el origen de la API. Los navegadores actuales usan
 * `filename*` (conserva acentos y ñ); los viejos, la versión ASCII.
 */
export function contentDispositionDeDescarga(nombreOriginal: string): string {
  const sinControl = Array.from(nombreOriginal)
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('');
  const nombre = sinControl.trim() === '' ? NOMBRE_DE_RESPALDO : sinControl;
  return `attachment; filename="${nombreAscii(nombre)}"; filename*=UTF-8''${codificar(nombre)}`;
}
