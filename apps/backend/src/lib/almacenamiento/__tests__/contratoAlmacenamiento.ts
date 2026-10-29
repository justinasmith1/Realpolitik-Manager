// Suite de contrato de `AlmacenamientoDocumentos`: lo que TODO adaptador tiene que cumplir. Cada
// adaptador la corre con su propia fábrica (memoria, disco y S3 con un cliente simulado), así el
// comportamiento es el mismo sea cual sea el proveedor.

import { randomBytes } from 'node:crypto';
import { buffer } from 'node:stream/consumers';

import { describe, expect, it } from 'vitest';

import {
  esErrorAlmacenamiento,
  generarClaveDocumento,
  type AlmacenamientoDocumentos,
  type ClaveAlmacenamiento,
  type CodigoErrorAlmacenamiento,
} from '../almacenamiento';

const UUID = '1f0e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b';

/** Claves que ningún adaptador puede aceptar. `as`: se fuerzan a propósito, saltando el tipo. */
export const CLAVES_INVALIDAS: [string, unknown][] = [
  ['vacía', ''],
  ['sin el prefijo', UUID],
  ['con otro prefijo', `otros/${UUID}`],
  ['que sube de carpeta', `documentos/../${UUID}`],
  ['que apunta fuera de la raíz', '../../etc/passwd'],
  ['absoluta', `/documentos/${UUID}`],
  ['con barra invertida', `documentos\\${UUID}`],
  ['con mayúsculas', `documentos/${UUID.toUpperCase()}`],
  ['con un segmento de más', `documentos/${UUID}/otro`],
  ['con un espacio al final', `documentos/${UUID} `],
  ['codificada', `documentos%2F${UUID}`],
  ['con un UUID que no es v4', 'documentos/00000000-0000-1000-8000-000000000000'],
  ['que no es un texto', 42],
];

/** El código del `ErrorAlmacenamiento` con que falla la promesa (falla el test si no falla así). */
export async function codigoDeError(promesa: Promise<unknown>): Promise<CodigoErrorAlmacenamiento> {
  try {
    await promesa;
  } catch (error) {
    if (esErrorAlmacenamiento(error)) return error.codigo;
    throw error;
  }
  throw new Error('Se esperaba un ErrorAlmacenamiento y la operación terminó bien.');
}

const pdf = (contenido: Uint8Array, clave: ClaveAlmacenamiento = generarClaveDocumento()) => ({
  clave,
  contenido,
  tipoContenido: 'application/pdf',
});

async function leer(almacenamiento: AlmacenamientoDocumentos, clave: ClaveAlmacenamiento) {
  return buffer((await almacenamiento.obtener(clave)).contenido);
}

/** `crear` se llama en cada test: cada uno empieza con un almacenamiento vacío. */
export function probarContratoDeAlmacenamiento(crear: () => AlmacenamientoDocumentos): void {
  describe('contrato de AlmacenamientoDocumentos', () => {
    it('guarda y devuelve exactamente los mismos bytes (binarios)', async () => {
      const almacenamiento = crear();
      const contenido = Buffer.concat([Buffer.from([0x00, 0xff, 0x0a, 0x0d]), randomBytes(4096)]);
      const objeto = pdf(contenido);

      await almacenamiento.guardar(objeto);

      expect((await leer(almacenamiento, objeto.clave)).equals(contenido)).toBe(true);
    });

    it('existe es false antes de guardar y true después', async () => {
      const almacenamiento = crear();
      const objeto = pdf(Buffer.from('%PDF-1.7'));

      expect(await almacenamiento.existe(objeto.clave)).toBe(false);
      await almacenamiento.guardar(objeto);
      expect(await almacenamiento.existe(objeto.clave)).toBe(true);
    });

    it('no sobrescribe: la segunda escritura es YA_EXISTE y lo guardado no cambia', async () => {
      const almacenamiento = crear();
      const original = pdf(Buffer.from('original'));
      await almacenamiento.guardar(original);

      expect(
        await codigoDeError(
          almacenamiento.guardar({ ...original, contenido: Buffer.from('otro') }),
        ),
      ).toBe('YA_EXISTE');
      expect((await leer(almacenamiento, original.clave)).toString()).toBe('original');
    });

    it('obtener un objeto inexistente es NO_ENCONTRADO', async () => {
      expect(await codigoDeError(crear().obtener(generarClaveDocumento()))).toBe('NO_ENCONTRADO');
    });

    it('eliminar lo borra: deja de existir y no se puede leer', async () => {
      const almacenamiento = crear();
      const objeto = pdf(Buffer.from('a borrar'));
      await almacenamiento.guardar(objeto);

      await almacenamiento.eliminar(objeto.clave);

      expect(await almacenamiento.existe(objeto.clave)).toBe(false);
      expect(await codigoDeError(almacenamiento.obtener(objeto.clave))).toBe('NO_ENCONTRADO');
    });

    it('eliminar es idempotente: un objeto inexistente o ya borrado no es un error', async () => {
      const almacenamiento = crear();
      const objeto = pdf(Buffer.from('x'));
      await almacenamiento.eliminar(generarClaveDocumento());
      await almacenamiento.guardar(objeto);
      await almacenamiento.eliminar(objeto.clave);
      await expect(almacenamiento.eliminar(objeto.clave)).resolves.toBeUndefined();
    });

    it('cada clave es independiente: borrar una no toca otra', async () => {
      const almacenamiento = crear();
      const uno = pdf(Buffer.from('uno'));
      const dos = pdf(Buffer.from('dos'));
      await almacenamiento.guardar(uno);
      await almacenamiento.guardar(dos);

      await almacenamiento.eliminar(uno.clave);

      expect((await leer(almacenamiento, dos.clave)).toString()).toBe('dos');
    });

    it('modificar el buffer después de guardar no cambia lo guardado', async () => {
      const almacenamiento = crear();
      const contenido = Buffer.from('intacto');
      const objeto = pdf(contenido);
      await almacenamiento.guardar(objeto);

      contenido.fill(0);

      expect((await leer(almacenamiento, objeto.clave)).toString()).toBe('intacto');
    });

    it('cada obtener devuelve un contenido nuevo, que se puede leer de punta a punta', async () => {
      const almacenamiento = crear();
      const objeto = pdf(Buffer.from('dos lecturas'));
      await almacenamiento.guardar(objeto);

      expect((await leer(almacenamiento, objeto.clave)).toString()).toBe('dos lecturas');
      expect((await leer(almacenamiento, objeto.clave)).toString()).toBe('dos lecturas');
    });

    it.each(CLAVES_INVALIDAS)(
      'rechaza una clave %s en las cuatro operaciones',
      async (_caso, clave) => {
        const almacenamiento = crear();
        const invalida = clave as ClaveAlmacenamiento;
        expect(await codigoDeError(almacenamiento.guardar(pdf(Buffer.from('x'), invalida)))).toBe(
          'CLAVE_INVALIDA',
        );
        expect(await codigoDeError(almacenamiento.obtener(invalida))).toBe('CLAVE_INVALIDA');
        expect(await codigoDeError(almacenamiento.existe(invalida))).toBe('CLAVE_INVALIDA');
        expect(await codigoDeError(almacenamiento.eliminar(invalida))).toBe('CLAVE_INVALIDA');
      },
    );
  });
}
