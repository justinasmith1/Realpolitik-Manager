// Responsable de los cambios de estado (HU4.6, ADR-0006) contra PostgreSQL REAL. Los escenarios
// del CA15, con sesiones reales (cookie, validación contra la base, autorización):
// 1. el alta registra a quien abrió la rendición, con origen MANUAL
// 2. un cambio manual registra la sesión, aunque el cuerpo diga otro responsable
// 3. la vuelta automática a En curso registra a quien sumó el requisito, con origen AUTOMATICO
// 4. pedir el mismo estado no agrega historial
// 5. una transición inválida no agrega historial
// 6. CONSULTA no cambia el estado ni registra nada; sin sesión, ni cambia ni lee
// 7. una entrada anterior a HU4.6 se lee sin responsable (y la base no acepta uno a medias)
// 8. renombrar, cambiar el rol o desactivar la cuenta no pierde la autoría; borrarla, la base no lo
//    permite (FK RESTRICT)
// y que una falla en medio del cambio no deja el estado sin su entrada (ni al revés).
//
// Para llegar a un estado sin cargar documentos se usa el punto único del service
// (`registrarCambioDeEstado`), como las otras suites; la transición que se verifica va por la API.
//
// Sin `TEST_DATABASE_URL` se saltan, y se niegan a correr si la base no es `*_audit` o `*_test`.
// Antes de escribir nada (cuentas, sesiones, rendiciones), `exigirBaseDePrueba` confirma con
// `current_database()` que la conexión real de `lib/prisma` es esa misma base y ese servidor: un
// `lib/prisma` que hubiera tomado la base del `.env` frena la suite sin escribir.

import { randomBytes, randomInt, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { mesActual, normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sesionesDePrueba } from '../../auth/__tests__/sesionReal';
import { clienteConCabeceras, ORIGEN_DE_PRUEBA } from '../../auth/__tests__/sesionSimulada';
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';
import { conectarBaseDePrueba } from '../../clientes/__tests__/baseVerificada';
import type * as Servicio from '../rendiciones.service';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let prismaInicializado = false;
let app: Express;
let registrarCambioDeEstado: typeof Servicio.registrarCambioDeEstado;
const clientesCreados: string[] = [];

const MARCA = `TESTRESP${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);
const PERIODO = mesActual();

/** Cuentas y sesiones reales de este archivo (ADMINISTRATIVO por defecto). */
const sesiones = sesionesDePrueba();
const porLaOperadora = () => ({ registradoPorId: sesiones.idDe(), origen: 'MANUAL' as const });

beforeAll(async () => {
  if (url === undefined) return;
  // Fija DATABASE_URL, importa `lib/prisma` y verifica su conexión real (`exigirBaseDePrueba`), la
  // misma que usan las cuentas, el servicio y la app. Si falla, la desconecta y lanza: no se crea
  // nada y el `afterAll` tampoco escribe (`prismaInicializado` sigue false).
  prisma = await conectarBaseDePrueba(url);
  prismaInicializado = true;
  await sesiones.preparar();
  ({ registrarCambioDeEstado } = await import('../rendiciones.service'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: [ORIGEN_DE_PRUEBA] });
});

afterAll(async () => {
  if (url === undefined || !prismaInicializado) return;
  try {
    // El historial cae en cascada con la rendición. Va antes que las cuentas: la FK del
    // responsable es RESTRICT.
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

const cuitDePrueba = () => `33-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;

// El número de factura es único por emisor entre todas las rendiciones activas: un punto de venta
// propio y una base al azar evitan chocar con otros datos de prueba.
const BASE_FACTURA = randomInt(1e7);
let secuencia = 0;
const facturaUnica = () =>
  `C 00046-${String(BASE_FACTURA + ++secuencia)
    .padStart(8, '0')
    .slice(-8)}`;

async function tipoDeDocumento(sufijo: string) {
  const nombre = `${MARCA} ${sufijo}`;
  return prisma.tipoDocumento.upsert({
    where: { nombreNormalizado: normalizar(nombre) },
    update: {},
    create: { nombre, nombreNormalizado: normalizar(nombre) },
  });
}

async function clienteConMatriz() {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'responsable@ejemplo.example',
      sector: 'PRIVADO',
      canalEntrega: 'CORREO',
      emisor: 'SOCIEDAD',
    },
  });
  clientesCreados.push(cliente.id);
  const tipo = await tipoDeDocumento('Factura');
  await prisma.requisitoCliente.create({
    data: { clienteId: cliente.id, tipoDocumentoId: tipo.id, cantidad: 1, diasAproximados: [] },
  });
  return cliente;
}

interface PasoJson {
  estadoAnterior: string | null;
  estadoNuevo: string;
  motivo?: string | null;
  registradoPor: { id: string; nombre: string } | null;
  origen: string | null;
}
interface RendicionJson {
  id: string;
  estado: string;
  historial: PasoJson[];
}

