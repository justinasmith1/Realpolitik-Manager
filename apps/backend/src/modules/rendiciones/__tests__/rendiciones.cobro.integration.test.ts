// Integración del cobro informado por el cliente (HU3.10) contra PostgreSQL REAL:
// - `PUT` y `DELETE /rendiciones/:id/cobro`: alta, edición y quita de la marca
// - la columna `DATE` hace el viaje de ida y vuelta sin correr el día (Buenos Aires es UTC-3)
// - solo una Enviada o Aprobada se marca; una anulada no se toca; el cobro no toca el historial
// - rechazar una rendición con cobro es 409 COBRO_REGISTRADO, y sin cobro se puede
// - los CHECK `ck_rendicion_cobro_nota_con_fecha` y `ck_rendicion_cobro_nota_no_vacia` fallan con
//   su SQLSTATE (23514) y su nombre
//
// El estado se cambia con el punto único del service (`registrarCambioDeEstado`), que no valida
// transiciones: así cada caso arma la rendición en el estado que necesita.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.

import { randomBytes, randomInt } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sesionesDePrueba } from '../../auth/__tests__/sesionReal';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import type * as Servicio from '../rendiciones.service';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
let registrarCambioDeEstado: typeof Servicio.registrarCambioDeEstado;
const clientesCreados: string[] = [];

const MARCA = `TESTCOB${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

/** Cuentas y sesiones reales de este archivo (ADMINISTRATIVO por defecto). */
const sesiones = sesionesDePrueba();

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  await sesiones.preparar();
  ({ prisma } = await import('../../../lib/prisma'));
  ({ registrarCambioDeEstado } = await import('../rendiciones.service'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
  prismaInicializado = true;
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
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

const cuitDePrueba = () => `30-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

// La factura es única por emisor entre las activas: un punto de venta propio y una base al azar.
const BASE_FACTURA = randomInt(1e7);
let secuencia = 0;
const facturaUnica = () =>
  `B 00055-${String(BASE_FACTURA + ++secuencia)
    .padStart(8, '0')
    .slice(-8)}`;

async function crearCliente() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'cobro@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      emisor: 'SOCIEDAD',
    },
  });
  clientesCreados.push(cliente.id);
  const nombre = `${MARCA} Factura`;
  const tipo = await prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(nombre) },
    update: {},
    create: { nombre, nombreNormalizado: normalizar(nombre) },
  });
  await prisma.requisitoCliente.create({
    data: { clienteId: cliente.id, tipoDocumentoId: tipo.id, cantidad: 1, diasAproximados: [] },
  });
  return cliente;
}

/** Abre una rendición del cliente y la deja en `estado`. */
async function rendicionEn(estado: 'EN_CURSO' | 'ENVIADA' | 'APROBADA' | 'RECHAZADA') {
  const cliente = await crearCliente();
  const alta = await sesiones
    .cliente(app)
    .post(`/clientes/${cliente.id}/rendiciones`)
    .send({ anio: 2026, mes: 9, numeroFactura: facturaUnica() });
  expect(alta.status, JSON.stringify(alta.body)).toBe(201);
  const id = (alta.body as { id: string }).id;
  if (estado !== 'EN_CURSO') await registrarCambioDeEstado(id, estado);
  return id;
}

const registrar = (id: string, cuerpo: object) =>
  sesiones.cliente(app).put(`/rendiciones/${id}/cobro`).send(cuerpo);
const quitar = (id: string) => sesiones.cliente(app).delete(`/rendiciones/${id}/cobro`);
const detalle = (id: string) => sesiones.cliente(app).get(`/rendiciones/${id}`);

