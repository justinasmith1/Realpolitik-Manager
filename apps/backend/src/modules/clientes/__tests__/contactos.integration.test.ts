// Tests de integración de los contactos contra PostgreSQL REAL. Prueban lo que un mock no puede:
// que el guardado completo sea atómico, que el intercambio de emails respete el índice único
// parcial y que los errores de Prisma tengan la forma que el service espera.
//
// Son opcionales: sin `TEST_DATABASE_URL` se saltan (el CI no tiene base de datos). Para
// correrlos hace falta una base DESCARTABLE con las migraciones aplicadas, por ejemplo:
//
//   TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/realpolitik_audit?schema=public" \
//     pnpm --filter @realpolitik/backend exec vitest run contactos.integration
//
// Cada test crea sus propios clientes y los borra al final; no usa seed ni toca otros datos.
// Por seguridad, se niega a correr si la base no se llama `*_audit` o `*_test`.

import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/app-error';
import type * as ContactosService from '../contactos.service';

const url = process.env.TEST_DATABASE_URL;

function nombreDeLaBase(conexion: string): string {
  return new URL(conexion).pathname.replace(/^\//, '');
}

if (url !== undefined && !/_(audit|test)$/.test(nombreDeLaBase(url))) {
  throw new Error(
    `TEST_DATABASE_URL apunta a "${nombreDeLaBase(url)}": solo se permiten bases descartables (*_audit o *_test).`,
  );
}

let service: typeof ContactosService;
let prisma: PrismaClient;
let app: Express;
const clientesCreados: string[] = [];

beforeAll(async () => {
  if (url === undefined) return;
  // El cliente de Prisma lee DATABASE_URL al importarse: se fija antes.
  process.env.DATABASE_URL = url;
  ({ prisma } = await import('../../../lib/prisma'));
  service = await import('../contactos.service');
  const { createApp } = await import('../../../app');
  app = createApp({ corsOrigins: ['http://localhost:5173'] });
});

afterAll(async () => {
  if (url === undefined) return;
  // Los contactos caen en cascada con su cliente.
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.$disconnect();
});

async function crearCliente(extra: { isDeleted?: boolean } = {}): Promise<string> {
  const digitos = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const cliente = await prisma.cliente.create({
    data: {
      razonSocial: 'TEST integración contactos',
      denominacion: 'TEST contactos',
      cuit: `99-${digitos}-9`,
      ivaCondicion: 'EXENTO',
      emailContacto: 'test@ejemplo.example',
      sector: 'PRIVADO',
      estado: 'ACTIVO',
      ...(extra.isDeleted ? { isDeleted: true, deletedAt: new Date() } : {}),
    },
  });
  clientesCreados.push(cliente.id);
  return cliente.id;
}

const contacto = (nombre: string, email: string, extra: object = {}) => ({
  nombre,
  area: 'Tesorería',
  email,
  recibeRendiciones: false,
  ...extra,
});

/** Los contactos ACTIVOS de un cliente, como `{ nombre → email }`, para comparar fácil. */
async function activos(clienteId: string) {
  const filas = await prisma.contacto.findMany({
    where: { clienteId, isDeleted: false },
    orderBy: { nombre: 'asc' },
  });
  return filas;
}

const emailsPorNombre = (filas: { nombre: string; email: string }[]) =>
  Object.fromEntries(filas.map((fila) => [fila.nombre, fila.email]));

/** Atrapa el AppError que lanza el service. */
async function falla(promesa: Promise<unknown>): Promise<AppError> {
  const error = await promesa.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe.skipIf(url === undefined)('contactos contra PostgreSQL real', () => {
  it('guarda dos contactos nuevos y devuelve la colección ordenada', async () => {
    const cliente = await crearCliente();

    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [
        contacto('Zulema Ríos', 'zulema@ejemplo.example'),
        contacto('Ana Pérez', 'ana@ejemplo.example', { recibeRendiciones: true }),
      ],
    });

    // Primero los que reciben rendiciones, luego por nombre.
    expect(guardados.map((c) => c.nombre)).toEqual(['Ana Pérez', 'Zulema Ríos']);
    expect(guardados.every((c) => c.clienteId === cliente)).toBe(true);
    expect(await service.listarContactos(cliente)).toEqual(guardados);
  });

  it('edita varios contactos en un único guardado y no toca los que no cambiaron', async () => {
    const cliente = await crearCliente();
    const [a, b, c] = await service.reemplazarContactos(cliente, {
      contactos: [
        contacto('Ana', 'ana@ejemplo.example'),
        contacto('Bruno', 'bruno@ejemplo.example'),
        contacto('Carla', 'carla@ejemplo.example'),
      ],
    });
    const antes = await activos(cliente);
    const sinCambios = antes.find((fila) => fila.nombre === 'Carla');
    await new Promise((resolver) => setTimeout(resolver, 20));

    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [
        { ...contacto('Ana Renombrada', 'ana@ejemplo.example'), id: a?.id },
        {
          ...contacto('Bruno', 'bruno.nuevo@ejemplo.example', { recibeRendiciones: true }),
          id: b?.id,
        },
        { ...contacto('Carla', 'carla@ejemplo.example'), id: c?.id },
      ],
    });

    expect(guardados.map((g) => g.nombre).sort()).toEqual(['Ana Renombrada', 'Bruno', 'Carla']);
    const despues = await activos(cliente);
    expect(emailsPorNombre(despues)).toEqual({
      'Ana Renombrada': 'ana@ejemplo.example',
      Bruno: 'bruno.nuevo@ejemplo.example',
      Carla: 'carla@ejemplo.example',
    });
    // Se conservan las identidades.
    expect(despues.map((fila) => fila.id).sort()).toEqual(antes.map((fila) => fila.id).sort());
    // El que no cambió ni siquiera actualizó su fecha.
    expect(despues.find((fila) => fila.nombre === 'Carla')?.updatedAt).toEqual(
      sinCambios?.updatedAt,
    );
  });

  it('un PUT con exactamente la colección actual responde 200 y no toca ninguna fila', async () => {
    const cliente = await crearCliente();
    const [a, b] = await service.reemplazarContactos(cliente, {
      contactos: [
        contacto('Ana', 'a@ejemplo.example', { recibeRendiciones: true }),
        contacto('Bruno', 'b@ejemplo.example'),
      ],
    });
    // Se da de baja a un tercero para comprobar que también las filas dadas de baja quedan igual.
    await service.reemplazarContactos(cliente, {
      contactos: [
        { ...contacto('Ana', 'a@ejemplo.example', { recibeRendiciones: true }), id: a?.id },
        { ...contacto('Bruno', 'b@ejemplo.example'), id: b?.id },
        contacto('Carla', 'c@ejemplo.example'),
      ],
    });
    await service.reemplazarContactos(cliente, {
      contactos: [
        { ...contacto('Ana', 'a@ejemplo.example', { recibeRendiciones: true }), id: a?.id },
        { ...contacto('Bruno', 'b@ejemplo.example'), id: b?.id },
      ],
    });

    // `xmin` es el id de la transacción que escribió la fila por última vez: cambia con CUALQUIER
    // UPDATE, aunque deje los mismos valores. Junto con `updatedAt` e `isDeleted` prueba que no
    // hubo ninguna escritura.
    const estadoDeLasFilas = () =>
      prisma.$queryRaw<{ id: string; xmin: string }[]>`
        SELECT id, xmin::text AS xmin FROM "Contacto" WHERE "clienteId" = ${cliente}::uuid ORDER BY id`;
    const filas = () =>
      prisma.contacto.findMany({ where: { clienteId: cliente }, orderBy: { id: 'asc' } });
    const antes = await filas();
    const xminAntes = await estadoDeLasFilas();
    expect(antes).toHaveLength(3);
    expect(antes.filter((fila) => fila.isDeleted)).toHaveLength(1);
    await new Promise((resolver) => setTimeout(resolver, 20));

    const res = await request(app)
      .put(`/clientes/${cliente}/contactos`)
      .send({
        contactos: [
          { id: a?.id, ...contacto('Ana', 'a@ejemplo.example', { recibeRendiciones: true }) },
          { id: b?.id, ...contacto('Bruno', 'b@ejemplo.example') },
        ],
      });

    expect(res.status).toBe(200);
    const devueltos = res.body as { id: string; nombre: string }[];
    expect(devueltos.map((c) => c.nombre)).toEqual(['Ana', 'Bruno']);
    expect(devueltos.map((c) => c.id)).toEqual([a?.id, b?.id]);
    // Ninguna fila cambió: ni `updatedAt`, ni `isDeleted`/`deletedAt` (activas y dada de baja).
    expect(await filas()).toEqual(antes);
    expect(await estadoDeLasFilas()).toEqual(xminAntes);
  });

  it('intercambia los emails de dos contactos sin falso 409 (índice único parcial)', async () => {
    const cliente = await crearCliente();
    const [a, b] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
    });

    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [
        { ...contacto('Ana', 'b@ejemplo.example'), id: a?.id },
        { ...contacto('Bruno', 'a@ejemplo.example'), id: b?.id },
      ],
    });

    expect(emailsPorNombre(guardados)).toEqual({
      Ana: 'b@ejemplo.example',
      Bruno: 'a@ejemplo.example',
    });
    // Siguen siendo los mismos contactos, ahora activos y sin marca de baja.
    const despues = await activos(cliente);
    expect(despues.map((fila) => fila.id).sort()).toEqual([a?.id, b?.id].sort());
    expect(despues.every((fila) => fila.deletedAt === null)).toBe(true);
  });

  it('permite una rotación entre tres contactos (a→b, b→c, c→a)', async () => {
    const cliente = await crearCliente();
    const [a, b, c] = await service.reemplazarContactos(cliente, {
      contactos: [
        contacto('Ana', 'a@ejemplo.example'),
        contacto('Bruno', 'b@ejemplo.example'),
        contacto('Carla', 'c@ejemplo.example'),
      ],
    });

    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [
        { ...contacto('Ana', 'b@ejemplo.example'), id: a?.id },
        { ...contacto('Bruno', 'c@ejemplo.example'), id: b?.id },
        { ...contacto('Carla', 'a@ejemplo.example'), id: c?.id },
      ],
    });

    expect(emailsPorNombre(guardados)).toEqual({
      Ana: 'b@ejemplo.example',
      Bruno: 'c@ejemplo.example',
      Carla: 'a@ejemplo.example',
    });
  });

  it('un contacto puede tomar el email de otro que se elimina en el mismo guardado', async () => {
    const cliente = await crearCliente();
    const [a] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
    });

    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [{ ...contacto('Ana', 'b@ejemplo.example'), id: a?.id }],
    });

    expect(emailsPorNombre(guardados)).toEqual({ Ana: 'b@ejemplo.example' });
  });

  it('si algo falla, NO se aplica nada: ni las ediciones, ni las bajas, ni las altas', async () => {
    const cliente = await crearCliente();
    const [a, b] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
    });
    const antes = await activos(cliente);

    // El servicio recibe datos ya validados por shared; acá se salta esa capa a propósito para
    // que la base rechace el último paso (un nombre de 300 caracteres no entra en VarChar(150)).
    // Antes de fallar ya se renombró a Ana, se dio de baja a Bruno y se creó otro contacto.
    await expect(
      service.reemplazarContactos(cliente, {
        contactos: [
          { ...contacto('Ana Renombrada', 'a@ejemplo.example'), id: a?.id },
          contacto('Contacto Nuevo', 'nuevo@ejemplo.example'),
          contacto('x'.repeat(300), 'largo@ejemplo.example'),
        ],
      }),
    ).rejects.toBeDefined();

    const despues = await activos(cliente);
    expect(emailsPorNombre(despues)).toEqual({
      Ana: 'a@ejemplo.example',
      Bruno: 'b@ejemplo.example',
    });
    expect(despues.find((fila) => fila.id === b?.id)?.isDeleted).toBe(false);
    expect(despues.map((fila) => fila.updatedAt)).toEqual(antes.map((fila) => fila.updatedAt));
    expect(await prisma.contacto.count({ where: { clienteId: cliente } })).toBe(2);
  });

  it('un email duplicado dentro del guardado revierte todo y es un 409 EMAIL_DUPLICADO', async () => {
    const cliente = await crearCliente();
    const [a] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example')],
    });

    // Se salta shared para que el choque lo detecte el índice único real (createMany).
    const error = await falla(
      service.reemplazarContactos(cliente, {
        contactos: [
          { ...contacto('Ana Renombrada', 'a@ejemplo.example'), id: a?.id },
          contacto('Dos', 'repetido@ejemplo.example'),
          contacto('Tres', 'repetido@ejemplo.example'),
        ],
      }),
    );

    expect(error).toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(error.details).toMatchObject({ motivo: 'EMAIL_DUPLICADO' });
    expect(emailsPorNombre(await activos(cliente))).toEqual({ Ana: 'a@ejemplo.example' });
  });

  it('un id de otro cliente es un 404 y no cambia nada', async () => {
    const cliente = await crearCliente();
    const otro = await crearCliente();
    const [ajeno] = await service.reemplazarContactos(otro, {
      contactos: [contacto('Ajena', 'ajena@ejemplo.example')],
    });
    await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example')],
    });

    const error = await falla(
      service.reemplazarContactos(cliente, {
        contactos: [{ ...contacto('Robada', 'ajena@ejemplo.example'), id: ajeno?.id }],
      }),
    );

    expect(error).toMatchObject({ code: 'NOT_FOUND' });
    expect(emailsPorNombre(await activos(cliente))).toEqual({ Ana: 'a@ejemplo.example' });
    expect(emailsPorNombre(await activos(otro))).toEqual({ Ajena: 'ajena@ejemplo.example' });
  });

  it('eliminar un contacto es una baja lógica: queda la fila con su fecha de baja', async () => {
    const cliente = await crearCliente();
    const [a, b] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
    });

    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [{ ...contacto('Ana', 'a@ejemplo.example'), id: a?.id }],
    });

    expect(guardados.map((g) => g.nombre)).toEqual(['Ana']);
    const baja = await prisma.contacto.findUniqueOrThrow({ where: { id: b?.id ?? '' } });
    expect(baja.isDeleted).toBe(true);
    expect(baja.deletedAt).toBeInstanceOf(Date);
  });

  it('un contacto dado de baja libera su email, y un id dado de baja ya no se puede usar', async () => {
    const cliente = await crearCliente();
    const [, b] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
    });
    await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example')],
    });

    // El email de Bruno quedó libre para un contacto nuevo...
    const guardados = await service.reemplazarContactos(cliente, {
      contactos: [
        contacto('Ana', 'a@ejemplo.example'),
        contacto('Otro Bruno', 'b@ejemplo.example'),
      ],
    });
    expect(guardados).toHaveLength(2);
    // ...pero no se puede "revivir" a Bruno por su id.
    const error = await falla(
      service.reemplazarContactos(cliente, {
        contactos: [{ ...contacto('Bruno', 'bruno2@ejemplo.example'), id: b?.id }],
      }),
    );
    expect(error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('una lista vacía elimina todos los contactos', async () => {
    const cliente = await crearCliente();
    await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
    });

    expect(await service.reemplazarContactos(cliente, { contactos: [] })).toEqual([]);
    expect(await activos(cliente)).toHaveLength(0);
    expect(await prisma.contacto.count({ where: { clienteId: cliente, isDeleted: true } })).toBe(2);
  });

  it('dos guardados simultáneos nunca se mezclan: queda uno de los dos, completo', async () => {
    const cliente = await crearCliente();
    const guardadoA = {
      contactos: [
        contacto('De A uno', 'a1@ejemplo.example'),
        contacto('De A dos', 'a2@ejemplo.example'),
      ],
    };
    const guardadoB = {
      contactos: [
        contacto('De B uno', 'b1@ejemplo.example'),
        contacto('De B dos', 'b2@ejemplo.example'),
      ],
    };

    const resultados = await Promise.allSettled([
      service.reemplazarContactos(cliente, guardadoA),
      service.reemplazarContactos(cliente, guardadoB),
    ]);

    expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const resultado of resultados) {
      // Si uno pierde la carrera, es el 409 para reintentar y no un error inesperado.
      if (resultado.status === 'rejected') {
        expect(resultado.reason).toMatchObject({ code: 'CONFLICT' });
        expect(resultado.reason).toMatchObject({ details: { motivo: 'CONTACTOS_MODIFICADOS' } });
      }
    }
    const nombres = (await activos(cliente)).map((fila) => fila.nombre);
    const esperado = [guardadoA, guardadoB].map((g) => g.contactos.map((c) => c.nombre).sort());
    expect(esperado).toContainEqual(nombres.sort());
  });

  it('una escritura concurrente sobre un contacto aborta el guardado (409) en vez de pisarla', async () => {
    const cliente = await crearCliente();
    const [a] = await service.reemplazarContactos(cliente, {
      contactos: [contacto('Ana', 'a@ejemplo.example')],
    });

    // Otra persona modifica a Ana y tarda en confirmar: su transacción retiene la fila.
    let retenida: () => void = () => undefined;
    const filaRetenida = new Promise<void>((resolver) => {
      retenida = resolver;
    });
    const otraPersona = prisma.$transaction(async (tx) => {
      await tx.contacto.update({
        where: { id: a?.id ?? '' },
        data: { nombre: 'Cambio de otra persona' },
      });
      retenida();
      await new Promise((resolver) => setTimeout(resolver, 400));
    });
    await filaRetenida;

    // El guardado ya leyó a Ana (todavía con su nombre original) y se queda esperando la fila.
    // Con aislamiento Serializable, cuando la otra persona confirma, la base lo aborta; con uno
    // menos estricto pisaría su cambio en silencio.
    const miGuardado = service.reemplazarContactos(cliente, {
      contactos: [{ ...contacto('Cambio mío', 'a@ejemplo.example'), id: a?.id }],
    });

    const [, resultado] = await Promise.allSettled([otraPersona, miGuardado]);

    expect(resultado.status).toBe('rejected');
    expect(resultado).toMatchObject({
      reason: { code: 'CONFLICT', details: { motivo: 'CONTACTOS_MODIFICADOS' } },
    });
    expect(emailsPorNombre(await activos(cliente))).toEqual({
      'Cambio de otra persona': 'a@ejemplo.example',
    });
  });

  describe('cliente dado de baja lógica (isDeleted)', () => {
    it.each([
      ['listar', (id: string) => service.listarContactos(id)],
      [
        'crear',
        (id: string) =>
          service.crearContacto(id, {
            nombre: 'Ana',
            area: 'Área',
            email: 'a@ejemplo.example',
            recibeRendiciones: false,
          }),
      ],
      [
        'reemplazar',
        (id: string) =>
          service.reemplazarContactos(id, { contactos: [contacto('Ana', 'a@ejemplo.example')] }),
      ],
      [
        'actualizar',
        (id: string) =>
          service.actualizarContacto(id, '00000000-0000-4000-8000-000000000000', {
            nombre: 'Otro Nombre',
          }),
      ],
      [
        'eliminar',
        (id: string) => service.eliminarContacto(id, '00000000-0000-4000-8000-000000000000'),
      ],
    ])('%s es un 404 y no escribe nada', async (_operacion, operar) => {
      const cliente = await crearCliente({ isDeleted: true });

      const error = await falla(operar(cliente));

      expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'Cliente no encontrado' });
      expect(await prisma.contacto.count({ where: { clienteId: cliente } })).toBe(0);
    });

    it('un cliente INACTIVO (sin baja lógica) sí admite contactos', async () => {
      const cliente = await crearCliente();
      await prisma.cliente.update({ where: { id: cliente }, data: { estado: 'INACTIVO' } });

      const guardados = await service.reemplazarContactos(cliente, {
        contactos: [contacto('Ana', 'a@ejemplo.example')],
      });

      expect(guardados).toHaveLength(1);
    });
  });

  describe('CRUD individual', () => {
    it('un email duplicado se informa como 409 con el contacto existente (crear y actualizar)', async () => {
      const cliente = await crearCliente();
      const [a, b] = await service.reemplazarContactos(cliente, {
        contactos: [contacto('Ana', 'a@ejemplo.example'), contacto('Bruno', 'b@ejemplo.example')],
      });

      const alCrear = await falla(
        service.crearContacto(cliente, contacto('Otra Ana', 'a@ejemplo.example')),
      );
      const alActualizar = await falla(
        service.actualizarContacto(cliente, b?.id ?? '', { email: 'a@ejemplo.example' }),
      );

      for (const error of [alCrear, alActualizar]) {
        expect(error).toMatchObject({ code: 'CONFLICT' });
        expect(error.details).toMatchObject({
          motivo: 'EMAIL_DUPLICADO',
          contactoExistente: { id: a?.id, nombre: 'Ana' },
        });
      }
    });

    it('actualizar o eliminar un contacto de otro cliente es un 404', async () => {
      const cliente = await crearCliente();
      const otro = await crearCliente();
      const [ajeno] = await service.reemplazarContactos(otro, {
        contactos: [contacto('Ajena', 'ajena@ejemplo.example')],
      });

      const alActualizar = await falla(
        service.actualizarContacto(cliente, ajeno?.id ?? '', { nombre: 'Intruso' }),
      );
      const alEliminar = await falla(service.eliminarContacto(cliente, ajeno?.id ?? ''));

      expect(alActualizar).toMatchObject({ code: 'NOT_FOUND', message: 'Contacto no encontrado' });
      expect(alEliminar).toMatchObject({ code: 'NOT_FOUND' });
      expect(emailsPorNombre(await activos(otro))).toEqual({ Ajena: 'ajena@ejemplo.example' });
    });

    it('eliminar dos veces el mismo contacto: la segunda es un 404', async () => {
      const cliente = await crearCliente();
      const [a] = await service.reemplazarContactos(cliente, {
        contactos: [contacto('Ana', 'a@ejemplo.example')],
      });

      await service.eliminarContacto(cliente, a?.id ?? '');

      await expect(service.eliminarContacto(cliente, a?.id ?? '')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
