// Permisos de los documentos (HU4.4, CA14) contra PostgreSQL REAL, con sesiones reales (cookie,
// validación contra la base, contraseña definitiva, solo lectura de CONSULTA y `autorizar`) y el
// almacenamiento en memoria. Completa lo que el test de matriz (`matrizDePermisos.test.ts`) no
// puede probar con la base simulada:
// A. sin sesión, ni metadatos ni bytes, y el almacenamiento no se lee;
// B. CONSULTA lee el repositorio, el detalle y el historial, y descarga los bytes REALES;
// C. CONSULTA no carga, no pide candidatos, no aplica ni reemplaza: 403 por pedido directo;
// D. esos intentos no cambian la base ni el almacenamiento (foto antes y después);
// E. ADMINISTRATIVO conserva sus operaciones (lo demás, en documentos y aplicaciones.integration);
// F. ADMINISTRADOR hace el recorrido completo: cargar, candidatos, aplicar, ver, descargar,
//    reemplazar e historial;
// G. con la contraseña temporal pendiente no entra a Documentos, y al final los datos de las
//    operaciones autorizadas son coherentes.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no termina en `_test`. Antes
// de escribir nada (cuentas, sesiones, datos), `exigirBaseDePrueba` confirma con
// `current_database()` que la conexión real de `lib/prisma` es la base de esa URL, en ese servidor.
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@127.0.0.1:5432/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run documentos.permisos.integration
//
// No usa el seed. Cada dato lleva una marca única y la limpieza final borra solo eso.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { PrismaClient } from '@prisma/client';
import {
  CandidatoAplicacionSchema,
  DocumentoConAplicacionesSchema,
  DocumentoResumenSchema,
  HistorialDeItemSchema,
  mesActual,
  normalizarNombreTipoDocumento as normalizar,
  RendicionDetalleSchema,
  ResultadoCargaDocumentoSchema,
} from '@realpolitik/shared';
import type { Express } from 'express';
import type request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { exigirClaveValida } from '../../../lib/almacenamiento/almacenamiento';
import { AlmacenamientoEnMemoria } from '../../../lib/almacenamiento/memoria';
import { sesionesDePrueba } from '../../auth/__tests__/sesionReal';
import {
  clienteConCabeceras,
  ORIGEN_DE_PRUEBA,
  type IdentidadDePrueba,
} from '../../auth/__tests__/sesionSimulada';
import { NOMBRE_COOKIE_DE_SESION } from '../../auth/cookieDeSesion';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { conectarBaseDePrueba } from '../../clientes/__tests__/baseVerificada';

import { PDF, PNG } from './archivosDePrueba';

const url = urlDeBaseDescartable();
const BASE_DE_LA_URL = url === undefined ? '' : decodeURIComponent(new URL(url).pathname.slice(1));

let prisma: PrismaClient;
let prismaInicializado = false;
let baseEnUso: string | undefined;
let app: Express;
const almacenamiento = new AlmacenamientoEnMemoria();
const clientesCreados: string[] = [];

const MARCA = `TESTPERM${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);
const PERIODO = mesActual();

/** CUIT único. La base no valida el dígito verificador. El prefijo 27 no lo usa otra suite. */
const cuitDePrueba = () => `27-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
const facturaDePrueba = () => `B 00044-${String(randomInt(1e8)).padStart(8, '0')}`;

/** Cuentas y sesiones reales de este archivo: una por rol y una con la contraseña pendiente. */
const sesiones = sesionesDePrueba();

