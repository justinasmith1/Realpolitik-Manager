import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import {
  DocumentoResumenSchema,
  MENSAJE_FORMATO_DOCUMENTO,
  ResultadoCargaDocumentoSchema,
  TAMANIO_MAXIMO_DOCUMENTO_BYTES,
} from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { generarClaveDocumento } from '../../../lib/almacenamiento/almacenamiento';
import { AlmacenamientoEnMemoria } from '../../../lib/almacenamiento/memoria';

import { DOCM, DOCX, EJECUTABLE, MIME_DOCX, PDF, PNG, ZIP_GENERICO } from './archivosDePrueba';

// Se recorre la cadena real multer → validate → controller → service → mapper → errorHandler,
// con el almacenamiento en memoria y solo la base simulada. Lo que solo PostgreSQL puede probar
// (candidatos reales, snapshot, compensación con un error de la base) está en
// `documentos.integration.test.ts`.
const prismaMock = vi.hoisted(() => ({
  tipoDocumento: { findUnique: vi.fn<(args: unknown) => Promise<unknown>>() },
  itemChecklist: {
    findFirst: vi.fn<(args: unknown) => Promise<unknown>>(),
    findMany: vi.fn<(args: unknown) => Promise<unknown>>(),
  },
  documento: {
    findMany: vi.fn<(args: unknown) => Promise<unknown>>(),
    findUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
    create: vi.fn<(args: { data: Prisma.DocumentoUncheckedCreateInput }) => Promise<unknown>>(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const TIPO_ID = 'a1b2c3d4-e5f6-4789-8abc-000000000001';
const DOCUMENTO_ID = 'a1b2c3d4-e5f6-4789-8abc-000000000002';
const AHORA = new Date('2026-10-29T12:00:00.000Z');
const CAMPOS = { tipoDocumentoId: TIPO_ID, anio: '2026', mes: '10' };

/** Lo que devolvería la base al insertar `data`. */
const filaInsertada = ({ data }: { data: Prisma.DocumentoUncheckedCreateInput }) =>
  Promise.resolve({
    ...data,
    id: DOCUMENTO_ID,
    createdAt: AHORA,
    updatedAt: AHORA,
    tipoDocumento: { id: data.tipoDocumentoId, nombre: 'Constancia ARCA' },
  });

let almacenamiento: AlmacenamientoEnMemoria;
let app: Express;

beforeEach(() => {
  almacenamiento = new AlmacenamientoEnMemoria();
  app = createApp({ corsOrigins: ['http://localhost:5173'], documentos: { almacenamiento } });
  prismaMock.tipoDocumento.findUnique.mockResolvedValue({ activo: true });
  prismaMock.documento.findMany.mockResolvedValue([]);
  prismaMock.documento.create.mockImplementation(filaInsertada);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

interface Archivo {
  contenido: Buffer;
  nombre: string;
  tipo: string;
}
const PDF_VALIDO: Archivo = { contenido: PDF, nombre: 'constancia.pdf', tipo: 'application/pdf' };

function cargar(archivo: Archivo | null = PDF_VALIDO, campos: Record<string, string> = CAMPOS) {
  let pedido = request(app).post('/documentos');
  for (const [nombre, valor] of Object.entries(campos)) pedido = pedido.field(nombre, valor);
  return archivo === null
    ? pedido
    : pedido.attach('archivo', archivo.contenido, {
        filename: archivo.nombre,
        contentType: archivo.tipo,
      });
}

const error = (res: request.Response) =>
  (res.body as { error: { code: string; message: string; details?: unknown } }).error;

describe('documentos deshabilitados (producción sin protección)', () => {
  it('sin almacenamiento configurado, /documentos no existe: 404 en todas las rutas', async () => {
    const sinDocumentos = createApp({ corsOrigins: ['http://localhost:5173'] });
    const respuestas = await Promise.all([
      request(sinDocumentos).get('/documentos?anio=2026&mes=10'),
      request(sinDocumentos).post('/documentos').field('anio', '2026'),
      request(sinDocumentos).get(`/documentos/${DOCUMENTO_ID}/archivo`),
      request(sinDocumentos).get(`/documentos/${DOCUMENTO_ID}/candidatos`),
    ]);
    for (const res of respuestas) {
      expect(res.status).toBe(404);
      expect(error(res).code).toBe('NOT_FOUND');
    }
    expect(prismaMock.documento.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /documentos', () => {
  it('carga el documento: guarda el objeto y registra sus metadatos', async () => {
    const res = await cargar();

    expect(res.status).toBe(201);
    const resultado = ResultadoCargaDocumentoSchema.parse(res.body);
    expect(resultado.documento).toMatchObject({
      id: DOCUMENTO_ID,
      tipoDocumento: { id: TIPO_ID },
      anio: 2026,
      mes: 10,
      nombreOriginal: 'constancia.pdf',
      tipoContenido: 'application/pdf',
      tamanioBytes: PDF.length,
    });
    expect(resultado.posiblesDuplicados).toEqual([]);

    const { data } = prismaMock.documento.create.mock.calls[0]?.[0] ?? { data: null };
    expect(data).toMatchObject({
      sha256: createHash('sha256').update(PDF).digest('hex'),
      tipoContenido: 'application/pdf',
    });
    expect(data?.claveAlmacenamiento).toMatch(/^documentos\/[0-9a-f-]{36}$/);
    expect(await almacenamiento.existe(generarClaveDocumentoDe(data?.claveAlmacenamiento))).toBe(
      true,
    );
  });

  it('no expone el hash ni la clave del almacenamiento', async () => {
    const res = await cargar();
    expect(JSON.stringify(res.body)).not.toMatch(/sha256|claveAlmacenamiento|documentos\//);
  });

  it('conserva un nombre con acentos y le quita las carpetas', async () => {
    const res = await cargar({ ...PDF_VALIDO, nombre: 'C:\\Escritorio\\Constancia año.pdf' });
    expect(res.status).toBe(201);
    expect(ResultadoCargaDocumentoSchema.parse(res.body).documento.nombreOriginal).toBe(
      'Constancia año.pdf',
    );
  });

  it('acepta un DOCX real, aunque el navegador lo declare como genérico', async () => {
    const res = await cargar({
      contenido: DOCX,
      nombre: 'nota.docx',
      tipo: 'application/octet-stream',
    });
    expect(res.status).toBe(201);
    expect(ResultadoCargaDocumentoSchema.parse(res.body).documento.tipoContenido).toBe(MIME_DOCX);
  });

  it('un contenido repetido no se rechaza: vuelve como posible duplicado', async () => {
    prismaMock.documento.findMany.mockResolvedValue([
      {
        id: 'b1b2c3d4-e5f6-4789-8abc-000000000009',
        tipoDocumentoId: TIPO_ID,
        anio: 2026,
        mes: 10,
        nombreOriginal: 'el-mismo.pdf',
        tipoContenido: 'application/pdf',
        tamanioBytes: PDF.length,
        createdAt: AHORA,
        updatedAt: AHORA,
        tipoDocumento: { id: TIPO_ID, nombre: 'Constancia ARCA' },
      },
    ]);

    const res = await cargar();

    expect(res.status).toBe(201);
    expect(ResultadoCargaDocumentoSchema.parse(res.body).posiblesDuplicados).toHaveLength(1);
    expect(prismaMock.documento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sha256: createHash('sha256').update(PDF).digest('hex'),
          tipoDocumentoId: TIPO_ID,
          anio: 2026,
          mes: 10,
        },
      }),
    );
  });

  describe('archivo inválido (400, sin tocar la base ni el almacenamiento)', () => {
    it.each([
      [
        'un ejecutable con nombre de PDF',
        { contenido: EJECUTABLE, nombre: 'a.pdf', tipo: 'application/pdf' },
      ],
      [
        'un ZIP renombrado como DOCX',
        { contenido: ZIP_GENERICO, nombre: 'a.docx', tipo: MIME_DOCX },
      ],
      ['un Word con macros', { contenido: DOCM, nombre: 'a.docx', tipo: MIME_DOCX }],
    ])('rechaza %s por su contenido', async (_caso, archivo) => {
      const res = await cargar(archivo);
      expect(res.status).toBe(400);
      expect(error(res).details).toEqual([
        { campo: 'archivo', mensaje: MENSAJE_FORMATO_DOCUMENTO },
      ]);
      expect(almacenamiento.cantidad).toBe(0);
      expect(prismaMock.tipoDocumento.findUnique).not.toHaveBeenCalled();
    });

    it('rechaza una extensión que no coincide con el contenido', async () => {
      const res = await cargar({ contenido: PNG, nombre: 'foto.pdf', tipo: 'image/png' });
      expect(res.status).toBe(400);
      expect(error(res).details).toEqual([
        expect.objectContaining({
          campo: 'archivo',
          mensaje: expect.stringContaining('extensión') as unknown,
        }),
      ]);
    });

    it('rechaza un MIME declarado que contradice el contenido', async () => {
      const res = await cargar({ ...PDF_VALIDO, tipo: 'text/html' });
      expect(res.status).toBe(400);
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('rechaza un archivo vacío', async () => {
      const res = await cargar({ ...PDF_VALIDO, contenido: Buffer.alloc(0) });
      expect(res.status).toBe(400);
      expect(error(res).details).toEqual([
        expect.objectContaining({
          campo: 'archivo',
          mensaje: expect.stringContaining('10 MB') as unknown,
        }),
      ]);
    });

    it('un archivo de más de 10 MB es 413, sin detalles', async () => {
      const grande = Buffer.concat([PDF, Buffer.alloc(TAMANIO_MAXIMO_DOCUMENTO_BYTES)]);
      const res = await cargar({ ...PDF_VALIDO, contenido: grande });
      expect(res.status).toBe(413);
      expect(error(res).code).toBe('PAYLOAD_TOO_LARGE');
      expect(error(res).details).toBeUndefined();
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('sin archivo es 400 en el campo archivo', async () => {
      const res = await cargar(null);
      expect(res.status).toBe(400);
      expect(error(res).details).toEqual([
        { campo: 'archivo', mensaje: 'Elegí el archivo del documento.' },
      ]);
    });

    it('dos archivos, o el archivo en otro campo, es 400', async () => {
      const dos = await cargar().attach('archivo', PDF, {
        filename: 'b.pdf',
        contentType: 'application/pdf',
      });
      expect(dos.status).toBe(400);
      const otroCampo = await request(app)
        .post('/documentos')
        .field(CAMPOS)
        .attach('adjunto', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
      expect(otroCampo.status).toBe(400);
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('valida los campos del formulario antes de leer nada de la base', async () => {
      const res = await cargar(PDF_VALIDO, { tipoDocumentoId: 'x', anio: '2026', mes: '13' });
      expect(res.status).toBe(400);
      expect(error(res).details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ campo: 'tipoDocumentoId' }),
          expect.objectContaining({ campo: 'mes' }),
        ]),
      );
      expect(prismaMock.tipoDocumento.findUnique).not.toHaveBeenCalled();
    });

    it('un cuerpo JSON (no multipart) es 400: falta el archivo', async () => {
      const res = await request(app).post('/documentos').send(CAMPOS);
      expect(res.status).toBe(400);
    });
  });

  describe('tipo de documento', () => {
    it('inexistente: 404, sin guardar nada', async () => {
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(null);
      const res = await cargar();
      expect(res.status).toBe(404);
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('desactivado y sin ítems pendientes en el período: 409 TIPO_DOCUMENTO_INACTIVO', async () => {
      prismaMock.tipoDocumento.findUnique.mockResolvedValue({ activo: false });
      prismaMock.itemChecklist.findFirst.mockResolvedValue(null);
      const res = await cargar();
      expect(res.status).toBe(409);
      expect(error(res).details).toEqual({ motivo: 'TIPO_DOCUMENTO_INACTIVO' });
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('desactivado pero con ítems pendientes del período: se acepta', async () => {
      prismaMock.tipoDocumento.findUnique.mockResolvedValue({ activo: false });
      prismaMock.itemChecklist.findFirst.mockResolvedValue({ id: 'algun-item' });
      expect((await cargar()).status).toBe(201);
    });
  });

  describe('fallas y compensación', () => {
    it('si el almacenamiento falla: 503, sin registrar nada y sin detalles internos', async () => {
      almacenamiento.fallarLaProxima('guardar');
      const res = await cargar();
      expect(res.status).toBe(503);
      expect(error(res)).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        message:
          'El almacenamiento de documentos no está disponible. Intentá de nuevo en unos minutos.',
      });
      expect(prismaMock.documento.create).not.toHaveBeenCalled();
    });

    it('si falla PostgreSQL después de guardar, borra el objeto guardado (compensación)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      prismaMock.documento.create.mockRejectedValue(new Error('se cortó la conexión'));

      const res = await cargar();

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('conexión');
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('si la compensación también falla, responde igual y registra la clave huérfana', async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      prismaMock.documento.create.mockRejectedValue(new Error('se cortó la conexión'));
      almacenamiento.fallarLaProxima('eliminar');

      const res = await cargar();

      expect(res.status).toBe(500);
      expect(almacenamiento.cantidad).toBe(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/^No se pudo borrar el objeto documentos\/[0-9a-f-]{36} /),
      );
    });
  });
});

describe('GET /documentos', () => {
  it('lista el período con la cantidad de aplicaciones vigentes', async () => {
    prismaMock.documento.findMany.mockResolvedValue([
      {
        id: DOCUMENTO_ID,
        tipoDocumentoId: TIPO_ID,
        anio: 2026,
        mes: 10,
        nombreOriginal: 'constancia.pdf',
        tipoContenido: 'application/pdf',
        tamanioBytes: 10,
        sha256: 'a'.repeat(64),
        claveAlmacenamiento: generarClaveDocumento(),
        createdAt: AHORA,
        updatedAt: AHORA,
        tipoDocumento: { id: TIPO_ID, nombre: 'Constancia ARCA' },
        _count: { aplicaciones: 3 },
      },
    ]);

    const res = await request(app).get('/documentos?anio=2026&mes=10');

    expect(res.status).toBe(200);
    const [documento] = DocumentoResumenSchema.array().parse(res.body);
    expect(documento?.aplicacionesVigentes).toBe(3);
    const [crudo] = res.body as Record<string, unknown>[];
    expect(Object.keys(crudo ?? {})).not.toContain('claveAlmacenamiento');
  });

  it('exige el período', async () => {
    const res = await request(app).get('/documentos?anio=2026');
    expect(res.status).toBe(400);
    expect(error(res).details).toEqual([expect.objectContaining({ campo: 'mes' })]);
  });
});

/** Lee la respuesta como bytes, sea cual sea su Content-Type. */
const comoBytes = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
  const partes: Buffer[] = [];
  res.on('data', (parte: Buffer) => partes.push(parte));
  res.on('end', () => callback(null, Buffer.concat(partes)));
};

describe('GET /documentos/:id/archivo', () => {
  async function guardado(nombreOriginal: string) {
    const clave = generarClaveDocumento();
    await almacenamiento.guardar({ clave, contenido: PDF, tipoContenido: 'application/pdf' });
    prismaMock.documento.findUnique.mockResolvedValue({
      nombreOriginal,
      tipoContenido: 'application/pdf',
      tamanioBytes: PDF.length,
      claveAlmacenamiento: clave,
    });
  }

  it('descarga los mismos bytes, como adjunto y con las cabeceras de seguridad', async () => {
    await guardado('Constancia año.pdf');

    const res = await request(app)
      .get(`/documentos/${DOCUMENTO_ID}/archivo`)
      .buffer(true)
      .parse(comoBytes);

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    expect(res.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-length': String(PDF.length),
      'content-disposition': `attachment; filename="Constancia ano.pdf"; filename*=UTF-8''Constancia%20a%C3%B1o.pdf`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, no-store',
    });
  });

  it('un documento inexistente es 404', async () => {
    prismaMock.documento.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/documentos/${DOCUMENTO_ID}/archivo`);
    expect(res.status).toBe(404);
  });

  it('si el almacenamiento no responde: 503 en JSON, sin cabeceras de descarga', async () => {
    await guardado('a.pdf');
    almacenamiento.fallarLaProxima('obtener');

    const res = await request(app).get(`/documentos/${DOCUMENTO_ID}/archivo`);

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('un objeto que falta en el almacenamiento es un 500 (inconsistencia), no un 404', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prismaMock.documento.findUnique.mockResolvedValue({
      nombreOriginal: 'a.pdf',
      tipoContenido: 'application/pdf',
      tamanioBytes: 1,
      claveAlmacenamiento: generarClaveDocumento(),
    });
    expect((await request(app).get(`/documentos/${DOCUMENTO_ID}/archivo`)).status).toBe(500);
  });

  it('un id que no es UUID es 400', async () => {
    expect((await request(app).get('/documentos/no-es-uuid/archivo')).status).toBe(400);
  });
});

describe('GET /documentos/:id y /candidatos', () => {
  it('un documento inexistente es 404', async () => {
    prismaMock.documento.findUnique.mockResolvedValue(null);
    expect((await request(app).get(`/documentos/${DOCUMENTO_ID}`)).status).toBe(404);
    expect((await request(app).get(`/documentos/${DOCUMENTO_ID}/candidatos`)).status).toBe(404);
  });
});

/** La clave registrada, como clave del almacenamiento (falla el test si no tiene la forma). */
function generarClaveDocumentoDe(valor: unknown) {
  expect(typeof valor).toBe('string');
  return valor as ReturnType<typeof generarClaveDocumento>;
}

describe('aplicaciones, reemplazo e historial (validación, sin base)', () => {
  const ITEM = 'c1b2c3d4-e5f6-4789-8abc-000000000003';
  const RENDICION = 'c1b2c3d4-e5f6-4789-8abc-000000000004';
  const id = (n: number) => `d1b2c3d4-e5f6-4789-8abc-${String(n).padStart(12, '0')}`;

  it('deshabilitados (producción sin protección): las rutas nuevas tampoco existen', async () => {
    const sinDocumentos = createApp({ corsOrigins: ['http://localhost:5173'] });
    const respuestas = await Promise.all([
      request(sinDocumentos)
        .post(`/documentos/${DOCUMENTO_ID}/aplicaciones`)
        .send({ itemIds: [ITEM] }),
      request(sinDocumentos)
        .post(`/rendiciones/${RENDICION}/items/${ITEM}/reemplazo`)
        .send({ documentoId: DOCUMENTO_ID, aplicacionVigenteId: id(1) }),
      request(sinDocumentos).get(`/rendiciones/${RENDICION}/items/${ITEM}/aplicaciones`),
    ]);
    for (const res of respuestas) {
      expect(res.status).toBe(404);
      expect(error(res).code).toBe('NOT_FOUND');
    }
  });

  it.each([
    ['una lista vacía', { itemIds: [] }],
    ['un ítem repetido', { itemIds: [ITEM, ITEM] }],
    ['un id que no es UUID', { itemIds: ['x'] }],
    ['más de 500 ítems', { itemIds: Array.from({ length: 501 }, (_, n) => id(n)) }],
    ['sin el campo', {}],
  ])('aplicar rechaza %s con 400, sin tocar la base', async (_caso, cuerpo) => {
    const res = await request(app).post(`/documentos/${DOCUMENTO_ID}/aplicaciones`).send(cuerpo);
    expect(res.status).toBe(400);
    expect(error(res).details).toEqual([
      expect.objectContaining({ campo: expect.stringMatching(/^itemIds/) as unknown }),
    ]);
    expect(prismaMock.documento.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    [
      'un documento que no es UUID',
      { documentoId: 'x', aplicacionVigenteId: id(1) },
      'documentoId',
    ],
    ['sin la aplicación vigente esperada', { documentoId: DOCUMENTO_ID }, 'aplicacionVigenteId'],
  ])('reemplazar rechaza %s con 400', async (_caso, cuerpo, campo) => {
    const res = await request(app)
      .post(`/rendiciones/${RENDICION}/items/${ITEM}/reemplazo`)
      .send(cuerpo);
    expect(res.status).toBe(400);
    expect(error(res).details).toEqual([expect.objectContaining({ campo })]);
  });

  it('el historial rechaza ids que no son UUID', async () => {
    expect((await request(app).get(`/rendiciones/x/items/${ITEM}/aplicaciones`)).status).toBe(400);
  });
});
