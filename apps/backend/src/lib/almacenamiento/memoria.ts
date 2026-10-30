import { Readable } from 'node:stream';

import {
  exigirClaveValida,
  noDisponible,
  noEncontrado,
  yaExiste,
  type AlmacenamientoDocumentos,
  type ClaveAlmacenamiento,
  type ObjetoAGuardar,
  type ObjetoObtenido,
  type OperacionAlmacenamiento,
} from './almacenamiento';

/**
 * El resultado de `trabajo` como promesa: un `throw` adentro llega como rechazo, igual que en los
 * adaptadores que sí esperan E/S. Nunca lanza en forma sincrónica.
 */
const comoPromesa = <T>(trabajo: () => T): Promise<T> =>
  new Promise<T>((resolve) => resolve(trabajo()));

/**
 * Almacenamiento en memoria, para tests. Se pierde al terminar el proceso: la configuración no lo
 * admite en producción. Guarda una COPIA del contenido, así un buffer modificado después por quien
 * llamó no cambia lo guardado (igual que en un almacenamiento real).
 */
export class AlmacenamientoEnMemoria implements AlmacenamientoDocumentos {
  readonly #objetos = new Map<string, Buffer>();
  readonly #fallas = new Set<OperacionAlmacenamiento>();

  /**
   * Hace fallar con `NO_DISPONIBLE` la PRÓXIMA llamada a `operacion` (solo esa). Sirve para probar
   * las compensaciones entre la base y el almacenamiento.
   */
  fallarLaProxima(operacion: OperacionAlmacenamiento): void {
    this.#fallas.add(operacion);
  }

  /** Cuántos objetos hay guardados (para comprobar que no quedan huérfanos). */
  get cantidad(): number {
    return this.#objetos.size;
  }

  guardar({ clave, contenido }: ObjetoAGuardar): Promise<void> {
    return comoPromesa(() => {
      const valida = exigirClaveValida(clave);
      this.#simularFalla('guardar', 'guardar el objeto');
      if (this.#objetos.has(valida)) {
        throw yaExiste();
      }
      this.#objetos.set(valida, Buffer.from(contenido));
    });
  }

  obtener(clave: ClaveAlmacenamiento): Promise<ObjetoObtenido> {
    return comoPromesa(() => {
      const valida = exigirClaveValida(clave);
      this.#simularFalla('obtener', 'leer el objeto');
      const guardado = this.#objetos.get(valida);
      if (guardado === undefined) {
        throw noEncontrado();
      }
      // `Readable.from` con un Buffer lo emite entero, sin recorrerlo byte a byte.
      return { contenido: Readable.from(Buffer.from(guardado)) };
    });
  }

  existe(clave: ClaveAlmacenamiento): Promise<boolean> {
    return comoPromesa(() => {
      const valida = exigirClaveValida(clave);
      this.#simularFalla('existe', 'consultar el objeto');
      return this.#objetos.has(valida);
    });
  }

  eliminar(clave: ClaveAlmacenamiento): Promise<void> {
    return comoPromesa(() => {
      const valida = exigirClaveValida(clave);
      this.#simularFalla('eliminar', 'eliminar el objeto');
      this.#objetos.delete(valida);
    });
  }

  #simularFalla(operacion: OperacionAlmacenamiento, accion: string): void {
    if (this.#fallas.delete(operacion)) {
      throw noDisponible(accion, new Error(`Falla simulada en "${operacion}"`));
    }
  }
}