async function abrir(clienteId: string): Promise<RendicionJson> {
  const res = await sesiones
    .cliente(app)
    .post(`/clientes/${clienteId}/rendiciones`)
    .send({ ...PERIODO, numeroFactura: facturaUnica() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as RendicionJson;
}

const detalle = async (id: string) =>
  (await sesiones.cliente(app).get(`/rendiciones/${id}`)).body as RendicionJson;

const entradas = (rendicionId: string) =>
  prisma.historialEstadoRendicion.count({ where: { rendicionId } });

describe.skipIf(url === undefined)(
  'Responsable de los cambios de estado (HU4.6) contra PostgreSQL real',
  () => {
    it('1. el alta registra a quien abrió la rendición, con origen MANUAL', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);

      expect(abierta.historial).toEqual([
        expect.objectContaining({
          estadoAnterior: null,
          estadoNuevo: 'EN_CURSO',
          registradoPor: { id: sesiones.idDe(), nombre: 'Prueba ADMINISTRATIVO' },
          origen: 'MANUAL',
        }),
      ]);
      const [fila] = await prisma.historialEstadoRendicion.findMany({
        where: { rendicionId: abierta.id },
      });
      expect(fila).toMatchObject({ registradoPorId: sesiones.idDe(), origen: 'MANUAL' });
    });

    it('2. un cambio manual registra la sesión, aunque el cuerpo diga otro responsable', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      await registrarCambioDeEstado(abierta.id, 'COMPLETA', porLaOperadora());

      const res = await sesiones
        .cliente(app, 'ADMINISTRADOR')
        .patch(`/rendiciones/${abierta.id}/estado`)
        .send({
          estado: 'EN_CURSO',
          registradoPorId: sesiones.idDe('CONSULTA'),
          origen: 'AUTOMATICO',
        });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ultima = (res.body as RendicionJson).historial.at(-1);
      expect(ultima).toMatchObject({
        estadoAnterior: 'COMPLETA',
        estadoNuevo: 'EN_CURSO',
        registradoPor: { id: sesiones.idDe('ADMINISTRADOR'), nombre: 'Prueba ADMINISTRADOR' },
        origen: 'MANUAL',
      });
      const filas = await prisma.historialEstadoRendicion.findMany({
        where: { rendicionId: abierta.id, estadoAnterior: 'COMPLETA' },
      });
      expect(filas).toEqual([
        expect.objectContaining({
          registradoPorId: sesiones.idDe('ADMINISTRADOR'),
          origen: 'MANUAL',
        }),
      ]);
    });

    it('3. la vuelta automática registra a quien sumó el requisito, con origen AUTOMATICO', async () => {
      const cliente = await clienteConMatriz();
      const abierta = await abrir(cliente.id);
      await registrarCambioDeEstado(abierta.id, 'COMPLETA', porLaOperadora());
      const otroTipo = await tipoDeDocumento('Constancia');
      const requisito = await prisma.requisitoCliente.create({
        data: {
          clienteId: cliente.id,
          tipoDocumentoId: otroTipo.id,
          cantidad: 1,
          diasAproximados: [],
        },
      });

      const res = await sesiones
        .cliente(app, 'ADMINISTRADOR')
        .post(`/rendiciones/${abierta.id}/requisitos/${requisito.id}`);

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body as RendicionJson).historial.at(-1)).toEqual(
        expect.objectContaining({
          estadoAnterior: 'COMPLETA',
          estadoNuevo: 'EN_CURSO',
          motivo: 'Revertida a En curso al agregar requisito',
          registradoPor: { id: sesiones.idDe('ADMINISTRADOR'), nombre: 'Prueba ADMINISTRADOR' },
          origen: 'AUTOMATICO',
        }),
      );
      // Sumar otro requisito a la que ya está En curso no agrega una vuelta más.
      const antes = await entradas(abierta.id);
      const tercerTipo = await tipoDeDocumento('Remito');
      const otro = await prisma.requisitoCliente.create({
        data: {
          clienteId: cliente.id,
          tipoDocumentoId: tercerTipo.id,
          cantidad: 1,
          diasAproximados: [],
        },
      });
      const segunda = await sesiones
        .cliente(app)
        .post(`/rendiciones/${abierta.id}/requisitos/${otro.id}`);
      expect(segunda.status).toBe(200);
      expect(await entradas(abierta.id)).toBe(antes);
    });

    it('4. pedir el mismo estado responde igual, sin agregar historial', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      await registrarCambioDeEstado(abierta.id, 'COMPLETA', porLaOperadora());
      const antes = await entradas(abierta.id);

      const res = await sesiones
        .cliente(app, 'ADMINISTRADOR')
        .patch(`/rendiciones/${abierta.id}/estado`)
        .send({ estado: 'COMPLETA' });

      expect(res.status).toBe(200);
      expect(await entradas(abierta.id)).toBe(antes);
    });

    it('5. una transición inválida responde 409 y no agrega historial', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      const antes = await entradas(abierta.id);

      const res = await sesiones
        .cliente(app)
        .patch(`/rendiciones/${abierta.id}/estado`)
        .send({ estado: 'APROBADA' });

      expect(res.status).toBe(409);
      expect(await entradas(abierta.id)).toBe(antes);
      expect((await detalle(abierta.id)).estado).toBe('EN_CURSO');
    });

    it('6. CONSULTA no cambia el estado ni registra nada; sin sesión no cambia ni lee', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      await registrarCambioDeEstado(abierta.id, 'COMPLETA', porLaOperadora());
      const antes = await entradas(abierta.id);

      const consulta = await sesiones
        .cliente(app, 'CONSULTA')
        .patch(`/rendiciones/${abierta.id}/estado`)
        .send({ estado: 'EN_CURSO' });
      const sinSesion = clienteConCabeceras(app, { Origin: ORIGEN_DE_PRUEBA });
      const cambioSinSesion = await sinSesion
        .patch(`/rendiciones/${abierta.id}/estado`)
        .send({ estado: 'EN_CURSO', registradoPorId: sesiones.idDe() });
      const lecturaSinSesion = await sinSesion.get(`/rendiciones/${abierta.id}`);

      expect(consulta.status).toBe(403);
      expect(cambioSinSesion.status).toBe(401);
      expect(lecturaSinSesion.status).toBe(401);
      expect(await entradas(abierta.id)).toBe(antes);
      expect((await detalle(abierta.id)).estado).toBe('COMPLETA');
      // CONSULTA sí ve quién hizo cada cambio (CA7).
      const vista = (await sesiones.cliente(app, 'CONSULTA').get(`/rendiciones/${abierta.id}`))
        .body as RendicionJson;
      expect(vista.historial.map((paso) => paso.registradoPor?.id)).toEqual([
        sesiones.idDe(),
        sesiones.idDe(),
      ]);
    });

    it('7. una entrada anterior a HU4.6 se lee sin responsable, y la base no acepta uno a medias', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      // Como quedó el historial existente después de la migración: los dos en NULL.
      await prisma.historialEstadoRendicion.create({
        data: {
          rendicionId: abierta.id,
          estadoAnterior: 'EN_CURSO',
          estadoNuevo: 'COMPLETA',
          fecha: new Date(Date.now() + 1000),
        },
      });

      const vista = (await sesiones.cliente(app, 'CONSULTA').get(`/rendiciones/${abierta.id}`))
        .body as RendicionJson;

      expect(vista.historial.at(-1)).toMatchObject({
        estadoNuevo: 'COMPLETA',
        registradoPor: null,
        origen: null,
      });
      // CHECK ck_historial_responsable_con_origen: responsable sin origen (o al revés), no.
      await expect(
        prisma.historialEstadoRendicion.create({
          data: {
            rendicionId: abierta.id,
            estadoNuevo: 'EN_CURSO',
            registradoPorId: sesiones.idDe(),
          },
        }),
      ).rejects.toThrow(/ck_historial_responsable_con_origen/);
      await expect(
        prisma.historialEstadoRendicion.create({
          data: { rendicionId: abierta.id, estadoNuevo: 'EN_CURSO', origen: 'MANUAL' },
        }),
      ).rejects.toThrow(/ck_historial_responsable_con_origen/);
    });

    it('8. renombrar, cambiar el rol o desactivar la cuenta no pierde la autoría; borrarla, no se puede', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      // Un cambio en nombre de la cuenta de este archivo que nadie más usa para pedir.
      const cuenta = sesiones.idDe('CAMBIO_PENDIENTE');
      await registrarCambioDeEstado(abierta.id, 'COMPLETA', {
        registradoPorId: cuenta,
        origen: 'MANUAL',
      });

      await prisma.usuario.update({
        where: { id: cuenta },
        data: { nombre: 'Nombre corregido', rol: 'CONSULTA', activo: false },
      });

      const vista = await detalle(abierta.id);
      expect(vista.historial.at(-1)).toMatchObject({
        estadoNuevo: 'COMPLETA',
        registradoPor: { id: cuenta, nombre: 'Nombre corregido' },
        origen: 'MANUAL',
      });
      await expect(prisma.usuario.delete({ where: { id: cuenta } })).rejects.toMatchObject({
        code: 'P2003',
      });
      expect(await prisma.usuario.count({ where: { id: cuenta } })).toBe(1);
    });

    it('una falla en medio del cambio no deja el estado sin su entrada: se revierte todo', async () => {
      const abierta = await abrir((await clienteConMatriz()).id);
      const antes = await entradas(abierta.id);

      // Un responsable que no existe: la FK rechaza la entrada y la transacción se revierte entera.
      await expect(
        registrarCambioDeEstado(abierta.id, 'COMPLETA', {
          registradoPorId: randomUUID(),
          origen: 'MANUAL',
        }),
      ).rejects.toBeDefined();

      expect(await entradas(abierta.id)).toBe(antes);
      expect((await detalle(abierta.id)).estado).toBe('EN_CURSO');
    });
  },
);