/** Una violación de CHECK escrita en SQL: SQLSTATE 23514 y el nombre de la constraint. */
async function violacionDeCheck(consulta: Promise<unknown>) {
  const error = await consulta.then(
    () => undefined,
    (fallo: unknown) => fallo,
  );
  expect(error, 'se esperaba que la base rechazara la escritura').toBeInstanceOf(
    Prisma.PrismaClientKnownRequestError,
  );
  const conocido = error as Prisma.PrismaClientKnownRequestError;
  expect(conocido.code).toBe('P2010');
  expect((conocido.meta as { code?: string }).code).toBe('23514');
  return JSON.stringify(conocido.meta);
}

describe.skipIf(url === undefined)(
  'Cobro informado por el cliente (HU3.10) contra PostgreSQL real',
  () => {
    // Fechas pasadas y fijas (no relativas a hoy) que cubren el borde de año: si la zona horaria corriera
    // el día, cambiarían de año.
    it.each(['2025-12-31', '2026-01-01'])(
      'la fecha %s hace el viaje de ida y vuelta sin correr el día',
      async (fecha) => {
        const id = await rendicionEn('ENVIADA');

        const guardado = await registrar(id, { fecha });
        expect(guardado.status, JSON.stringify(guardado.body)).toBe(200);
        expect(guardado.body).toMatchObject({ cobro: { fecha, nota: null } });

        // El día guardado en la columna DATE, leído como texto por la base...
        const [fila] = await prisma.$queryRaw<{ dia: string }[]>`
        SELECT "cobroFecha"::text AS dia FROM "Rendicion" WHERE id = ${id}::uuid`;
        expect(fila?.dia).toBe(fecha);
        // ...y como lo lee Prisma: la medianoche UTC de ese día.
        const leida = await prisma.rendicion.findUniqueOrThrow({ where: { id } });
        expect(leida.cobroFecha?.toISOString()).toBe(`${fecha}T00:00:00.000Z`);
        // ...y como lo devuelve el detalle.
        expect((await detalle(id)).body).toMatchObject({ cobro: { fecha } });
      },
    );

    it('registra, edita y quita el cobro, y no toca el historial ni el estado', async () => {
      const id = await rendicionEn('APROBADA');
      const antes = (await detalle(id)).body as { historial: unknown[]; estado: string };

      const alta = await registrar(id, { fecha: '2026-11-10', nota: 'Avisó por mail' });
      expect(alta.body).toMatchObject({ cobro: { fecha: '2026-11-10', nota: 'Avisó por mail' } });

      // Edita: reemplaza el cobro entero (sin nota, la nota queda en null).
      const edicion = await registrar(id, { fecha: '2026-11-11' });
      expect(edicion.body).toMatchObject({ cobro: { fecha: '2026-11-11', nota: null } });

      const quita = await quitar(id);
      expect(quita.status).toBe(200);
      expect(quita.body).toMatchObject({ cobro: null });
      const fila = await prisma.rendicion.findUniqueOrThrow({ where: { id } });
      expect(fila.cobroFecha).toBeNull();
      expect(fila.cobroNota).toBeNull();

      // Quitar sin cobro responde igual.
      expect((await quitar(id)).status).toBe(200);

      const despues = (await detalle(id)).body as { historial: unknown[]; estado: string };
      expect(despues.estado).toBe(antes.estado);
      expect(despues.historial).toEqual(antes.historial);
    });

    it.each(['EN_CURSO', 'RECHAZADA'] as const)(
      'una %s no se puede marcar: 409 COBRO_ESTADO_INVALIDO',
      async (estado) => {
        const id = await rendicionEn(estado);

        const res = await registrar(id, { fecha: '2026-11-10' });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          error: { details: { motivo: 'COBRO_ESTADO_INVALIDO', estadoActual: estado } },
        });
        const fila = await prisma.rendicion.findUniqueOrThrow({ where: { id } });
        expect(fila.cobroFecha).toBeNull();
      },
    );

    it('una anulada no se marca ni se desmarca, pero conserva el cobro que tenía', async () => {
      const id = await rendicionEn('ENVIADA');
      await registrar(id, { fecha: '2026-11-10', nota: 'Pagó' });
      const anulacion = await sesiones
        .cliente(app)
        .patch(`/rendiciones/${id}/vigencia`)
        .send({ vigencia: 'ANULADA' });
      expect(anulacion.status).toBe(200);

      for (const respuesta of [await registrar(id, { fecha: '2026-11-11' }), await quitar(id)]) {
        expect(respuesta.status).toBe(409);
        expect(respuesta.body).toMatchObject({
          error: { details: { motivo: 'RENDICION_ANULADA' } },
        });
      }
      expect((await detalle(id)).body).toMatchObject({
        vigencia: 'ANULADA',
        cobro: { fecha: '2026-11-10', nota: 'Pagó' },
      });
    });

    it('rechazar una Enviada con cobro es 409 COBRO_REGISTRADO; quitando la marca, se puede', async () => {
      const id = await rendicionEn('ENVIADA');
      await registrar(id, { fecha: '2026-11-10' });

      const bloqueado = await sesiones
        .cliente(app)
        .patch(`/rendiciones/${id}/estado`)
        .send({ estado: 'RECHAZADA', motivo: 'Faltó la firma' });
      expect(bloqueado.status).toBe(409);
      expect(bloqueado.body).toMatchObject({
        error: { details: { motivo: 'COBRO_REGISTRADO' } },
      });
      expect((await prisma.rendicion.findUniqueOrThrow({ where: { id } })).estado).toBe('ENVIADA');

      await quitar(id);
      const permitido = await sesiones
        .cliente(app)
        .patch(`/rendiciones/${id}/estado`)
        .send({ estado: 'RECHAZADA', motivo: 'Faltó la firma' });
      expect(permitido.status, JSON.stringify(permitido.body)).toBe(200);
      expect(permitido.body).toMatchObject({ estado: 'RECHAZADA', cobro: null });
    });

    it('aprobar una Enviada con cobro conserva el cobro', async () => {
      const id = await rendicionEn('ENVIADA');
      await registrar(id, { fecha: '2026-11-10', nota: 'Avisó' });

      const res = await sesiones
        .cliente(app)
        .patch(`/rendiciones/${id}/estado`)
        .send({ estado: 'APROBADA' });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        estado: 'APROBADA',
        cobro: { fecha: '2026-11-10', nota: 'Avisó' },
      });
    });

    describe('CHECK de la base, escritos en SQL por fuera de la app', () => {
      it('ck_rendicion_cobro_nota_con_fecha: una nota sin fecha falla con 23514', async () => {
        const id = await rendicionEn('ENVIADA');

        const meta = await violacionDeCheck(
          prisma.$executeRaw`UPDATE "Rendicion" SET "cobroNota" = 'sin fecha' WHERE id = ${id}::uuid`,
        );

        expect(meta).toContain('ck_rendicion_cobro_nota_con_fecha');
      });

      it('ck_rendicion_cobro_nota_no_vacia: una nota en blanco falla con 23514', async () => {
        const id = await rendicionEn('ENVIADA');

        const meta = await violacionDeCheck(
          prisma.$executeRaw`UPDATE "Rendicion" SET "cobroFecha" = DATE '2026-11-10', "cobroNota" = '   ' WHERE id = ${id}::uuid`,
        );

        expect(meta).toContain('ck_rendicion_cobro_nota_no_vacia');
      });

      it('una fecha sin nota, y una fecha con nota, son válidas', async () => {
        const id = await rendicionEn('ENVIADA');

        await prisma.$executeRaw`UPDATE "Rendicion" SET "cobroFecha" = DATE '2026-11-10' WHERE id = ${id}::uuid`;
        await prisma.$executeRaw`UPDATE "Rendicion" SET "cobroNota" = 'Pagó' WHERE id = ${id}::uuid`;

        const fila = await prisma.rendicion.findUniqueOrThrow({ where: { id } });
        expect(fila.cobroNota).toBe('Pagó');
      });
    });
  },
);
