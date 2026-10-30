// Los índices únicos parciales de la factura (HU2.9, migración `hu2_9_emisor_rendicion`) contra la
// base REAL. Escriben DIRECTO con Prisma, sin pasar por Express ni por shared: prueban la última
// línea de defensa, la que protege de scripts, Prisma Studio o SQL manual.
//
//   uq_rendicion_emisor_factura_activa     (emisor, numeroFactura) entre las activas con emisor,
//                                          aunque sean de clientes distintos
//   uq_rendicion_factura_activa_sin_emisor (clienteId, numeroFactura) entre las activas sin emisor:
//                                          la regla anterior, para las rendiciones existentes
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`) con las migraciones aplicadas.

import type { Emisor, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let esFacturaDuplicada: (error: unknown) => boolean;
const clientesCreados: string[] = [];

const MARCA = `TESTX${Date.now().toString(36).toUpperCase()}`;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  ({ esFacturaDuplicada } = await import('../rendiciones.service'));
});

afterAll(async () => {
  if (url === undefined) return;
  // Una rendición protege a su cliente (`Restrict`): primero las rendiciones, con sus ítems.
  await prisma.rendicion.deleteMany({ where: { clienteId: { in: clientesCreados } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.$disconnect();
});

const cuitsUsados = new Set<string>();
function cuitUnico(): string {
  for (;;) {
    const cuit = `9${Math.floor(Math.random() * 10)}-${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}-${Math.floor(Math.random() * 10)}`;
    if (!cuitsUsados.has(cuit)) {
      cuitsUsados.add(cuit);
      return cuit;
    }
  }
}

async function crearCliente(): Promise<string> {
  const { id } = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} índices`,
      denominacion: MARCA,
      cuit: cuitUnico(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'indices@ejemplo.example',
      sector: 'PRIVADO',
    },
  });
  clientesCreados.push(id);
  return id;
}

/** Un número de factura distinto en cada test, para que no se pisen entre sí. */
let secuencia = 0;
const numeroNuevo = () => `B 00002-${String(++secuencia).padStart(8, '0')}`;

const rendicion = (clienteId: string, numeroFactura: string, emisor: Emisor | null) =>
  prisma.rendicion.create({
    data: { clienteId, anio: 2026, mes: 10, numeroFactura, emisor },
  });

/** El error de Prisma por un índice único (P2002) y, si no hubo error, `undefined`. */
async function errorDe(operacion: Promise<unknown>): Promise<unknown> {
  return operacion.then(
    () => undefined,
    (fallo: unknown) => fallo,
  );
}

/**
 * Verifica que el rechazo es un P2002 que el servicio reconoce como factura duplicada
 * (`esFacturaDuplicada`) y que Prisma informa las COLUMNAS del índice en `meta.target`: así lo
 * hizo al verificarlo contra PostgreSQL 16, para los dos índices. Si otra versión de Prisma
 * informara el nombre del índice, `esFacturaDuplicada` lo acepta igual y el último `expect`
 * avisa del cambio para revisarlo.
 */
function esRechazoPorIndice(error: unknown, columnas: string[]) {
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  expect(code, String(error)).toBe('P2002');
  expect(esFacturaDuplicada(error), JSON.stringify(meta)).toBe(true);
  expect(meta?.target).toEqual(columnas);
}