beforeAll(async () => {
  if (url === undefined) return;
  // Más estricto que `urlDeBaseDescartable` (que también admite `*_audit`): esta suite escribe.
  if (!BASE_DE_LA_URL.endsWith('_test')) {
    throw new Error(`"${BASE_DE_LA_URL}" no termina en _test: esta suite no se ejecuta.`);
  }
  // Fija DATABASE_URL, importa `lib/prisma` y verifica su conexión real (`exigirBaseDePrueba`), la
  // misma que usan las cuentas, los servicios y la app. Si falla, la desconecta y lanza: no se crea
  // nada y el `afterAll` tampoco escribe (`prismaInicializado` sigue false).
  prisma = await conectarBaseDePrueba(url);
  const [fila] = await prisma.$queryRaw<{ base: string }[]>`SELECT current_database() AS "base"`;
  baseEnUso = fila?.base;
  prismaInicializado = true;
  await sesiones.preparar();
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: [ORIGEN_DE_PRUEBA], documentos: { almacenamiento } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    const deLaMarca = { tipoDocumento: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } } };
    // Las aplicaciones primero (FK RESTRICT; la cadena de reemplazos también, pero un solo DELETE
    // borra todas juntas), después los documentos y las rendiciones: sus ítems y su historial de
    // estados caen en cascada. El historial va antes que las cuentas (FK RESTRICT de HU4.6).
    await prisma.aplicacionDocumento.deleteMany({ where: { documento: deLaMarca } });
    await prisma.documento.deleteMany({ where: deLaMarca });
    await prisma.rendicion.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
    await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
    await prisma.tipoDocumento.deleteMany({
      where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
    });
  } finally {
    await sesiones.limpiar();
    await prisma.$disconnect();
  }
});

// ─── Pedidos ──────────────────────────────────────────────────────────────────

const como = (identidad: IdentidadDePrueba) => sesiones.cliente(app, identidad);

/** Pedidos sin cookie (con un `Origin` permitido) y con un token que no existe en la base. */
const sinSesion = () => [
  clienteConCabeceras(app, { Origin: ORIGEN_DE_PRUEBA }),
  clienteConCabeceras(app, {
    Origin: ORIGEN_DE_PRUEBA,
    Cookie: `${NOMBRE_COOKIE_DE_SESION}=${'A'.repeat(43)}`,
  }),
];

/** El cuerpo de una descarga, como bytes (supertest no junta un PDF ni un PNG por su cuenta). */
const comoBytes = (res: request.Response, callback: (err: Error | null, body: Buffer) => void) => {
  const partes: Buffer[] = [];
  res.on('data', (parte: Buffer) => partes.push(parte));
  res.on('end', () => callback(null, Buffer.concat(partes)));
};

const descargar = (identidad: IdentidadDePrueba, documentoId: string) =>
  como(identidad).get(`/documentos/${documentoId}/archivo`).buffer(true).parse(comoBytes);

const repositorio = (identidad: IdentidadDePrueba) =>
  como(identidad).get(
    `/documentos?anio=${PERIODO.anio}&mes=${PERIODO.mes}&tipoDocumentoId=${e.print}`,
  );

const rutaDeItem = (itemId: string) => `/rendiciones/${e.rendicion}/items/${itemId}`;

const aplicar = (identidad: IdentidadDePrueba, documentoId: string, itemIds: string[]) =>
  como(identidad).post(`/documentos/${documentoId}/aplicaciones`).send({ itemIds });

const reemplazar = (
  identidad: IdentidadDePrueba,
  itemId: string,
  documentoId: string,
  aplicacionVigenteId: string,
) =>
  como(identidad)
    .post(`${rutaDeItem(itemId)}/reemplazo`)
    .send({ documentoId, aplicacionVigenteId });

/** Carga un archivo por la API con la sesión de `identidad`. */
async function cargar(
  identidad: IdentidadDePrueba,
  contenido: Buffer,
  nombre: string,
  contentType: string,
): Promise<string> {
  const res = await como(identidad)
    .post('/documentos')
    .field({ tipoDocumentoId: e.print, anio: String(PERIODO.anio), mes: String(PERIODO.mes) })
    .attach('archivo', contenido, { filename: nombre, contentType });
  expect(res.status).toBe(201);
  const resultado = ResultadoCargaDocumentoSchema.parse(res.body);
  expect(resultado.posiblesDuplicados).toEqual([]);
  return resultado.documento.id;
}

