// Tests de integración de los endpoints de tipos de documento (HU2.1) contra PostgreSQL REAL.
// Prueban lo que un mock no puede: que el índice único de `nombreNormalizado` decide los
// duplicados (también con altas simultáneas), que repetir el estado no escribe la fila (ni
// `updatedAt` ni `xmin` cambian), y que renombrar o desactivar un tipo no toca los requisitos ni
// los ítems de rendiciones que lo usan.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base DESCARTABLE (`*_audit` o `*_test`) con las migraciones aplicadas:
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/realpolitik_test?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run tipos-documento.integration
//
// No usan el seed. Cada test crea sus propios datos con una marca única y la limpieza final borra
// solo eso: ningún test depende de otro ni de los tipos reales del catálogo.

import { randomBytes, randomInt } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// La misma guarda de base descartable que usan todas las suites de integración (no se copia).
import { urlDeBaseDescartable } from '../../clientes/__tests__/baseDescartable';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
let app: Express;
const clientesCreados: string[] = [];

/** Marca única de esta corrida (hora + azar, solo ASCII): todos los nombres empiezan con ella. */
const MARCA = `TESTTD${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

/** Un nombre de prueba: la marca + un texto. */
const n = (texto: string) => `${MARCA} ${texto}`;

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
});

afterAll(async () => {
  if (url === undefined) return;
  // En el orden que piden las FK: rendiciones (sus ítems caen en cascada), requisitos, clientes
  // y, al final, los tipos de prueba.
  await prisma.rendicion.deleteMany({ where: { clienteId: { in: clientesCreados } } });
  await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.tipoDocumento.deleteMany({
    where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
  });
  await prisma.$disconnect();
});

interface TipoJson {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

interface ErrorJson {
  error: { code: string; message: string; details?: unknown };
}

/** Las claves exactas de un tipo en la API: ni `nombreNormalizado` ni nada de Prisma. */
const CAMPOS_DEL_CONTRATO = ['activo', 'actualizadoEn', 'creadoEn', 'descripcion', 'id', 'nombre'];

const listar = (query = '') => request(app).get(`/tipos-documento${query}`);
const alta = (body: object) => request(app).post('/tipos-documento').send(body);
const editar = (id: string, body: object) =>
  request(app).patch(`/tipos-documento/${id}`).send(body);
const cambiarEstado = (id: string, activo: boolean) =>
  request(app).patch(`/tipos-documento/${id}/estado`).send({ activo });

async function crearTipo(nombre: string): Promise<TipoJson> {
  const respuesta = await alta({ nombre });
  expect(respuesta.status).toBe(201);
  return respuesta.body as TipoJson;
}

/** Los tipos de la respuesta que son de estos ids, en el orden en que vinieron. */
const deEstos = (cuerpo: unknown, ...ids: string[]) =>
  (cuerpo as TipoJson[]).filter((tipo) => ids.includes(tipo.id));

/** El 409 esperado, con el tipo que ya tiene la clave. */
const conflictoCon = (existente: Pick<TipoJson, 'id' | 'nombre' | 'activo'>) => ({
  error: {
    code: 'CONFLICT',
    message: 'Ya existe un tipo de documento con ese nombre',
    details: {
      motivo: 'TIPO_DOCUMENTO_DUPLICADO',
      tipoDocumentoExistente: {
        id: existente.id,
        nombre: existente.nombre,
        activo: existente.activo,
      },
    },
  },
});

/** Cuántas filas tienen la clave de este nombre (el índice único dice que 0 o 1). */
const filasConClave = (nombre: string) =>
  prisma.tipoDocumento.count({ where: { nombreNormalizado: normalizar(nombre) } });

/**
 * `xmin` es el id de la transacción que escribió la versión actual de la fila: cambia con
 * cualquier UPDATE, aunque deje los mismos valores. Si no cambia, la fila no se escribió.
 */
async function versionDeLaFila(id: string): Promise<{ xmin: string; updatedAt: Date }> {
  const [fila] = await prisma.$queryRaw<{ xmin: string; updatedAt: Date }[]>`
    SELECT xmin::text AS xmin, "updatedAt" FROM "TipoDocumento" WHERE id = ${id}::uuid`;
  if (fila === undefined) throw new Error(`No existe la fila ${id}`);
  return fila;
}

/**
 * CUIT único para un cliente de prueba. La base no valida el dígito verificador. El prefijo 36
 * no lo usa ninguna otra suite (27, 33, 34, 35, 9X y 99 ya están tomados).
 */
function cuitDePrueba(): string {
  return `36-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
}

/**
 * Pone el tipo en uso con FK reales: un cliente con un requisito de ese tipo y una rendición
 * con un ítem que guarda su nombre de ese momento. Devuelve las filas tal como quedaron.
 */
