import { TipoContenidoDocumento } from '@realpolitik/shared';

/** Cómo se muestra un documento dentro del sistema (HU3.11). */
export type ClaseDeVistaPrevia = 'pdf' | 'imagen';

/**
 * Los formatos que el navegador muestra por sí mismo. El DOCX no está: se descarga. Ningún otro
 * formato se muestra nunca, aunque la API lo informara: el archivo se abre con el origen del
 * sistema y, por ejemplo, un HTML o un SVG podría ejecutar código.
 */
const CLASES: Partial<Record<TipoContenidoDocumento, ClaseDeVistaPrevia>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'imagen',
  'image/png': 'imagen',
};

/**
 * Cómo se muestra un documento según su `tipoContenido` (el que el backend detectó por el
 * contenido al cargarlo), o `null` si no se puede ver y solo se descarga.
 */
export function claseDeVistaPrevia(tipoContenido: string): ClaseDeVistaPrevia | null {
  const conocido = TipoContenidoDocumento.safeParse(tipoContenido);
  return conocido.success ? (CLASES[conocido.data] ?? null) : null;
}

/** Si se ofrece "Ver" para un documento. */
export const admiteVistaPrevia = (tipoContenido: string): boolean =>
  claseDeVistaPrevia(tipoContenido) !== null;
