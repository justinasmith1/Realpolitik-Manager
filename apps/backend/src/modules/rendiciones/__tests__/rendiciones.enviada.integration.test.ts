// Marcar una rendición como Enviada (HU3.7, ADR-0005 punto 10) y la deuda de la HU3.6 contra
// PostgreSQL REAL, con sesión real:
// - COMPLETA → ENVIADA con la fecha de envío (por defecto, hoy en Buenos Aires) como fecha efectiva
//   del historial; "Enviada dd/mm" del listado del mes con la fecha elegida
// - fecha futura o anterior al período: 400, sin escribir
// - desde EN_CURSO, RECHAZADA o una anulada: 409
// - una Enviada no se modifica: aplicar o reemplazar un documento, corregir o propagar el canal y
//   sumar un requisito responden 409 RENDICION_ENVIADA; la OC sí se edita
// - una Enviada deja de estar atrasada
// - auto-revert (HU3.6): sumar un requisito a una Completa la vuelve a En curso con su motivo; si
//   la inserción falla, sigue Completa y sin historial nuevo
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import {
  hoyEnBuenosAires,
  inicioDelDiaEnBuenosAires,
  mesActual,
  mesesAPeriodo,
  normalizarNombreTipoDocumento as normalizar,
  periodoAMeses,
  primerDiaDelPeriodo,
  ResultadoCargaDocumentoSchema,
  type Periodo,
} from '@realpolitik/shared';
import type { Express } from 'express';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sesionesDePrueba } from '../../auth/__tests__/sesionReal';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { PDF } from '../../documentos/__tests__/archivosDePrueba';
import type * as Servicio from '../rendiciones.service';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
let registrarCambioDeEstado: typeof Servicio.registrarCambioDeEstado;
const clientesCreados: string[] = [];

const MARCA = `TESTENV${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

const PERIODO = mesActual();
/** Tres meses atrás: atrasada mientras no se envíe (HU3.4). */
const PERIODO_ATRASADO = mesesAPeriodo(periodoAMeses(PERIODO) - 3);

/** CUIT único. La base no valida el dígito verificador. El prefijo 37 no lo usa otra suite. */
const cuitDePrueba = () => `37-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
const BASE_FACTURA = randomInt(1e7);
let secuencia = 0;
const facturaUnica = () =>
  `C 00037-${String(BASE_FACTURA + ++secuencia)
    .padStart(8, '0')
    .slice(-8)}`;

/** Cuentas y sesiones reales de este archivo (ADMINISTRATIVO por defecto). */
const sesiones = sesionesDePrueba();

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  await sesiones.preparar();
  ({ prisma } = await import('../../../lib/prisma'));
  ({ registrarCambioDeEstado } = await import('../rendiciones.service'));
  const { createApp } = await import('../../../app');
  const { AlmacenamientoEnMemoria } = await import('../../../lib/almacenamiento/memoria');
  app = createApp({
    corsOrigins: ['http://localhost:5173'],
    documentos: { almacenamiento: new AlmacenamientoEnMemoria() },
  });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    const deLaMarca = { tipoDocumento: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } } };
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

// ─── Datos ────────────────────────────────────────────────────────────────────

async function crearTipo(nombre: string) {
  const completo = `${MARCA} ${nombre}`;
  return prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(completo) },
    update: {},
    create: { nombre: completo, nombreNormalizado: normalizar(completo) },
  });
}

/** Un cliente con un requisito (Factura x1) y otro tipo listo para sumar después (Print). */
async function clienteConMatriz() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'enviada@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      emisor: 'SOCIEDAD',
    },
  });
  clientesCreados.push(cliente.id);
  const factura = await crearTipo('Factura');
  const requisito = await prisma.requisitoCliente.create({
    data: { clienteId: cliente.id, tipoDocumentoId: factura.id, cantidad: 1, diasAproximados: [] },
  });
  return { cliente, factura, requisito };
}

interface HistorialJson {
  estadoAnterior: string | null;
  estadoNuevo: string;
  fecha: string;
  fechaEfectiva: string | null;
}
interface RendicionJson {
  id: string;
  estado: string;
  items: { id: string; documento: { aplicacionId: string } | null }[];
  historial: HistorialJson[];
}