async function usarEnRequisitoYRendicion(tipo: TipoJson) {
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: `${MARCA} cliente`,
      denominacion: MARCA,
      cuit: cuitDePrueba(),
      ivaCondicion: 'EXENTO',
      emailContacto: 'tipos@ejemplo.example',
      sector: 'PRIVADO',
    },
  });
  clientesCreados.push(cliente.id);
  const requisito = await prisma.requisitoCliente.create({
    data: { clienteId: cliente.id, tipoDocumentoId: tipo.id },
  });
  const rendicion = await prisma.rendicion.create({
    data: { clienteId: cliente.id, anio: 2026, mes: 10, numeroFactura: `${MARCA}-1` },
  });
  const item = await prisma.itemChecklist.create({
    data: {
      rendicionId: rendicion.id,
      requisitoClienteId: requisito.id,
      tipoDocumentoId: tipo.id,
      nombreTipoDocumento: tipo.nombre,
      ordinal: 1,
      totalOrdinal: 1,
      canalEntrega: 'CORREO',
    },
  });
  return { requisito, item };
}

/** El requisito y el ítem siguen exactamente como estaban (mismas columnas, mismo updatedAt). */
async function esperarSinCambios(usos: Awaited<ReturnType<typeof usarEnRequisitoYRendicion>>) {
  const requisito = await prisma.requisitoCliente.findUniqueOrThrow({
    where: { id: usos.requisito.id },
  });
  const item = await prisma.itemChecklist.findUniqueOrThrow({ where: { id: usos.item.id } });
  expect(requisito).toEqual(usos.requisito);
  expect(item).toEqual(usos.item);
}

