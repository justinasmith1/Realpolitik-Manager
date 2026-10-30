// Archivos ficticios para los tests de documentos: chicos, armados acá y sin datos reales.

import { deflateRawSync } from 'node:zlib';

interface EntradaDePrueba {
  nombre: string;
  contenido: string | Buffer;
  /** `false`: la entrada va sin comprimir (método 0). Por defecto, "deflate" (método 8). */
  comprimir?: boolean;
}

/**
 * Un ZIP mínimo pero bien formado (cabeceras locales, directorio central y registro final), como
 * el de un DOCX. El CRC va en 0: el detector no lo verifica.
 */
export function zip(entradas: readonly EntradaDePrueba[]): Buffer {
  const partes: Buffer[] = [];
  const directorio: Buffer[] = [];
  let desplazamiento = 0;
  for (const entrada of entradas) {
    const datos = Buffer.from(entrada.contenido);
    const metodo = entrada.comprimir === false ? 0 : 8;
    const guardado = metodo === 0 ? datos : deflateRawSync(datos);
    const nombre = Buffer.from(entrada.nombre, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(guardado.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    partes.push(local, nombre, guardado);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(guardado.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    directorio.push(central, nombre);

    desplazamiento += local.length + nombre.length + guardado.length;
  }
  const central = Buffer.concat(directorio);
  const final = Buffer.alloc(22);
  final.writeUInt32LE(0x06054b50, 0);
  final.writeUInt16LE(entradas.length, 8);
  final.writeUInt16LE(entradas.length, 10);
  final.writeUInt32LE(central.length, 12);
  final.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, central, final]);
}

const tiposDeContenido = (principal: string, parte: string) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  `<Override PartName="/${parte}" ContentType="${principal}"/></Types>`;

const PRINCIPAL_WORD =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

export const PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n', 'latin1');
export const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

export const DOCX = zip([
  {
    nombre: '[Content_Types].xml',
    contenido: tiposDeContenido(PRINCIPAL_WORD, 'word/document.xml'),
  },
  { nombre: 'word/document.xml', contenido: '<w:document/>' },
]);
/** El mismo DOCX con las entradas sin comprimir (algunos generadores lo hacen así). */
export const DOCX_SIN_COMPRIMIR = zip([
  {
    nombre: '[Content_Types].xml',
    contenido: tiposDeContenido(PRINCIPAL_WORD, 'word/document.xml'),
    comprimir: false,
  },
  { nombre: 'word/document.xml', contenido: '<w:document/>', comprimir: false },
]);

/** Un ZIP cualquiera: tiene la firma `PK` pero no es un documento de Word. */
export const ZIP_GENERICO = zip([{ nombre: 'notas.txt', contenido: 'hola' }]);
/** Word con macros (`.docm`): otro contenido principal. */
export const DOCM = zip([
  {
    nombre: '[Content_Types].xml',
    contenido: tiposDeContenido(
      'application/vnd.ms-word.document.macroEnabled.main+xml',
      'word/document.xml',
    ),
  },
  { nombre: 'word/document.xml', contenido: '<w:document/>' },
  { nombre: 'word/vbaProject.bin', contenido: 'macro' },
]);
/** Una planilla de Excel: también es un ZIP de Office. */
export const XLSX = zip([
  {
    nombre: '[Content_Types].xml',
    contenido: tiposDeContenido(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      'xl/workbook.xml',
    ),
  },
  { nombre: 'xl/workbook.xml', contenido: '<workbook/>' },
]);
/** Declara Word pero le falta `word/document.xml`. */
export const DOCX_SIN_DOCUMENTO = zip([
  {
    nombre: '[Content_Types].xml',
    contenido: tiposDeContenido(PRINCIPAL_WORD, 'word/document.xml'),
  },
]);
/** `[Content_Types].xml` que descomprime a más de 1 MB: un "zip bomb" en miniatura. */
export const DOCX_BOMBA = zip([
  {
    nombre: '[Content_Types].xml',
    contenido: `${tiposDeContenido(PRINCIPAL_WORD, 'word/document.xml')}${' '.repeat(2 * 1024 * 1024)}`,
  },
  { nombre: 'word/document.xml', contenido: '<w:document/>' },
]);

export const EJECUTABLE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
export const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