/** Contenido único y reconocible: así cada carga es otro documento y los bytes se distinguen. */
const contenidoDe = (cabecera: Buffer, etiqueta: string) =>
  Buffer.concat([cabecera, Buffer.from(`\n% ${MARCA} ${etiqueta}\n`, 'latin1'), randomBytes(32)]);

const sha256 = (datos: Buffer) => createHash('sha256').update(datos).digest('hex');

async function leer(contenido: Readable): Promise<Buffer> {
  const partes: Buffer[] = [];
  for await (const parte of contenido) partes.push(Buffer.from(parte as Uint8Array));
  return Buffer.concat(partes);
}

/** Los bytes que tiene el almacenamiento para un documento (por la clave registrada en la base). */
async function guardadoDe(documentoId: string): Promise<Buffer> {
  const { claveAlmacenamiento } = await prisma.documento.findUniqueOrThrow({
    where: { id: documentoId },
    select: { claveAlmacenamiento: true },
  });
  return leer((await almacenamiento.obtener(exigirClaveValida(claveAlmacenamiento))).contenido);
}

/** 403 por permiso, sin datos del recurso y sin caché. */
function esperarDenegado(res: request.Response, motivo = 'PERMISO_INSUFICIENTE') {
  expect(res.status).toBe(403);
  expect(res.body).toEqual({
    error: {
      code: 'FORBIDDEN',
      message: expect.any(String) as string,
      details: { motivo },
    },
  });
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['content-disposition']).toBeUndefined();
}

async function vigenteDe(itemChecklistId: string): Promise<string> {
  const vigentes = await prisma.aplicacionDocumento.findMany({
    where: { itemChecklistId, reemplazadaEn: null },
    select: { id: true },
  });
  expect(vigentes).toHaveLength(1);
  return vigentes[0]?.id ?? '';
}

// ─── Escenario ────────────────────────────────────────────────────────────────
//
// Un cliente con Print x3 y una rendición del período (ítems i1, i2, i3). ADMINISTRATIVO carga dA
// (PDF) y lo aplica a i1, y carga dB (PNG) sin aplicar. Esa es la base de A a D. Después E
// reemplaza dA por dB en i1, y F (ADMINISTRADOR) carga dC, lo aplica a i2 y lo reemplaza por dD.

const e = {} as {
  print: string;
  cliente: string;
  rendicion: string;
  i1: string;
  i2: string;
  i3: string;
  dA: string;
  dB: string;
  contenidoA: Buffer;
  contenidoB: Buffer;
};