describe.skipIf(url === undefined)('Tipos de documento contra PostgreSQL real', () => {
  describe('GET /tipos-documento', () => {
    it('por defecto solo activos; incluirInactivos=true suma los inactivos; false es el default', async () => {
      const activo = await crearTipo(n('Listado activo'));
      const inactivo = await crearTipo(n('Listado inactivo'));
      expect((await cambiarEstado(inactivo.id, false)).status).toBe(200);

      const porDefecto = await listar();
      const conFalse = await listar('?incluirInactivos=false');
      const todos = await listar('?incluirInactivos=true');

      const ids = (cuerpo: unknown) => deEstos(cuerpo, activo.id, inactivo.id).map((t) => t.id);
      expect(porDefecto.status).toBe(200);
      expect(ids(porDefecto.body)).toEqual([activo.id]);
      expect(ids(conFalse.body)).toEqual([activo.id]);
      expect(ids(todos.body).sort()).toEqual([activo.id, inactivo.id].sort());
    });

    it('ordena por la clave normalizada, sin importar mayúsculas ni acentos', async () => {
      // Insertados fuera de orden. Por clave: "… acido" < "… beta" < "… gama", en cualquier
      // collation (mismo prefijo y letras ASCII sin acento después de normalizar).
      const gama = await crearTipo(n('Gama'));
      const acido = await crearTipo(n('Ácido'));
      const beta = await crearTipo(n('beta'));

      const respuesta = await listar();

      expect(deEstos(respuesta.body, gama.id, acido.id, beta.id).map((t) => t.nombre)).toEqual([
        n('Ácido'),
        n('beta'),
        n('Gama'),
      ]);
    });

    it('cada tipo trae solo los campos del contrato, con fechas ISO', async () => {
      const tipo = await crearTipo(n('Campos del listado'));

      const [listado] = deEstos((await listar()).body, tipo.id);

      expect(Object.keys(listado ?? {}).sort()).toEqual(CAMPOS_DEL_CONTRATO);
      expect(listado?.creadoEn).toBe(new Date(listado?.creadoEn ?? '').toISOString());
    });

    it('responde 400 si incluirInactivos no es true ni false', async () => {
      const respuesta = await listar('?incluirInactivos=1');

      expect(respuesta.status).toBe(400);
      expect((respuesta.body as ErrorJson).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /tipos-documento', () => {
    it('crea un tipo activo y guarda la clave calculada por shared', async () => {
      const respuesta = await alta({ nombre: n('Constancía   Alta'), descripcion: 'Una' });

      expect(respuesta.status).toBe(201);
      const creado = respuesta.body as TipoJson;
      expect(Object.keys(creado).sort()).toEqual(CAMPOS_DEL_CONTRATO);
      expect(creado).toMatchObject({ nombre: n('Constancía   Alta'), descripcion: 'Una' });
      const fila = await prisma.tipoDocumento.findUniqueOrThrow({ where: { id: creado.id } });
      expect(fila).toMatchObject({
        nombre: n('Constancía   Alta'),
        nombreNormalizado: normalizar(n('Constancia Alta')),
        activo: true,
      });
      expect(creado.actualizadoEn).toBe(fila.updatedAt.toISOString());
    });

    it('rechaza nombres equivalentes con 409 y el tipo existente, sin crear otra fila', async () => {
      const existente = await crearTipo(n('Constancia ARCA'));

      for (const nombre of [
        n('constancia  arca'),
        n('CONSTANCÍA ARCA'),
        `  ${n('Constancia ARCA')}  `,
      ]) {
        const respuesta = await alta({ nombre });
        expect(respuesta.status).toBe(409);
        expect(respuesta.body).toEqual(conflictoCon(existente));
      }
      expect(await filasConClave(n('Constancia ARCA'))).toBe(1);
    });

    it('el conflicto informa el tipo existente aunque esté inactivo', async () => {
      const existente = await crearTipo(n('Duplicado inactivo'));
      await cambiarEstado(existente.id, false);

      const respuesta = await alta({ nombre: n('DUPLICADO INACTIVO') });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body).toEqual(conflictoCon({ ...existente, activo: false }));
    });

    it('la ñ no es una n: "Año" y "Ano" son tipos distintos', async () => {
      const conEnie = await crearTipo(n('Año'));
      const sinEnie = await crearTipo(n('Ano'));

      expect(conEnie.id).not.toBe(sinEnie.id);
      expect((await alta({ nombre: n('AÑO') })).status).toBe(409);
    });

    it('con altas simultáneas del mismo nombre, se crea una sola y las demás son 409', async () => {
      const variantes = [
        'Pago simultaneo',
        'PAGO SIMULTÁNEO',
        'pago  simultáneo',
        'Págo Simultaneo',
      ];

      const respuestas = await Promise.all(variantes.map((v) => alta({ nombre: n(v) })));

      const creadas = respuestas.filter((r) => r.status === 201);
      expect(creadas).toHaveLength(1);
      const creada = creadas[0]?.body as TipoJson;
      for (const rechazada of respuestas.filter((r) => r.status !== 201)) {
        expect(rechazada.status).toBe(409);
        expect(rechazada.body).toEqual(conflictoCon(creada));
      }
      expect(await filasConClave(n('Pago simultaneo'))).toBe(1);
    });

    it('responde 400 con datos inválidos y no crea nada', async () => {
      const respuesta = await alta({ nombre: n('x'.repeat(100)) });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(await filasConClave(n('x'.repeat(100)))).toBe(0);
    });
  });

  describe('PATCH /tipos-documento/:id', () => {
    it('cambia el nombre en el mismo tipo y libera la clave anterior', async () => {
      const tipo = await crearTipo(n('Nombre viejo'));

      const respuesta = await editar(tipo.id, { nombre: n('Nombre nuevo') });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ id: tipo.id, nombre: n('Nombre nuevo') });
      const fila = await prisma.tipoDocumento.findUniqueOrThrow({ where: { id: tipo.id } });
      expect(fila.nombreNormalizado).toBe(normalizar(n('Nombre nuevo')));
      // La clave vieja quedó libre: otro tipo puede usarla.
      expect((await alta({ nombre: n('Nombre viejo') })).status).toBe(201);
    });

    it('edita la descripción sin tocar el nombre, y null la borra', async () => {
      const tipo = await crearTipo(n('Con descripción'));

      const conDescripcion = await editar(tipo.id, { descripcion: 'Detalle' });
      const sinDescripcion = await editar(tipo.id, { descripcion: null });

      expect(conDescripcion.body).toMatchObject({ nombre: tipo.nombre, descripcion: 'Detalle' });
      expect(sinDescripcion.status).toBe(200);
      expect(sinDescripcion.body).toMatchObject({ nombre: tipo.nombre, descripcion: null });
    });

    it('edita un tipo inactivo y sigue inactivo', async () => {
      const tipo = await crearTipo(n('Inactivo editable'));
      await cambiarEstado(tipo.id, false);

      const respuesta = await editar(tipo.id, { nombre: n('Inactivo editado') });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ nombre: n('Inactivo editado'), activo: false });
    });

    it('cambiar solo mayúsculas o acentos del propio nombre está permitido', async () => {
      const tipo = await crearTipo(n('Factura propia'));

      const respuesta = await editar(tipo.id, { nombre: n('FACTÚRA PROPIA') });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ id: tipo.id, nombre: n('FACTÚRA PROPIA') });
      expect(await filasConClave(n('Factura propia'))).toBe(1);
    });

    it('un nombre equivalente al de otro tipo es 409 y no modifica la fila', async () => {
      const otro = await crearTipo(n('Ocupado'));
      const tipo = await crearTipo(n('Libre'));
      const antes = await versionDeLaFila(tipo.id);

      const respuesta = await editar(tipo.id, { nombre: n('OCUPADO') });

      expect(respuesta.status).toBe(409);
      expect(respuesta.body).toEqual(conflictoCon(otro));
      expect(await versionDeLaFila(tipo.id)).toEqual(antes);
    });

    it('responde 404 si el tipo no existe', async () => {
      const respuesta = await editar('00000000-0000-4000-8000-000000000000', { nombre: n('X') });

      expect(respuesta.status).toBe(404);
      expect(respuesta.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Tipo de documento no encontrado' },
      });
    });

    it('responde 400 a un pedido vacío', async () => {
      const tipo = await crearTipo(n('Pedido vacío'));

      expect((await editar(tipo.id, {})).status).toBe(400);
    });

    it('renombrar no toca requisitos ni ítems de rendiciones ya abiertas', async () => {
      const tipo = await crearTipo(n('Renombrable'));
      const usos = await usarEnRequisitoYRendicion(tipo);

      const respuesta = await editar(tipo.id, { nombre: n('Renombrado') });

      expect(respuesta.status).toBe(200);
      // El ítem conserva el nombre de cuando se abrió la rendición (snapshot, ADR-0003).
      await esperarSinCambios(usos);
      expect(usos.item.nombreTipoDocumento).toBe(n('Renombrable'));
    });
  });

  describe('PATCH /tipos-documento/:id/estado', () => {
    it('desactivar escribe solo activo y actualiza updatedAt', async () => {
      const tipo = await crearTipo(n('Desactivable'));
      const antes = await versionDeLaFila(tipo.id);

      const respuesta = await cambiarEstado(tipo.id, false);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({
        id: tipo.id,
        nombre: tipo.nombre,
        descripcion: tipo.descripcion,
        activo: false,
      });
      const despues = await versionDeLaFila(tipo.id);
      expect(despues.xmin).not.toBe(antes.xmin);
      expect(despues.updatedAt.getTime()).toBeGreaterThan(antes.updatedAt.getTime());
      expect((respuesta.body as TipoJson).actualizadoEn).toBe(despues.updatedAt.toISOString());
    });

    it('reactivar vuelve a activo', async () => {
      const tipo = await crearTipo(n('Reactivable'));
      await cambiarEstado(tipo.id, false);

      const respuesta = await cambiarEstado(tipo.id, true);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ id: tipo.id, activo: true });
    });

    it('repetir el estado que ya tiene responde 200 sin escribir la fila (updatedAt y xmin iguales)', async () => {
      const tipo = await crearTipo(n('Sin cambios'));
      const antes = await versionDeLaFila(tipo.id);

      const respuesta = await cambiarEstado(tipo.id, true);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual(tipo);
      expect(await versionDeLaFila(tipo.id)).toEqual(antes);
    });

    it('responde 404 si el tipo no existe', async () => {
      const respuesta = await cambiarEstado('00000000-0000-4000-8000-000000000000', false);

      expect(respuesta.status).toBe(404);
    });

    it('responde 400 si activo no es booleano', async () => {
      const tipo = await crearTipo(n('Estado inválido'));

      const respuesta = await request(app)
        .patch(`/tipos-documento/${tipo.id}/estado`)
        .send({ activo: 'no' });

      expect(respuesta.status).toBe(400);
      expect(respuesta.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });

    it('dos desactivaciones simultáneas: las dos responden inactivo y la fila se escribe una vez', async () => {
      const tipo = await crearTipo(n('Desactivación simultánea'));

      const [a, b] = await Promise.all([
        cambiarEstado(tipo.id, false),
        cambiarEstado(tipo.id, false),
      ]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const [cuerpoA, cuerpoB] = [a.body as TipoJson, b.body as TipoJson];
      expect(cuerpoA.activo).toBe(false);
      expect(cuerpoB.activo).toBe(false);
      // Una sola escritura: las dos respuestas muestran la misma versión, y es la guardada.
      expect(cuerpoA.actualizadoEn).toBe(cuerpoB.actualizadoEn);
      const guardada = await versionDeLaFila(tipo.id);
      expect(guardada.updatedAt.toISOString()).toBe(cuerpoA.actualizadoEn);
    });

    it('pedidos opuestos simultáneos: cada respuesta muestra el estado que pidió', async () => {
      const tipo = await crearTipo(n('Estados opuestos'));

      const respuestas = await Promise.all(
        [false, true, false, true].map((activo) =>
          cambiarEstado(tipo.id, activo).then((r) => ({ activo, r })),
        ),
      );

      for (const { activo, r } of respuestas) {
        expect(r.status).toBe(200);
        expect((r.body as TipoJson).activo).toBe(activo);
      }
    });

    it('desactivar un tipo en uso no toca su nombre, sus requisitos ni los ítems', async () => {
      const tipo = await crearTipo(n('En uso'));
      const usos = await usarEnRequisitoYRendicion(tipo);

      const respuesta = await cambiarEstado(tipo.id, false);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toMatchObject({ nombre: tipo.nombre, activo: false });
      await esperarSinCambios(usos);
    });
  });
});
