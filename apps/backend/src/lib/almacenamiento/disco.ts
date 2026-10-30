import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ErrorAlmacenamiento,
  exigirClaveValida,
  noDisponible,
  noEncontrado,
  yaExiste,
  type AlmacenamientoDocumentos,
  type ClaveAlmacenamiento,
  type ObjetoAGuardar,
  type ObjetoObtenido,
} from './almacenamiento';

/** Código de un error del sistema de archivos (`ENOENT`, `EEXIST`…), si lo tiene. */
function codigoDeSistema(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Almacenamiento en una carpeta local, para desarrollo. Cada objeto es un archivo en
 * `<raiz>/documentos/<uuid>`. No guarda el tipo de contenido: está en la base (`Documento`). La
 * configuración no lo admite en producción (el disco de un contenedor no es persistente).
 */
export class AlmacenamientoEnDisco implements AlmacenamientoDocumentos {
  readonly #raiz: string;

  constructor(directorio: string) {
    this.#raiz = path.resolve(directorio);
  }

  /**
   * La ruta del archivo de una clave. Además de la lista blanca de `exigirClaveValida`, comprueba
   * que la ruta resuelta quede dentro de la raíz: una segunda barrera contra el path traversal.
   */
  #ruta(clave: ClaveAlmacenamiento): string {
    const valida = exigirClaveValida(clave);
    const ruta = path.resolve(this.#raiz, ...valida.split('/'));
    if (!ruta.startsWith(`${this.#raiz}${path.sep}`)) {
      throw new ErrorAlmacenamiento('CLAVE_INVALIDA', 'La clave de almacenamiento no es válida.');
    }
    return ruta;
  }

  async guardar({ clave, contenido }: ObjetoAGuardar): Promise<void> {
    const ruta = this.#ruta(clave);
    try {
      await mkdir(path.dirname(ruta), { recursive: true });
    } catch (error) {
      throw noDisponible('guardar el objeto', error);
    }
    try {
      // `wx`: crea el archivo y falla si ya existe, en una sola operación. Nunca sobrescribe.
      await writeFile(ruta, contenido, { flag: 'wx' });
    } catch (error) {
      if (codigoDeSistema(error) === 'EEXIST') {
        throw yaExiste();
      }
      // El archivo lo creó este intento (con `wx` no pudo ser otro): no se deja a medio escribir.
      await rm(ruta, { force: true }).catch(() => undefined);
      throw noDisponible('guardar el objeto', error);
    }
  }

  async obtener(clave: ClaveAlmacenamiento): Promise<ObjetoObtenido> {
    const ruta = this.#ruta(clave);
    if (!(await this.#esArchivo(ruta, 'leer el objeto'))) {
      throw noEncontrado();
    }
    return { contenido: createReadStream(ruta) };
  }

  async existe(clave: ClaveAlmacenamiento): Promise<boolean> {
    return this.#esArchivo(this.#ruta(clave), 'consultar el objeto');
  }

  async eliminar(clave: ClaveAlmacenamiento): Promise<void> {
    const ruta = this.#ruta(clave);
    try {
      // `force`: un archivo que no existe no es un error (eliminar es idempotente).
      await rm(ruta, { force: true });
    } catch (error) {
      throw noDisponible('eliminar el objeto', error);
    }
  }

  /** `true` si hay un archivo; `false` si no existe. Cualquier otra falla es `NO_DISPONIBLE`. */
  async #esArchivo(ruta: string, accion: string): Promise<boolean> {
    try {
      return (await stat(ruta)).isFile();
    } catch (error) {
      if (codigoDeSistema(error) === 'ENOENT') return false;
      throw noDisponible(accion, error);
    }
  }
}
