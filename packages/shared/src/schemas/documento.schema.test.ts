import { describe, expect, it } from 'vitest';

import {
  DocumentoNuevoSchema,
  DocumentoSchema,
  FORMATOS_DE_DOCUMENTO,
  ListarDocumentosQuerySchema,
  NOMBRE_ORIGINAL_MAX,
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
  TipoContenidoDocumento,
} from './documento.schema.js';

const TIPO_ID = 'a1b2c3d4-e5f6-4789-8abc-000000000001';
const DOCUMENTO_ID = 'a1b2c3d4-e5f6-4789-8abc-000000000002';
const SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const nuevo = {
  tipoDocumentoId: TIPO_ID,
  anio: 2026,
  mes: 10,
  nombreOriginal: 'Constancia ARCA octubre.pdf',
  tipoContenido: 'application/pdf',
  tamanioBytes: 245_760,
  sha256: SHA256,
};

/** Los campos con error de un pedido inválido. */
function camposConError(cuerpo: unknown): string[] {
  const r = DocumentoNuevoSchema.safeParse(cuerpo);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues.map((issue) => issue.path.join('.'));
}

describe('Formatos de documento', () => {
  it('admite PDF, JPG/JPEG, PNG y DOCX', () => {
    expect(TipoContenidoDocumento.options).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
    expect(FORMATOS_DE_DOCUMENTO['image/jpeg'].extensiones).toEqual(['jpg', 'jpeg']);
  });

  it('cada formato tiene etiqueta y extensiones en minúscula, sin punto', () => {
    for (const tipo of TipoContenidoDocumento.options) {
      const { etiqueta, extensiones } = FORMATOS_DE_DOCUMENTO[tipo];
      expect(etiqueta).not.toBe('');
      expect(extensiones.length).toBeGreaterThan(0);
      for (const extension of extensiones) expect(extension).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('el tope inicial es de 10 MB', () => {
    expect(TAMANIO_MAXIMO_DOCUMENTO_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('DocumentoNuevoSchema', () => {
  it('acepta un documento válido', () => {
    expect(DocumentoNuevoSchema.parse(nuevo)).toEqual(nuevo);
  });

  it.each(TipoContenidoDocumento.options)('acepta el formato %s', (tipoContenido) => {
    expect(DocumentoNuevoSchema.safeParse({ ...nuevo, tipoContenido }).success).toBe(true);
  });

  it('recorta el nombre del archivo', () => {
    expect(DocumentoNuevoSchema.parse({ ...nuevo, nombreOriginal: '  factura.pdf ' })).toEqual({
      ...nuevo,
      nombreOriginal: 'factura.pdf',
    });
  });

  it('ignora otros campos: la clave del almacenamiento la genera el backend', () => {
    expect(
      DocumentoNuevoSchema.parse({ ...nuevo, claveAlmacenamiento: 'x', id: DOCUMENTO_ID }),
    ).toEqual(nuevo);
  });

  describe('período', () => {
    it('acepta los extremos del rango de la base', () => {
      expect(DocumentoNuevoSchema.safeParse({ ...nuevo, anio: 2020, mes: 1 }).success).toBe(true);
      expect(DocumentoNuevoSchema.safeParse({ ...nuevo, anio: 2100, mes: 12 }).success).toBe(true);
    });

    it.each([
      ['mes 0', { mes: 0 }, 'mes'],
      ['mes 13', { mes: 13 }, 'mes'],
      ['mes con decimales', { mes: 10.5 }, 'mes'],
      ['mes como texto', { mes: '10' }, 'mes'],
      ['año 2019', { anio: 2019 }, 'anio'],
      ['año 2101', { anio: 2101 }, 'anio'],
      ['sin año', { anio: undefined }, 'anio'],
    ])('rechaza %s', (_caso, cambio, campo) => {
      expect(camposConError({ ...nuevo, ...cambio })).toEqual([campo]);
    });

    it('no aplica el tope de "hasta el mes siguiente" de la rendición', () => {
      expect(DocumentoNuevoSchema.safeParse({ ...nuevo, anio: 2099, mes: 12 }).success).toBe(true);
    });
  });

  describe('tamaño', () => {
    it('acepta 1 byte y exactamente el máximo', () => {
      expect(DocumentoNuevoSchema.safeParse({ ...nuevo, tamanioBytes: 1 }).success).toBe(true);
      expect(
        DocumentoNuevoSchema.safeParse({ ...nuevo, tamanioBytes: TAMANIO_MAXIMO_DOCUMENTO_BYTES })
          .success,
      ).toBe(true);
    });

    it.each([
      ['un archivo vacío', 0],
      ['un tamaño negativo', -1],
      ['un byte más que el máximo', TAMANIO_MAXIMO_DOCUMENTO_BYTES + 1],
      ['un tamaño con decimales', 10.5],
      ['un texto', '100'],
    ])('rechaza %s con un mensaje en español', (_caso, tamanioBytes) => {
      const r = DocumentoNuevoSchema.safeParse({ ...nuevo, tamanioBytes });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues).toEqual([
          expect.objectContaining({
            path: ['tamanioBytes'],
            message: 'El archivo tiene que pesar más de 0 bytes y hasta 10 MB.',
          }),
        ]);
      }
    });
  });

  describe('tipo de contenido', () => {
    it.each([
      ['HTML (se ejecutaría al abrirlo)', 'text/html'],
      ['SVG (puede llevar scripts)', 'image/svg+xml'],
      ['un ejecutable', 'application/x-msdownload'],
      ['un genérico', 'application/octet-stream'],
      ['DOC (Word anterior a DOCX)', 'application/msword'],
      ['el MIME de PDF en mayúscula', 'Application/PDF'],
      ['un texto vacío', ''],
    ])('rechaza %s', (_caso, tipoContenido) => {
      const r = DocumentoNuevoSchema.safeParse({ ...nuevo, tipoContenido });
      expect(r.success).toBe(false);
      if (!r.success) {
        expect(r.error.issues).toEqual([
          expect.objectContaining({
            path: ['tipoContenido'],
            message: 'El formato del archivo no está admitido. Se aceptan PDF, JPG, PNG y DOCX.',
          }),
        ]);
      }
    });
  });

  describe('nombre del archivo', () => {
    it(`acepta hasta ${NOMBRE_ORIGINAL_MAX} caracteres y rechaza uno más`, () => {
      const largo = 'a'.repeat(NOMBRE_ORIGINAL_MAX - 4);
      expect(
        DocumentoNuevoSchema.safeParse({ ...nuevo, nombreOriginal: `${largo}.pdf` }).success,
      ).toBe(true);
      expect(camposConError({ ...nuevo, nombreOriginal: `${largo}x.pdf` })).toEqual([
        'nombreOriginal',
      ]);
    });

    it.each([
      ['vacío', ''],
      ['de solo espacios', '   '],
      ['con un NUL', 'factura\u0000.pdf'],
      ['con un salto de línea', 'factura\n.pdf'],
      ['con una carpeta', '../secreto.pdf'],
      ['con una carpeta de Windows', 'C:\\docs\\factura.pdf'],
    ])('rechaza un nombre %s', (_caso, nombreOriginal) => {
      expect(camposConError({ ...nuevo, nombreOriginal })).toEqual(['nombreOriginal']);
    });
  });

  describe('hash', () => {
    it.each([
      ['en mayúscula', SHA256.toUpperCase()],
      ['con un carácter de menos', SHA256.slice(1)],
      ['con un carácter que no es hexadecimal', `g${SHA256.slice(1)}`],
      ['vacío', ''],
    ])('rechaza un SHA-256 %s', (_caso, sha256) => {
      expect(camposConError({ ...nuevo, sha256 })).toEqual(['sha256']);
    });
  });

  it.each([
    ['que no es uuid', 'no-es-uuid'],
    ['ausente', undefined],
  ])('rechaza un tipo de documento %s', (_caso, tipoDocumentoId) => {
    expect(camposConError({ ...nuevo, tipoDocumentoId })).toEqual(['tipoDocumentoId']);
  });
});

describe('DocumentoSchema (lectura)', () => {
  const leido = {
    id: DOCUMENTO_ID,
    tipoDocumento: { id: TIPO_ID, nombre: 'Constancia ARCA' },
    anio: 2026,
    mes: 10,
    nombreOriginal: 'Constancia ARCA octubre.pdf',
    tipoContenido: 'application/pdf',
    tamanioBytes: 245_760,
    creadoEn: '2026-10-29T12:00:00.000Z',
    actualizadoEn: '2026-10-29T12:00:00.000Z',
  };

  it('lee el documento y convierte las fechas', () => {
    const r = DocumentoSchema.parse(leido);
    expect(r.creadoEn).toBeInstanceOf(Date);
    expect(r.tipoDocumento.nombre).toBe('Constancia ARCA');
  });

  it('no expone el hash ni la clave del almacenamiento', () => {
    const r = DocumentoSchema.parse({ ...leido, sha256: SHA256, claveAlmacenamiento: 'k' });
    expect(r).not.toHaveProperty('sha256');
    expect(r).not.toHaveProperty('claveAlmacenamiento');
  });

  it('no aplica la lista de formatos de escritura: un formato que se deje de admitir se lee', () => {
    expect(
      DocumentoSchema.safeParse({ ...leido, tipoContenido: 'application/msword' }).success,
    ).toBe(true);
  });

  it.each([
    ['un id que no es uuid', { id: 'x' }],
    ['un tipo sin id válido', { tipoDocumento: { id: 'x', nombre: 'A' } }],
    ['un tamaño 0', { tamanioBytes: 0 }],
    ['sin fecha de carga', { creadoEn: undefined }],
  ])('rechaza %s', (_caso, cambio) => {
    expect(DocumentoSchema.safeParse({ ...leido, ...cambio }).success).toBe(false);
  });
});

describe('ListarDocumentosQuerySchema', () => {
  it('convierte el período a números', () => {
    expect(ListarDocumentosQuerySchema.parse({ anio: '2026', mes: '10' })).toEqual({
      anio: 2026,
      mes: 10,
    });
  });

  it('acepta filtrar por tipo de documento', () => {
    expect(
      ListarDocumentosQuerySchema.parse({ anio: '2026', mes: '10', tipoDocumentoId: TIPO_ID }),
    ).toEqual({ anio: 2026, mes: 10, tipoDocumentoId: TIPO_ID });
  });

  it.each([
    ['sin año', { mes: '10' }, 'anio', 'El año debe ser un número entero entre 2020 y 2100.'],
    ['sin mes', { anio: '2026' }, 'mes', 'El mes debe ser un número entero entre 1 y 12.'],
    [
      'mes 13',
      { anio: '2026', mes: '13' },
      'mes',
      'El mes debe ser un número entero entre 1 y 12.',
    ],
    [
      'un mes que no son dígitos',
      { anio: '2026', mes: '1e1' },
      'mes',
      'El mes debe ser un número entero entre 1 y 12.',
    ],
    [
      'un tipo que no es uuid',
      { anio: '2026', mes: '10', tipoDocumentoId: 'x' },
      'tipoDocumentoId',
      'El tipo de documento debe ser un UUID válido.',
    ],
  ])('rechaza %s con un mensaje en español', (_caso, query, campo, mensaje) => {
    const r = ListarDocumentosQuerySchema.safeParse(query);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual([
        expect.objectContaining({ path: [campo], message: mensaje }),
      ]);
    }
  });
});
