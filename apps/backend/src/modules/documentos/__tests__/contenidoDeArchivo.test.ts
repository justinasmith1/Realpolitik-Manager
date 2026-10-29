import { MENSAJE_FORMATO_DOCUMENTO, TAMANIO_MAXIMO_DOCUMENTO_BYTES } from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/app-error';
import { detectarTipoContenido, validarArchivo } from '../contenidoDeArchivo';

import {
  DOCM,
  DOCX,
  DOCX_BOMBA,
  DOCX_SIN_COMPRIMIR,
  DOCX_SIN_DOCUMENTO,
  EJECUTABLE,
  HTML,
  JPEG,
  MIME_DOCX,
  PDF,
  PNG,
  XLSX,
  ZIP_GENERICO,
} from './archivosDePrueba';

/** El mensaje del 400 en el campo `archivo`, o falla el test. */
function mensajeDeError(validar: () => unknown): string {
  try {
    validar();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const { details } = error as AppError;
    expect(details).toEqual([expect.objectContaining({ campo: 'archivo' })]);
    return (details as { mensaje: string }[])[0]?.mensaje ?? '';
  }
  throw new Error('Se esperaba un 400 y el archivo pasó.');
}

describe('detectarTipoContenido (por el contenido, no por el nombre)', () => {
  it.each([
    ['PDF', PDF, 'application/pdf'],
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['DOCX', DOCX, MIME_DOCX],
    ['DOCX con entradas sin comprimir', DOCX_SIN_COMPRIMIR, MIME_DOCX],
  ])('reconoce %s', (_caso, contenido, tipo) => {
    expect(detectarTipoContenido(contenido)).toBe(tipo);
  });

  it.each([
    ['un ZIP cualquiera (la firma PK no alcanza)', ZIP_GENERICO],
    ['un Word con macros (.docm)', DOCM],
    ['una planilla de Excel', XLSX],
    ['un ZIP que declara Word pero no tiene el documento', DOCX_SIN_DOCUMENTO],
    ['un "zip bomb" (no se descomprime más de 1 MB)', DOCX_BOMBA],
    ['un ejecutable', EJECUTABLE],
    ['HTML', HTML],
    ['un archivo vacío', Buffer.alloc(0)],
    ['un ZIP truncado', DOCX.subarray(0, DOCX.length - 30)],
    ['solo la firma de un ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  ])('no admite %s', (_caso, contenido) => {
    expect(detectarTipoContenido(contenido)).toBeNull();
  });
});

describe('validarArchivo', () => {
  const pdf = {
    nombreOriginal: 'constancia.pdf',
    tipoMimeDeclarado: 'application/pdf',
    contenido: PDF,
  };

  it('devuelve el formato detectado', () => {
    expect(validarArchivo(pdf)).toBe('application/pdf');
    expect(
      validarArchivo({
        nombreOriginal: 'Nota.DOCX',
        tipoMimeDeclarado: MIME_DOCX,
        contenido: DOCX,
      }),
    ).toBe(MIME_DOCX);
  });

  it.each([
    ['vacío', ''],
    ['genérico (navegador sin Office)', 'application/octet-stream'],
    ['con parámetros', 'application/pdf; charset=binary'],
  ])('acepta un MIME declarado %s', (_caso, tipoMimeDeclarado) => {
    expect(validarArchivo({ ...pdf, tipoMimeDeclarado })).toBe('application/pdf');
  });

  it('acepta los alias de JPEG y las dos extensiones', () => {
    for (const nombreOriginal of ['foto.jpg', 'foto.JPEG']) {
      expect(
        validarArchivo({ nombreOriginal, tipoMimeDeclarado: 'image/pjpeg', contenido: JPEG }),
      ).toBe('image/jpeg');
    }
  });

  it('rechaza un formato no admitido aunque el nombre y el MIME digan PDF', () => {
    expect(mensajeDeError(() => validarArchivo({ ...pdf, contenido: EJECUTABLE }))).toBe(
      MENSAJE_FORMATO_DOCUMENTO,
    );
  });

  it('rechaza un ZIP renombrado como .docx', () => {
    expect(
      mensajeDeError(() =>
        validarArchivo({
          nombreOriginal: 'a.docx',
          tipoMimeDeclarado: MIME_DOCX,
          contenido: ZIP_GENERICO,
        }),
      ),
    ).toBe(MENSAJE_FORMATO_DOCUMENTO);
  });

  it.each([
    ['otra extensión', 'constancia.png'],
    ['sin extensión', 'constancia'],
    ['una extensión doble que termina en otra cosa', 'constancia.pdf.exe'],
  ])('rechaza un nombre con %s', (_caso, nombreOriginal) => {
    expect(mensajeDeError(() => validarArchivo({ ...pdf, nombreOriginal }))).toContain(
      'La extensión del archivo no coincide con su contenido (PDF)',
    );
  });

  it('rechaza un MIME declarado que contradice el contenido', () => {
    expect(mensajeDeError(() => validarArchivo({ ...pdf, tipoMimeDeclarado: 'image/png' }))).toBe(
      'El tipo del archivo no coincide con su contenido (PDF).',
    );
  });

  it.each([
    ['vacío', Buffer.alloc(0)],
    ['de más de 10 MB', Buffer.concat([PDF, Buffer.alloc(TAMANIO_MAXIMO_DOCUMENTO_BYTES)])],
  ])('rechaza un archivo %s', (_caso, contenido) => {
    expect(mensajeDeError(() => validarArchivo({ ...pdf, contenido }))).toContain('hasta 10 MB');
  });
});
