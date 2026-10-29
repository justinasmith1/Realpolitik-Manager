import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  esErrorAlmacenamiento,
  generarClaveDocumento,
  type ClaveAlmacenamiento,
} from '../almacenamiento';
import { AlmacenamientoEnDisco } from '../disco';

import {
  CLAVES_INVALIDAS,
  codigoDeError,
  probarContratoDeAlmacenamiento,
} from './contratoAlmacenamiento';

// Cada test trabaja en una carpeta temporal propia del sistema operativo, que se borra al final.
// La raíz del almacenamiento es una subcarpeta: así se ve si algo se escribió FUERA de ella.
let carpeta: string;
let raiz: string;

beforeEach(async () => {
  carpeta = await mkdtemp(path.join(tmpdir(), 'rp-almacenamiento-'));
  raiz = path.join(carpeta, 'raiz');
});

afterEach(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

describe('AlmacenamientoEnDisco', () => {
  probarContratoDeAlmacenamiento(() => new AlmacenamientoEnDisco(raiz));

  const objeto = (contenido = Buffer.from('%PDF-1.7')) => ({
    clave: generarClaveDocumento(),
    contenido,
    tipoContenido: 'application/pdf',
  });

  it('guarda cada objeto como <raíz>/documentos/<uuid>, creando la raíz si no existe', async () => {
    const guardado = objeto();
    await new AlmacenamientoEnDisco(raiz).guardar(guardado);

    const [, uuid] = guardado.clave.split('/');
    expect(await readFile(path.join(raiz, 'documentos', uuid ?? ''))).toEqual(guardado.contenido);
  });

  it('una clave inválida no escribe nada, ni dentro ni fuera de la raíz', async () => {
    const almacenamiento = new AlmacenamientoEnDisco(raiz);
    for (const [, clave] of CLAVES_INVALIDAS) {
      await expect(
        almacenamiento.guardar({ ...objeto(), clave: clave as ClaveAlmacenamiento }),
      ).rejects.toThrow();
    }
    expect(await readdir(carpeta)).toEqual([]);
  });

  it('si la raíz no se puede usar (es un archivo), guardar es NO_DISPONIBLE con la causa', async () => {
    await writeFile(raiz, 'no soy una carpeta');

    await expect(new AlmacenamientoEnDisco(raiz).guardar(objeto())).rejects.toSatisfy(
      (error: unknown) =>
        esErrorAlmacenamiento(error, 'NO_DISPONIBLE') && typeof error.cause === 'object',
    );
  });

  it('una escritura que falla es NO_DISPONIBLE y no deja nada bajo esa clave', async () => {
    const almacenamiento = new AlmacenamientoEnDisco(raiz);
    const guardado = objeto();
    // Un contenido que `writeFile` rechaza. (Una falla A MITAD de la escritura, como un disco
    // lleno, no se puede provocar en un test portable: la cubre el `rm` del adaptador.)
    const roto = { ...guardado, contenido: { byteLength: 1 } as unknown as Uint8Array };

    expect(await codigoDeError(almacenamiento.guardar(roto))).toBe('NO_DISPONIBLE');
    expect(await almacenamiento.existe(guardado.clave)).toBe(false);
  });
});