describe.skipIf(url === undefined)(
  'Índices de la factura por emisor contra PostgreSQL real',
  () => {
    describe('rendiciones con emisor: único por (emisor, número) entre todos los clientes', () => {
      it('el mismo número y el mismo emisor en el mismo cliente se rechaza', async () => {
        const cliente = await crearCliente();
        const numero = numeroNuevo();
        await rendicion(cliente, numero, 'SOCIEDAD');

        const error = await errorDe(rendicion(cliente, numero, 'SOCIEDAD'));

        esRechazoPorIndice(error, ['emisor', 'numeroFactura']);
      });

      it('el mismo número y el mismo emisor en OTRO cliente también se rechaza', async () => {
        const uno = await crearCliente();
        const otro = await crearCliente();
        const numero = numeroNuevo();
        await rendicion(uno, numero, 'PERSONA_FISICA');

        const error = await errorDe(rendicion(otro, numero, 'PERSONA_FISICA'));

        esRechazoPorIndice(error, ['emisor', 'numeroFactura']);
      });

      it('el mismo número con distinto emisor se acepta en el mismo cliente', async () => {
        const cliente = await crearCliente();
        const numero = numeroNuevo();
        await rendicion(cliente, numero, 'SOCIEDAD');

        await expect(rendicion(cliente, numero, 'PERSONA_FISICA')).resolves.toBeDefined();
      });

      it('el mismo número con distinto emisor se acepta en otro cliente', async () => {
        const uno = await crearCliente();
        const otro = await crearCliente();
        const numero = numeroNuevo();
        await rendicion(uno, numero, 'SOCIEDAD');

        await expect(rendicion(otro, numero, 'PERSONA_FISICA')).resolves.toBeDefined();
      });

      it('una rendición anulada libera el número, también para otro cliente', async () => {
        const uno = await crearCliente();
        const otro = await crearCliente();
        const numero = numeroNuevo();
        const primera = await rendicion(uno, numero, 'SOCIEDAD');
        await prisma.rendicion.update({
          where: { id: primera.id },
          data: { isDeleted: true, deletedAt: new Date() },
        });

        await expect(rendicion(otro, numero, 'SOCIEDAD')).resolves.toBeDefined();
      });

      it('dos anuladas con el mismo número y emisor no chocan entre sí', async () => {
        const cliente = await crearCliente();
        const numero = numeroNuevo();
        const baja = { isDeleted: true, deletedAt: new Date() };

        await prisma.rendicion.create({
          data: {
            clienteId: cliente,
            anio: 2026,
            mes: 10,
            numeroFactura: numero,
            emisor: 'SOCIEDAD',
            ...baja,
          },
        });
        await expect(
          prisma.rendicion.create({
            data: {
              clienteId: cliente,
              anio: 2026,
              mes: 11,
              numeroFactura: numero,
              emisor: 'SOCIEDAD',
              ...baja,
            },
          }),
        ).resolves.toBeDefined();
      });
    });

    describe('rendiciones sin emisor (las existentes): sigue valiendo único por cliente', () => {
      it('el mismo número en el mismo cliente se rechaza', async () => {
        const cliente = await crearCliente();
        const numero = numeroNuevo();
        await rendicion(cliente, numero, null);

        const error = await errorDe(rendicion(cliente, numero, null));

        esRechazoPorIndice(error, ['clienteId', 'numeroFactura']);
      });

      it('el mismo número en otro cliente se acepta, como antes', async () => {
        const uno = await crearCliente();
        const otro = await crearCliente();
        const numero = numeroNuevo();
        await rendicion(uno, numero, null);

        await expect(rendicion(otro, numero, null)).resolves.toBeDefined();
      });

      it('una anulada libera el número del cliente', async () => {
        const cliente = await crearCliente();
        const numero = numeroNuevo();
        const primera = await rendicion(cliente, numero, null);
        await prisma.rendicion.update({
          where: { id: primera.id },
          data: { isDeleted: true, deletedAt: new Date() },
        });

        await expect(rendicion(cliente, numero, null)).resolves.toBeDefined();
      });
    });

    it('el índice anterior ya no existe y los dos nuevos sí', async () => {
      const filas = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Rendicion' AND indexname LIKE 'uq_rendicion%'
      ORDER BY indexname`;

      expect(filas.map((fila) => fila.indexname)).toEqual([
        'uq_rendicion_emisor_factura_activa',
        'uq_rendicion_factura_activa_sin_emisor',
      ]);
    });
  },
);