describe.skipIf(url === undefined)('permisos de documentos contra PostgreSQL (HU4.4)', () => {
  beforeAll(async () => {
    const nombreTipo = `${MARCA} Print`;
    const print = await prisma.tipoDocumento.create({
      data: { nombre: nombreTipo, nombreNormalizado: normalizar(nombreTipo) },
    });
    const cliente = await prisma.cliente.create({
      data: {
        razonSocial: `${MARCA} cliente`,
        denominacion: `${MARCA} cliente`,
        cuit: cuitDePrueba(),
        ivaCondicion: 'EXENTO',
        emailContacto: 'documentos@ejemplo.example',
        sector: 'PRIVADO',
        canalEntrega: 'CORREO',
        emisor: 'SOCIEDAD',
        matrizConfigurada: true,
      },
    });
    clientesCreados.push(cliente.id);
    await prisma.requisitoCliente.create({
      data: { clienteId: cliente.id, tipoDocumentoId: print.id, cantidad: 3 },
    });

    const abierta = await como('ADMINISTRATIVO')
      .post(`/clientes/${cliente.id}/rendiciones`)
      .send({ ...PERIODO, numeroFactura: facturaDePrueba() });
    expect(abierta.status).toBe(201);
    const { id: rendicion, items } = RendicionDetalleSchema.parse(abierta.body);
    const item = (ordinal: number) => {
      const encontrado = items.find((i) => i.tipoDocumentoId === print.id && i.ordinal === ordinal);
      if (encontrado === undefined) throw new Error('El escenario no tiene ese ítem.');
      return encontrado.id;
    };
    Object.assign(e, {
      print: print.id,
      cliente: cliente.id,
      rendicion,
      i1: item(1),
      i2: item(2),
      i3: item(3),
      contenidoA: contenidoDe(PDF, 'A'),
      contenidoB: contenidoDe(PNG, 'B'),
    });

    e.dA = await cargar('ADMINISTRATIVO', e.contenidoA, 'Constancia año.pdf', 'application/pdf');
    e.dB = await cargar('ADMINISTRATIVO', e.contenidoB, 'Constancia B.png', 'image/png');
    expect((await aplicar('ADMINISTRATIVO', e.dA, [e.i1])).status).toBe(200);
  });

  it(`la conexión real es la base de TEST_DATABASE_URL (${BASE_DE_LA_URL})`, () => {
    expect(baseEnUso).toBe(BASE_DE_LA_URL);
  });

  // ─── A ──────────────────────────────────────────────────────────────────────

  describe('A — sin sesión', () => {
    it('listado, detalle, descarga e historial: 401 sin metadatos ni bytes, sin leer el almacenamiento', async () => {
      const obtener = vi.spyOn(almacenamiento, 'obtener');
      const rutas = [
        `/documentos?anio=${PERIODO.anio}&mes=${PERIODO.mes}`,
        `/documentos/${e.dA}`,
        `/documentos/${e.dA}/archivo`,
        `${rutaDeItem(e.i1)}/aplicaciones`,
      ];

      for (const cliente of sinSesion()) {
        for (const ruta of rutas) {
          const res = await cliente.get(ruta).buffer(true);

          expect(res.status, ruta).toBe(401);
          expect(res.body).toMatchObject({ error: { details: { motivo: 'SESION_REQUERIDA' } } });
          expect(res.headers['content-type']).toMatch(/^application\/json/);
          expect(res.headers['content-disposition']).toBeUndefined();
          expect(res.headers['cache-control']).toBe('no-store');
          const cuerpo = JSON.stringify(res.body);
          expect(cuerpo).not.toContain('Constancia');
          expect(cuerpo).not.toContain(MARCA);
          expect(cuerpo).not.toContain(e.i1);
        }
      }
      expect(obtener).not.toHaveBeenCalled();
    });
  });

  // ─── B ──────────────────────────────────────────────────────────────────────

  describe('B — CONSULTA lee y descarga', () => {
    it('consulta el repositorio del período, con las aplicaciones vigentes', async () => {
      const res = await repositorio('CONSULTA');

      expect(res.status).toBe(200);
      const documentos = DocumentoResumenSchema.array().parse(res.body);
      expect(documentos.map((d) => d.id).sort()).toEqual([e.dA, e.dB].sort());
      expect(documentos.find((d) => d.id === e.dA)).toMatchObject({
        nombreOriginal: 'Constancia año.pdf',
        tipoContenido: 'application/pdf',
        tamanioBytes: e.contenidoA.length,
        tipoDocumento: { id: e.print, nombre: `${MARCA} Print` },
        ...PERIODO,
        aplicacionesVigentes: 1,
      });
      expect(documentos.find((d) => d.id === e.dB)).toMatchObject({ aplicacionesVigentes: 0 });
    });

    it('consulta el detalle del documento y dónde está aplicado', async () => {
      const res = await como('CONSULTA').get(`/documentos/${e.dA}`);

      expect(res.status).toBe(200);
      const documento = DocumentoConAplicacionesSchema.parse(res.body);
      expect(documento.aplicaciones).toHaveLength(1);
      expect(documento.aplicaciones[0]).toMatchObject({
        documentoId: e.dA,
        itemChecklistId: e.i1,
        estado: 'VIGENTE',
        reemplazadaEn: null,
        ubicacion: {
          cliente: { id: e.cliente },
          rendicion: { id: e.rendicion, vigencia: 'ACTIVA' },
          item: { id: e.i1, ordinal: 1, totalOrdinal: 3 },
        },
      });
    });

    it('consulta el historial de aplicaciones del ítem', async () => {
      const res = await como('CONSULTA').get(`${rutaDeItem(e.i1)}/aplicaciones`);

      expect(res.status).toBe(200);
      const historial = HistorialDeItemSchema.parse(res.body);
      expect(historial.itemChecklistId).toBe(e.i1);
      expect(historial.aplicaciones).toHaveLength(1);
      expect(historial.aplicaciones[0]).toMatchObject({
        estado: 'VIGENTE',
        documento: { id: e.dA, nombreOriginal: 'Constancia año.pdf' },
      });
    });

    it('descarga los bytes reales: idénticos a los cargados y a los del almacenamiento', async () => {
      const res = await descargar('CONSULTA', e.dA);

      expect(res.status).toBe(200);
      const recibido = res.body as Buffer;
      expect(Buffer.compare(recibido, e.contenidoA)).toBe(0);
      expect(Buffer.compare(recibido, await guardadoDe(e.dA))).toBe(0);
      // Y el hash que la base registró al cargarlo (que nunca sale por la API).
      const { sha256: registrado } = await prisma.documento.findUniqueOrThrow({
        where: { id: e.dA },
        select: { sha256: true },
      });
      expect(sha256(recibido)).toBe(registrado);
      expect(res.headers).toMatchObject({
        'content-type': 'application/pdf',
        'content-length': String(e.contenidoA.length),
        'content-disposition': `attachment; filename="Constancia ano.pdf"; filename*=UTF-8''Constancia%20a%C3%B1o.pdf`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      });
    });

    it('ninguna respuesta expone la clave del almacenamiento, el hash ni credenciales', async () => {
      const { claveAlmacenamiento, sha256: hash } = await prisma.documento.findUniqueOrThrow({
        where: { id: e.dA },
        select: { claveAlmacenamiento: true, sha256: true },
      });
      const respuestas = [
        await repositorio('CONSULTA'),
        await como('CONSULTA').get(`/documentos/${e.dA}`),
        await como('CONSULTA').get(`${rutaDeItem(e.i1)}/aplicaciones`),
        await como('CONSULTA').get(`/rendiciones/${e.rendicion}`),
      ];
      const descarga = await descargar('CONSULTA', e.dA);

      for (const res of respuestas) {
        expect(res.status).toBe(200);
        const texto = JSON.stringify(res.body) + JSON.stringify(res.headers);
        expect(texto).not.toContain(claveAlmacenamiento);
        expect(texto).not.toContain(hash);
        expect(texto).not.toMatch(/claveAlmacenamiento|sha256|documentos\/[0-9a-f]{8}-/);
        expect(texto).not.toMatch(/S3_|accessKey|secret|amazonaws|supabase/i);
      }
      const cabeceras = JSON.stringify(descarga.headers);
      expect(cabeceras).not.toContain(claveAlmacenamiento);
      expect(cabeceras).not.toMatch(/amazonaws|supabase|x-amz-/i);
    });
  });

  // ─── C y D ──────────────────────────────────────────────────────────────────

  describe('C y D — CONSULTA no modifica nada, aunque pida directo a la API', () => {
    /**
     * Todo lo que un intento podría haber cambiado: las filas del escenario (documentos,
     * aplicaciones, ítems, rendición con su historial de estados), lo que la API muestra (detalle de
     * la rendición, con su avance, y el repositorio con sus contadores) y el almacenamiento (cuántos
     * objetos y el hash de cada uno). Compara registros precisos, no que la base esté vacía.
     */
    async function foto() {
      const deLaMarca = { tipoDocumento: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } } };
      const documentos = await prisma.documento.findMany({
        where: deLaMarca,
        orderBy: { id: 'asc' },
      });
      return {
        documentos,
        aplicaciones: await prisma.aplicacionDocumento.findMany({
          where: { documento: deLaMarca },
          orderBy: { id: 'asc' },
        }),
        items: await prisma.itemChecklist.findMany({
          where: { rendicionId: e.rendicion },
          orderBy: { id: 'asc' },
        }),
        rendicion: await prisma.rendicion.findUniqueOrThrow({
          where: { id: e.rendicion },
          include: { historial: { orderBy: { id: 'asc' } } },
        }),
        detalle: (await como('ADMINISTRATIVO').get(`/rendiciones/${e.rendicion}`)).body as unknown,
        repositorio: (await repositorio('ADMINISTRATIVO')).body as unknown,
        objetos: almacenamiento.cantidad,
        almacenado: await Promise.all(
          documentos.map(async (d) => [d.id, sha256(await guardadoDe(d.id))]),
        ),
      };
    }

    let antes: Awaited<ReturnType<typeof foto>>;

    beforeAll(async () => {
      antes = await foto();
      // El escenario es el que se espera: si no, la comparación de D no probaría nada.
      expect(antes.documentos).toHaveLength(2);
      expect(antes.aplicaciones).toHaveLength(1);
      expect(antes.items.filter((i) => i.completado).map((i) => i.id)).toEqual([e.i1]);
      expect(antes.objetos).toBe(2);
    });

    it('cargar: 403 antes de multer (un multipart roto tampoco llega a leerse) y nada se guarda', async () => {
      const guardar = vi.spyOn(almacenamiento, 'guardar');

      const valido = await como('CONSULTA')
        .post('/documentos')
        .field({ tipoDocumentoId: e.print, anio: String(PERIODO.anio), mes: String(PERIODO.mes) })
        .attach('archivo', contenidoDe(PDF, 'intruso'), {
          filename: 'intruso.pdf',
          contentType: 'application/pdf',
        });
      // Si multer lo leyera, respondería 400 "formulario mal formado".
      const roto = await como('CONSULTA')
        .post('/documentos')
        .set('Content-Type', 'multipart/form-data; boundary=limite')
        .send(
          ['--limite', 'Content-Disposition: form-data; name="archivo"', '', 'bas'].join('\r\n'),
        );

      esperarDenegado(valido);
      esperarDenegado(roto);
      expect(guardar).not.toHaveBeenCalled();
    });

    it('candidatos: 403 (es un GET, pero prepara una operación)', async () => {
      esperarDenegado(await como('CONSULTA').get(`/documentos/${e.dB}/candidatos`));
    });

    it('aplicar a un ítem pendiente: 403', async () => {
      esperarDenegado(await aplicar('CONSULTA', e.dB, [e.i2]));
    });

    it('reemplazar el documento vigente, con la aplicación vigente real: 403', async () => {
      esperarDenegado(await reemplazar('CONSULTA', e.i1, e.dB, await vigenteDe(e.i1)));
    });

    it('D — después de los intentos, la base, la API y el almacenamiento quedan iguales', async () => {
      expect(await foto()).toEqual(antes);
    });
  });

  // ─── E ──────────────────────────────────────────────────────────────────────

  describe('E — ADMINISTRATIVO conserva sus operaciones', () => {
    // La carga y la aplicación ya pasaron en la preparación; la carga, los candidatos, aplicar y
    // reemplazar en detalle (reglas, carreras, historial) están en documentos.integration y
    // aplicaciones.integration, que también corren con sesión de ADMINISTRATIVO.
    it('pide candidatos, reemplaza el vigente, ve el historial y descarga', async () => {
      const candidatos = await como('ADMINISTRATIVO').get(`/documentos/${e.dB}/candidatos`);
      expect(candidatos.status).toBe(200);
      const ids = CandidatoAplicacionSchema.array()
        .parse(candidatos.body)
        .map((c) => c.item.id);
      expect(ids).toEqual(expect.arrayContaining([e.i2, e.i3]));
      expect(ids).not.toContain(e.i1);

      const anterior = await vigenteDe(e.i1);
      const reemplazo = await reemplazar('ADMINISTRATIVO', e.i1, e.dB, anterior);
      expect(reemplazo.status).toBe(200);
      const detalle = RendicionDetalleSchema.parse(reemplazo.body);
      expect(detalle.items.find((i) => i.id === e.i1)?.documento).toMatchObject({
        documentoId: e.dB,
      });

      const historial = HistorialDeItemSchema.parse(
        (await como('ADMINISTRATIVO').get(`${rutaDeItem(e.i1)}/aplicaciones`)).body,
      );
      expect(historial.aplicaciones.map((a) => [a.documento.id, a.estado])).toEqual([
        [e.dB, 'VIGENTE'],
        [e.dA, 'REEMPLAZADA'],
      ]);
      expect(historial.aplicaciones[0]?.reemplazaAId).toBe(anterior);

      const descarga = await descargar('ADMINISTRATIVO', e.dB);
      expect(descarga.status).toBe(200);
      expect(descarga.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(descarga.body as Buffer, e.contenidoB)).toBe(0);
    });
  });

  // ─── F ──────────────────────────────────────────────────────────────────────

  describe('F — ADMINISTRADOR, recorrido completo', () => {
    it('carga, pide candidatos, aplica, consulta, descarga, reemplaza y ve el historial', async () => {
      // 1. Cargar.
      const contenidoC = contenidoDe(PDF, 'C');
      const dC = await cargar('ADMINISTRADOR', contenidoC, 'Constancia C.pdf', 'application/pdf');

      // 2. Candidatos: los dos ítems pendientes (i1 ya tiene documento).
      const candidatos = await como('ADMINISTRADOR').get(`/documentos/${dC}/candidatos`);
      expect(candidatos.status).toBe(200);
      const elegibles = CandidatoAplicacionSchema.array().parse(candidatos.body);
      expect(elegibles.map((c) => c.item.id).sort()).toEqual([e.i2, e.i3].sort());
      expect(elegibles.every((c) => c.elegibilidad === 'ELEGIBLE')).toBe(true);

      // 3. Aplicar a i2.
      const aplicado = await aplicar('ADMINISTRADOR', dC, [e.i2]);
      expect(aplicado.status).toBe(200);
      expect(
        DocumentoConAplicacionesSchema.parse(aplicado.body).aplicaciones.map((a) => [
          a.itemChecklistId,
          a.estado,
        ]),
      ).toEqual([[e.i2, 'VIGENTE']]);

      // 4. El documento y el historial del ítem.
      const documento = await como('ADMINISTRADOR').get(`/documentos/${dC}`);
      expect(documento.status).toBe(200);
      expect(DocumentoConAplicacionesSchema.parse(documento.body).aplicaciones).toHaveLength(1);
      const historial = await como('ADMINISTRADOR').get(`${rutaDeItem(e.i2)}/aplicaciones`);
      expect(historial.status).toBe(200);
      const [vigente] = HistorialDeItemSchema.parse(historial.body).aplicaciones;
      expect(vigente).toMatchObject({ estado: 'VIGENTE', documento: { id: dC } });

      // 5. Descargar.
      const descarga = await descargar('ADMINISTRADOR', dC);
      expect(descarga.status).toBe(200);
      expect(Buffer.compare(descarga.body as Buffer, contenidoC)).toBe(0);

      // 6. Reemplazar por otro compatible (mismo tipo y período), con la aplicación que mostró la API.
      const contenidoD = contenidoDe(PDF, 'D');
      const dD = await cargar('ADMINISTRADOR', contenidoD, 'Constancia D.pdf', 'application/pdf');
      const reemplazo = await reemplazar('ADMINISTRADOR', e.i2, dD, vigente?.id ?? '');
      expect(reemplazo.status).toBe(200);
      const detalle = RendicionDetalleSchema.parse(reemplazo.body);
      expect(detalle.items.find((i) => i.id === e.i2)?.documento).toMatchObject({
        documentoId: dD,
        nombreOriginal: 'Constancia D.pdf',
      });

      // 7. Historial y vigente después del reemplazo.
      const despues = HistorialDeItemSchema.parse(
        (await como('ADMINISTRADOR').get(`${rutaDeItem(e.i2)}/aplicaciones`)).body,
      );
      expect(despues.aplicaciones.map((a) => [a.documento.id, a.estado])).toEqual([
        [dD, 'VIGENTE'],
        [dC, 'REEMPLAZADA'],
      ]);
      expect(despues.aplicaciones[0]?.reemplazaAId).toBe(vigente?.id);
      const anteriorAhora = DocumentoConAplicacionesSchema.parse(
        (await como('ADMINISTRADOR').get(`/documentos/${dC}`)).body,
      );
      expect(anteriorAhora.aplicaciones.map((a) => a.estado)).toEqual(['REEMPLAZADA']);
      const resumen = DocumentoResumenSchema.array().parse(
        (await repositorio('ADMINISTRADOR')).body,
      );
      expect(resumen.find((d) => d.id === dD)?.aplicacionesVigentes).toBe(1);
      expect(resumen.find((d) => d.id === dC)?.aplicacionesVigentes).toBe(0);
    });
  });

  // ─── G ──────────────────────────────────────────────────────────────────────

  describe('G — sin regresiones', () => {
    it('con la contraseña temporal pendiente no lee ni carga documentos, y el almacenamiento no se toca', async () => {
      const obtener = vi.spyOn(almacenamiento, 'obtener');
      const guardar = vi.spyOn(almacenamiento, 'guardar');
      const pendiente = como('CAMBIO_PENDIENTE');

      const pedidos = [
        await pendiente.get(`/documentos?anio=${PERIODO.anio}&mes=${PERIODO.mes}`),
        await pendiente.get(`/documentos/${e.dA}`),
        await pendiente.get(`/documentos/${e.dA}/archivo`),
        await pendiente.get(`${rutaDeItem(e.i1)}/aplicaciones`),
        await pendiente
          .post('/documentos')
          .field({ tipoDocumentoId: e.print, anio: String(PERIODO.anio), mes: String(PERIODO.mes) })
          .attach('archivo', contenidoDe(PDF, 'pendiente'), {
            filename: 'pendiente.pdf',
            contentType: 'application/pdf',
          }),
      ];

      for (const res of pedidos) esperarDenegado(res, 'CAMBIO_DE_PASSWORD_REQUERIDO');
      expect(obtener).not.toHaveBeenCalled();
      expect(guardar).not.toHaveBeenCalled();
    });

    it('al final, lo que hicieron los roles operativos quedó coherente en la base y el almacenamiento', async () => {
      const items = await prisma.itemChecklist.findMany({
        where: { rendicionId: e.rendicion },
        include: { aplicaciones: { where: { reemplazadaEn: null } } },
      });
      const porItem = new Map(items.map((i) => [i.id, i]));
      // i1 (E) e i2 (F) tienen un documento vigente; i3 sigue pendiente.
      for (const [id, completo] of [
        [e.i1, true],
        [e.i2, true],
        [e.i3, false],
      ] as const) {
        const fila = porItem.get(id);
        expect(fila?.completado).toBe(completo);
        expect(fila?.completadoAt !== null).toBe(completo);
        expect(fila?.aplicaciones).toHaveLength(completo ? 1 : 0);
      }

      // Cuatro documentos (dA, dB de ADMINISTRATIVO; dC, dD de ADMINISTRADOR), cada uno con su
      // objeto, y nada más: ningún intento denegado dejó un objeto.
      const documentos = await prisma.documento.findMany({
        where: { tipoDocumento: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } } },
        select: { id: true, sha256: true },
      });
      expect(documentos).toHaveLength(4);
      expect(almacenamiento.cantidad).toBe(4);
      for (const documento of documentos) {
        expect(sha256(await guardadoDe(documento.id))).toBe(documento.sha256);
      }
    });
  });
});