async function abrir(clienteId: string, periodo: Periodo = PERIODO): Promise<RendicionJson> {
  const res = await sesiones
    .cliente(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...periodo, numeroFactura: facturaUnica() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as RendicionJson;
}

async function cargar(tipoDocumentoId: string, periodo: Periodo = PERIODO): Promise<string> {
  const res = await sesiones
    .cliente(app)
    .post('/documentos')
    .field({ tipoDocumentoId, anio: String(periodo.anio), mes: String(periodo.mes) })
    .attach('archivo', Buffer.concat([PDF, randomBytes(16)]), {
      filename: 'documento.pdf',
      contentType: 'application/pdf',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ResultadoCargaDocumentoSchema.parse(res.body).documento.id;
}

const cambiarEstado = (id: string, cuerpo: Record<string, unknown>) =>
  sesiones.cliente(app).patch(`/rendiciones/${id}/estado`).send(cuerpo);

const detalle = async (id: string) =>
  (await sesiones.cliente(app).get(`/rendiciones/${id}`)).body as RendicionJson;

const conflicto = (res: request.Response) =>
  (res.body as { error: { details: { motivo: string } & Record<string, unknown> } }).error.details;

const historialDe = (rendicionId: string) =>
  prisma.historialEstadoRendicion.findMany({
    where: { rendicionId },
    orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
  });

/** Una rendición Completa: su único ítem con un documento aplicado y marcada como completa. */
async function completa(periodo: Periodo = PERIODO) {
  const datos = await clienteConMatriz();
  const rendicion = await abrir(datos.cliente.id, periodo);
  const [item] = rendicion.items;
  const documentoId = await cargar(datos.factura.id, periodo);
  const aplicada = await sesiones
    .cliente(app)
    .post(`/documentos/${documentoId}/aplicaciones`)
    .send({ itemIds: [item?.id] });
  expect(aplicada.status, JSON.stringify(aplicada.body)).toBe(200);
  const marcada = await cambiarEstado(rendicion.id, { estado: 'COMPLETA' });
  expect(marcada.status, JSON.stringify(marcada.body)).toBe(200);
  return { ...datos, rendicion, itemId: item?.id ?? '', documentoId };
}

// ─── HU3.7 ────────────────────────────────────────────────────────────────────

describe.skipIf(url === undefined)('Marcar como Enviada (HU3.7) contra PostgreSQL real', () => {
  it('COMPLETA → ENVIADA sin fecha: hoy en Buenos Aires como fecha efectiva', async () => {
    const { rendicion } = await completa();

    const res = await cambiarEstado(rendicion.id, { estado: 'ENVIADA' });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const enviada = res.body as RendicionJson;
    expect(enviada.estado).toBe('ENVIADA');
    expect(enviada.historial.at(-1)).toMatchObject({
      estadoAnterior: 'COMPLETA',
      estadoNuevo: 'ENVIADA',
      fechaEfectiva: hoyEnBuenosAires(),
    });
    // Las demás entradas no tienen fecha efectiva.
    expect(enviada.historial.slice(0, -1).map((h) => h.fechaEfectiva)).toEqual([null, null]);
  });

  it('COMPLETA → ENVIADA con una fecha pasada: se guarda y el listado muestra esa fecha', async () => {
    const { rendicion } = await completa();
    const fechaEnvio = primerDiaDelPeriodo(PERIODO);

    const res = await cambiarEstado(rendicion.id, { estado: 'ENVIADA', fechaEnvio });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [, , entrada] = await historialDe(rendicion.id);
    expect(entrada?.fechaEfectiva?.toISOString().slice(0, 10)).toBe(fechaEnvio);
    // `fecha` sigue siendo el registro (ahora): ordena el historial.
    expect(Date.now() - (entrada?.fecha.getTime() ?? 0)).toBeLessThan(60_000);

    const delMes = await sesiones
      .cliente(app)
      .get(`/rendiciones?anio=${PERIODO.anio}&mes=${PERIODO.mes}`);
    const fila = (delMes.body as { id: string; ultimoPaso: unknown }[]).find(
      (r) => r.id === rendicion.id,
    );
    expect(fila?.ultimoPaso).toEqual({
      estado: 'ENVIADA',
      fecha: inicioDelDiaEnBuenosAires(fechaEnvio).toISOString(),
    });
  });

  it('fecha anterior al primer día del período o futura: 400 en fechaEnvio, sin escribir', async () => {
    const { rendicion } = await completa();
    const anterior = mesesAPeriodo(periodoAMeses(PERIODO) - 1);
    const antes = await historialDe(rendicion.id);

    const vieja = await cambiarEstado(rendicion.id, {
      estado: 'ENVIADA',
      fechaEnvio: `${primerDiaDelPeriodo(anterior).slice(0, 8)}28`,
    });
    const futura = await cambiarEstado(rendicion.id, {
      estado: 'ENVIADA',
      fechaEnvio: '2999-01-01',
    });

    for (const res of [vieja, futura]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: [{ campo: 'fechaEnvio' }] },
      });
    }
    expect((await detalle(rendicion.id)).estado).toBe('COMPLETA');
    expect(await historialDe(rendicion.id)).toHaveLength(antes.length);
  });

  it('fechaEnvio con otro estado: 400', async () => {
    const { rendicion } = await completa();

    const res = await cambiarEstado(rendicion.id, {
      estado: 'EN_CURSO',
      fechaEnvio: hoyEnBuenosAires(),
    });

    expect(res.status).toBe(400);
    expect((await detalle(rendicion.id)).estado).toBe('COMPLETA');
  });

  it('desde EN_CURSO o RECHAZADA: 409 TRANSICION_INVALIDA; una anulada: 409 RENDICION_ANULADA', async () => {
    const { cliente } = await clienteConMatriz();
    const enCurso = await abrir(cliente.id);
    const rechazada = await abrir(cliente.id);
    await registrarCambioDeEstado(rechazada.id, 'RECHAZADA');
    const { rendicion: anulada } = await completa();
    await sesiones
      .cliente(app)
      .patch(`/rendiciones/${anulada.id}/vigencia`)
      .send({ vigencia: 'ANULADA' });

    const desdeEnCurso = await cambiarEstado(enCurso.id, { estado: 'ENVIADA' });
    const desdeRechazada = await cambiarEstado(rechazada.id, { estado: 'ENVIADA' });
    const deAnulada = await cambiarEstado(anulada.id, { estado: 'ENVIADA' });

    expect(desdeEnCurso.status).toBe(409);
    expect(conflicto(desdeEnCurso)).toMatchObject({
      motivo: 'TRANSICION_INVALIDA',
      estadoActual: 'EN_CURSO',
    });
    expect(desdeRechazada.status).toBe(409);
    expect(conflicto(desdeRechazada)).toMatchObject({
      motivo: 'TRANSICION_INVALIDA',
      estadoActual: 'RECHAZADA',
    });
    expect(deAnulada.status).toBe(409);
    expect(conflicto(deAnulada)).toEqual({ motivo: 'RENDICION_ANULADA' });
  });

  it('una Enviada no se modifica: documentos, canales y requisitos dan 409 RENDICION_ENVIADA', async () => {
    const { cliente, factura, requisito, rendicion, itemId } = await completa();
    const otroDocumento = await cargar(factura.id);
    const print = await crearTipo('Print');
    const requisitoNuevo = await prisma.requisitoCliente.create({
      data: { clienteId: cliente.id, tipoDocumentoId: print.id, cantidad: 1, diasAproximados: [] },
    });
    expect((await cambiarEstado(rendicion.id, { estado: 'ENVIADA' })).status).toBe(200);
    const vigente = (await detalle(rendicion.id)).items[0]?.documento?.aplicacionId;
    const api = sesiones.cliente(app);

    const intentos = {
      aplicar: await api
        .post(`/documentos/${otroDocumento}/aplicaciones`)
        .send({ itemIds: [itemId] }),
      reemplazar: await api
        .post(`/rendiciones/${rendicion.id}/items/${itemId}/reemplazo`)
        .send({ documentoId: otroDocumento, aplicacionVigenteId: vigente }),
      canal: await api
        .patch(`/rendiciones/${rendicion.id}/items/${itemId}/canal`)
        .send({ canalEntrega: 'WHATSAPP' }),
      propagar: await api
        .post(`/clientes/${cliente.id}/requisitos/${requisito.id}/propagar-canal`)
        .send({ rendicionIds: [rendicion.id] }),
      sumarRequisito: await api.post(
        `/rendiciones/${rendicion.id}/requisitos/${requisitoNuevo.id}`,
      ),
    };

    for (const [nombre, res] of Object.entries(intentos)) {
      expect(res.status, `${nombre}: ${JSON.stringify(res.body)}`).toBe(409);
      expect(conflicto(res).motivo, nombre).toBe('RENDICION_ENVIADA');
    }
    expect(conflicto(intentos.propagar)).toEqual({
      motivo: 'RENDICION_ENVIADA',
      rendicionId: rendicion.id,
    });
    const despues = await detalle(rendicion.id);
    expect(despues.estado).toBe('ENVIADA');
    expect(despues.items).toHaveLength(1);
    expect(despues.items[0]?.documento?.aplicacionId).toBe(vigente);

    // La OC sí se edita: es un dato administrativo, no parte de lo que se mandó.
    const oc = await api.patch(`/rendiciones/${rendicion.id}`).send({ numeroOc: 'OC-123' });
    expect(oc.status, JSON.stringify(oc.body)).toBe(200);
  });

  // integración: corre Agus
  it('una Aprobada tampoco se modifica (HU3.8): aplicar un documento da 409 RENDICION_ENVIADA', async () => {
    const { factura, rendicion, itemId } = await completa();
    const otroDocumento = await cargar(factura.id);
    expect((await cambiarEstado(rendicion.id, { estado: 'ENVIADA' })).status).toBe(200);
    expect((await cambiarEstado(rendicion.id, { estado: 'APROBADA' })).status).toBe(200);

    const res = await sesiones
      .cliente(app)
      .post(`/documentos/${otroDocumento}/aplicaciones`)
      .send({ itemIds: [itemId] });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(conflicto(res).motivo).toBe('RENDICION_ENVIADA');
    expect((await detalle(rendicion.id)).estado).toBe('APROBADA');
  });

  it('una Enviada deja de estar atrasada', async () => {
    const { rendicion } = await completa(PERIODO_ATRASADO);
    const atrasadas = async () =>
      ((await sesiones.cliente(app).get('/rendiciones/atrasadas')).body as { id: string }[]).map(
        (r) => r.id,
      );
    expect(await atrasadas()).toContain(rendicion.id);

    const res = await cambiarEstado(rendicion.id, {
      estado: 'ENVIADA',
      fechaEnvio: primerDiaDelPeriodo(PERIODO_ATRASADO),
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await atrasadas()).not.toContain(rendicion.id);
    const delMes = await sesiones
      .cliente(app)
      .get(`/rendiciones?anio=${PERIODO_ATRASADO.anio}&mes=${PERIODO_ATRASADO.mes}`);
    const fila = (delMes.body as { id: string; atrasada: boolean }[]).find(
      (r) => r.id === rendicion.id,
    );
    expect(fila?.atrasada).toBe(false);
  });
});

// ─── Deuda de la HU3.6 ────────────────────────────────────────────────────────

describe.skipIf(url === undefined)('Auto-revert al sumar un requisito (HU3.6, deuda)', () => {
  it('sumar un requisito a una Completa la deja En curso, con su historial y el motivo', async () => {
    const { cliente, rendicion } = await completa();
    const print = await crearTipo('Print');
    const nuevo = await prisma.requisitoCliente.create({
      data: { clienteId: cliente.id, tipoDocumentoId: print.id, cantidad: 1, diasAproximados: [] },
    });

    const res = await sesiones
      .cliente(app)
      .post(`/rendiciones/${rendicion.id}/requisitos/${nuevo.id}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as RendicionJson).estado).toBe('EN_CURSO');
    const historial = await historialDe(rendicion.id);
    expect(historial.at(-1)).toMatchObject({
      estadoAnterior: 'COMPLETA',
      estadoNuevo: 'EN_CURSO',
      motivo: 'Revertida a En curso al agregar requisito',
    });
  });

  it('si la inserción del ítem falla, sigue Completa y sin historial nuevo', async () => {
    const { cliente, rendicion } = await completa();
    const roto = await crearTipo('Roto');
    const nuevo = await prisma.requisitoCliente.create({
      data: { clienteId: cliente.id, tipoDocumentoId: roto.id, cantidad: 1, diasAproximados: [] },
    });
    const antes = await historialDe(rendicion.id);
    // Un CHECK temporal que rechaza los ítems de ese tipo: la inserción falla dentro de la
    // transacción, después de que ya se decidió revertir. NOT VALID: no revisa las filas existentes.
    const restriccion = `ck_tmp_${MARCA.toLowerCase()}`;
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ItemChecklist" ADD CONSTRAINT "${restriccion}" CHECK ("tipoDocumentoId" <> '${roto.id}') NOT VALID`,
    );
    try {
      const res = await sesiones
        .cliente(app)
        .post(`/rendiciones/${rendicion.id}/requisitos/${nuevo.id}`);

      expect(res.status).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "ItemChecklist" DROP CONSTRAINT IF EXISTS "${restriccion}"`,
      );
    }
    const despues = await detalle(rendicion.id);
    expect(despues.estado).toBe('COMPLETA');
    expect(despues.items).toHaveLength(1);
    expect(await historialDe(rendicion.id)).toHaveLength(antes.length);
  });
});
