import { descargarArchivo } from '@/modules/documentos/api/documentos.api';

/**
 * Descarga un documento a través del backend (nunca con una URL del proveedor) y lo guarda con
 * su nombre original. Se pide con `fetch` y no con un enlace directo para poder mostrar un error
 * comprensible si falla (un enlace abriría la respuesta de error de la API). El archivo pesa como
 * mucho 10 MB, así que entra en memoria.
 */
export async function descargarDocumento(documento: {
  id: string;
  nombreOriginal: string;
}): Promise<void> {
  const contenido = await descargarArchivo(documento.id);
  const url = URL.createObjectURL(contenido);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = documento.nombreOriginal;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // El navegador ya tomó la URL al hacer clic; se libera un momento después.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
