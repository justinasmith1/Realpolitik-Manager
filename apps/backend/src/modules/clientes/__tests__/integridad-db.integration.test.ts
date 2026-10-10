// Los CHECK de PostgreSQL (migración `integridad_cliente_contacto`) contra la base REAL.
//
// Escriben DIRECTO con Prisma, sin pasar por Express ni por shared: prueban la última línea de
// defensa, la que protege de scripts, Prisma Studio o SQL manual. Para cada regla: la variante
// válida se guarda y cada inválida es rechazada por PostgreSQL y NO queda en la base.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`) con las migraciones aplicadas.

import type { PeriodicidadTipo, Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { urlDeBaseDescartable } from './baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
const clientesCreados: string[] = [];

const MARCA = `TESTI${Date.now().toString(36).toUpperCase()}`;

beforeAll(async () => {
  if (url === undefined) return;
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
});

afterAll(async () => {
  if (url === undefined) return;
  // Los contactos se borran en cascada con su cliente.
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.$disconnect();
});

// La base no valida el dígito verificador: alcanza con un CUIT único (varchar(13), @unique).
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

/** Un cliente válido según TODOS los CHECK; cada test pisa lo que quiere romper. */
function cliente(extra: Partial<Prisma.ClienteCreateInput> = {}): Prisma.ClienteCreateInput {
  return {
    razonSocial: `${MARCA} integridad`,
    denominacion: `${MARCA}`,
    cuit: cuitUnico(),
    ivaCondicion: 'EXENTO',
    emailContacto: 'integridad@ejemplo.example',
    sector: 'PRIVADO',
    ...extra,
  };
}

/** Crea y registra para limpiar. Si la base lo rechaza, no hay nada que registrar. */
async function crear(datos: Prisma.ClienteCreateInput) {
  const fila = await prisma.cliente.create({ data: datos });
  clientesCreados.push(fila.id);
  return fila;
}

/**
 * Intenta crear `datos` y exige que PostgreSQL lo rechace por `constraint` y que la fila no
 * haya quedado guardada. El mensaje lo arma PostgreSQL ("violates check constraint …"): es más
 * estable que el código de error con que Prisma lo envuelve.
 */
async function esperarRechazo(datos: Prisma.ClienteCreateInput, constraint: string) {
  await expect(crear(datos)).rejects.toThrow(new RegExp(constraint));
  expect(await prisma.cliente.count({ where: { cuit: datos.cuit } })).toBe(0);
}

describe.skipIf(url === undefined)('CHECK de PostgreSQL en Cliente y Contacto', () => {
  describe('ck_cliente_sector_subtipo', () => {
    const CK = 'ck_cliente_sector_subtipo';

    it('PUBLICO con subtipo y PRIVADO sin subtipo se aceptan', async () => {
      await expect(
        crear(cliente({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' })),
      ).resolves.toBeDefined();
      await expect(crear(cliente({ sector: 'PRIVADO', subtipo: null }))).resolves.toBeDefined();
    });

    it('PUBLICO sin subtipo se rechaza', async () => {
      await esperarRechazo(cliente({ sector: 'PUBLICO', subtipo: null }), CK);
    });

    it('PRIVADO con subtipo se rechaza', async () => {
      await esperarRechazo(cliente({ sector: 'PRIVADO', subtipo: 'MUNICIPAL' }), CK);
    });

    it('un UPDATE que lo rompe también se rechaza y la fila queda como estaba', async () => {
      const fila = await crear(cliente({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' }));

      await expect(
        prisma.cliente.update({ where: { id: fila.id }, data: { subtipo: null } }),
      ).rejects.toThrow(new RegExp(CK));
      expect(await prisma.cliente.findUniqueOrThrow({ where: { id: fila.id } })).toEqual(fila);
    });
  });

  describe('ck_cliente_portal_requerido / ck_cliente_whatsapp_requerido', () => {
    it('cada canal con su dato se acepta', async () => {
      await expect(
        crear(cliente({ canalEntrega: 'PORTAL_WEB', portalUrl: 'https://portal.ejemplo.example' })),
      ).resolves.toBeDefined();
      await expect(
        crear(cliente({ canalEntrega: 'WHATSAPP', whatsappNumero: '+5493511234567' })),
      ).resolves.toBeDefined();
      await expect(crear(cliente({ canalEntrega: 'CORREO' }))).resolves.toBeDefined();
    });

    it('CORREO con una URL o un número guardados de antes se acepta (no se exige limpiarlos)', async () => {
      await expect(
        crear(
          cliente({
            canalEntrega: 'CORREO',
            portalUrl: 'https://historica.ejemplo.example',
            whatsappNumero: '+5493511234567',
          }),
        ),
      ).resolves.toBeDefined();
    });

    it.each([
      ['null', null],
      ['vacía', ''],
      ['solo espacios', '   '],
    ])('PORTAL_WEB con URL %s se rechaza', async (_caso, portalUrl) => {
      await esperarRechazo(
        cliente({ canalEntrega: 'PORTAL_WEB', portalUrl }),
        'ck_cliente_portal_requerido',
      );
    });

    it.each([
      ['null', null],
      ['vacío', ''],
      ['solo espacios', '   '],
    ])('WHATSAPP con número %s se rechaza', async (_caso, whatsappNumero) => {
      await esperarRechazo(
        cliente({ canalEntrega: 'WHATSAPP', whatsappNumero }),
        'ck_cliente_whatsapp_requerido',
      );
    });
  });

  describe('ck_cliente_periodicidad_coherente', () => {
    const CK = 'ck_cliente_periodicidad_coherente';
    type Periodicidad = Pick<
      Prisma.ClienteCreateInput,
      'periodicidadTipo' | 'periodicidadDiaLimite' | 'periodicidadMesInicioCiclo'
    >;
    const p = (
      periodicidadTipo: PeriodicidadTipo | null,
      periodicidadDiaLimite: number | null,
      periodicidadMesInicioCiclo: number | null,
    ): Periodicidad => ({ periodicidadTipo, periodicidadDiaLimite, periodicidadMesInicioCiclo });

    it.each([
      ['sin configurar', p(null, null, null)],
      ['MENSUAL día 1', p('MENSUAL', 1, null)],
      ['MENSUAL día 28', p('MENSUAL', 28, null)],
      ['POR_CAMPANIA día 15', p('POR_CAMPANIA', 15, null)],
      ['BIMESTRAL día 10, mes 1', p('BIMESTRAL', 10, 1)],
      ['BIMESTRAL día 28, mes 12', p('BIMESTRAL', 28, 12)],
    ])('acepta %s', async (_caso, periodicidad) => {
      await expect(crear(cliente(periodicidad))).resolves.toBeDefined();
    });

    it.each([
      ['tipo sin día', p('MENSUAL', null, null)],
      ['día sin tipo (con lógica de 3 valores daría NULL y pasaría)', p(null, 10, null)],
      ['mes sin tipo ni día', p(null, null, 3)],
      ['día y mes sin tipo', p(null, 10, 3)],
      ['día 0', p('MENSUAL', 0, null)],
      ['día 29', p('POR_CAMPANIA', 29, null)],
      ['día negativo', p('MENSUAL', -1, null)],
      ['BIMESTRAL sin mes', p('BIMESTRAL', 10, null)],
      ['BIMESTRAL sin día', p('BIMESTRAL', null, 3)],
      ['BIMESTRAL mes 0', p('BIMESTRAL', 10, 0)],
      ['BIMESTRAL mes 13', p('BIMESTRAL', 10, 13)],
      ['MENSUAL con mes', p('MENSUAL', 10, 3)],
      ['POR_CAMPANIA con mes', p('POR_CAMPANIA', 10, 6)],
    ])('rechaza %s', async (_caso, periodicidad) => {
      await esperarRechazo(cliente(periodicidad), CK);
    });
  });

  describe('ck_cliente_baja_logica', () => {
    const CK = 'ck_cliente_baja_logica';

    it('activo sin fecha y dado de baja con fecha se aceptan', async () => {
      await expect(crear(cliente({ isDeleted: false, deletedAt: null }))).resolves.toBeDefined();
      await expect(
        crear(cliente({ isDeleted: true, deletedAt: new Date() })),
      ).resolves.toBeDefined();
    });

    it('no dado de baja pero con fecha de baja se rechaza', async () => {
      await esperarRechazo(cliente({ isDeleted: false, deletedAt: new Date() }), CK);
    });

    it('dado de baja sin fecha se rechaza', async () => {
      await esperarRechazo(cliente({ isDeleted: true, deletedAt: null }), CK);
    });
  });

  describe('ck_contacto_baja_logica', () => {
    const CK = 'ck_contacto_baja_logica';
    let clienteId: string;
    let n = 0;

    beforeAll(async () => {
      if (url === undefined) return;
      clienteId = (await crear(cliente())).id;
    });

    const contacto = (extra: Partial<Prisma.ContactoUncheckedCreateInput>) => ({
      clienteId,
      nombre: 'Ana Pérez',
      area: 'Tesorería',
      email: `contacto${n++}@ejemplo.example`,
      ...extra,
    });

    async function esperarRechazoContacto(datos: Prisma.ContactoUncheckedCreateInput) {
      await expect(prisma.contacto.create({ data: datos })).rejects.toThrow(new RegExp(CK));
      expect(await prisma.contacto.count({ where: { clienteId, email: datos.email } })).toBe(0);
    }

    it('activo sin fecha y dado de baja con fecha se aceptan', async () => {
      await expect(
        prisma.contacto.create({ data: contacto({ isDeleted: false, deletedAt: null }) }),
      ).resolves.toBeDefined();
      await expect(
        prisma.contacto.create({ data: contacto({ isDeleted: true, deletedAt: new Date() }) }),
      ).resolves.toBeDefined();
    });

    it('no dado de baja pero con fecha se rechaza', async () => {
      await esperarRechazoContacto(contacto({ isDeleted: false, deletedAt: new Date() }));
    });

    it('dado de baja sin fecha se rechaza', async () => {
      await esperarRechazoContacto(contacto({ isDeleted: true, deletedAt: null }));
    });
  });
});
