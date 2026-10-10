import { Prisma, type Contacto as ContactoRow } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Prisma se reemplaza por dobles: el CI no tiene base de datos. Estos tests cubren validación,
// errores y el ORDEN de las operaciones. Que el guardado sea realmente atómico y que el
// intercambio de emails funcione contra el índice único parcial lo prueban los tests con
// PostgreSQL real (`contactos.integration.test.ts`): un mock no puede demostrarlo.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  // `transaccion` es el cliente que recibe el callback de `$transaction`: las escrituras del
  // guardado completo tienen que pasar por acá y no por `prismaMock`.
  const transaccion = { cliente: delegado(), contacto: delegado() };
  const prismaMock = {
    cliente: delegado(),
    contacto: delegado(),
    $transaction: vi.fn(),
  };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const ID_A = 'c1111111-1111-4111-a111-111111111111';
const ID_B = 'c2222222-2222-4222-a222-222222222222';
const ID_C = 'c3333333-3333-4333-a333-333333333333';
const AHORA = new Date('2026-10-08T12:00:00.000Z');

const fila = (id: string, extra: Partial<ContactoRow> = {}): ContactoRow => ({
  id,
  nombre: `Contacto ${id.slice(1, 2)}`,
  area: 'Tesorería',
  email: `${id.slice(0, 2)}@ejemplo.example`,
  recibeRendiciones: false,
  clienteId: CLIENTE,
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
  ...extra,
});

const filaA = fila(ID_A, { nombre: 'Ana Pérez', email: 'a@ejemplo.example' });
const filaB = fila(ID_B, { nombre: 'Bruno Gómez', email: 'b@ejemplo.example' });

const nuevo = (extra: object = {}) => ({
  nombre: 'Carla Díaz',
  area: 'Compras',
  email: 'carla@ejemplo.example',
  recibeRendiciones: false,
  ...extra,
});

function errorPrisma(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    ...(meta === undefined ? {} : { meta }),
  });
}

const errorDeEmail = () => errorPrisma('P2002', { target: ['clienteId', 'email'] });

const put = (id: string, body: object) => request(app).put(`/clientes/${id}/contactos`).send(body);

const detalles = (res: request.Response) =>
  (res.body as { error: { details: { campo: string; mensaje: string }[] } }).error.details;
const campos = (res: request.Response) => detalles(res).map((d) => d.campo);

/** Todas las escrituras que llegaron a algún cliente de Prisma (la transacción o el global). */
const escrituras = () =>
  [transaccion, prismaMock].flatMap((cliente) =>
    ['create', 'createMany', 'update', 'updateMany'].flatMap(
      (metodo) => cliente.contacto[metodo as 'update'].mock.calls,
    ),
  );

beforeEach(() => {
  // Por defecto el cliente existe y no tiene contactos.
  for (const cliente of [prismaMock, transaccion]) {
    cliente.cliente.findFirst.mockResolvedValue({ id: CLIENTE });
    cliente.contacto.findMany.mockResolvedValue([]);
    cliente.contacto.updateMany.mockResolvedValue({ count: 0 });
    cliente.contacto.createMany.mockResolvedValue({ count: 0 });
  }
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) =>
    callback(transaccion),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

// ─── Validación de params y cliente dado de baja ───────────────────────────────

describe('contactos: params', () => {
  it.each([
    ['GET', (id: string) => request(app).get(`/clientes/${id}/contactos`)],
    ['POST', (id: string) => request(app).post(`/clientes/${id}/contactos`).send(nuevo())],
    ['PUT', (id: string) => put(id, { contactos: [] })],
  ])('%s con el id del cliente mal formado responde 400 y no toca la base', async (_m, pedir) => {
    const res = await pedir('no-es-uuid');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(campos(res)).toContain('id');
    expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'PATCH',
      (c: string, k: string) =>
        request(app).patch(`/clientes/${c}/contactos/${k}`).send({ nombre: 'Otro Nombre' }),
    ],
    ['DELETE', (c: string, k: string) => request(app).delete(`/clientes/${c}/contactos/${k}`)],
  ])('%s con el id del contacto mal formado responde 400', async (_m, pedir) => {
    const res = await pedir(CLIENTE, 'no-es-uuid');

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['contactoId']);
    expect(detalles(res)[0]?.mensaje).toBe('El ID del contacto debe ser un UUID válido.');
    expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
  });

  it('PATCH informa los dos ids si ambos están mal formados', async () => {
    const res = await request(app).patch('/clientes/x/contactos/y').send({ nombre: 'Otro Nombre' });

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['id', 'contactoId']);
  });
});

describe('contactos: cliente inexistente o dado de baja', () => {
  beforeEach(() => {
    // `isDeleted: true` no cumple el `where`: para los contactos el cliente no existe.
    prismaMock.cliente.findFirst.mockResolvedValue(null);
    transaccion.cliente.findFirst.mockResolvedValue(null);
  });

  it.each([
    ['GET', () => request(app).get(`/clientes/${CLIENTE}/contactos`)],
    ['POST', () => request(app).post(`/clientes/${CLIENTE}/contactos`).send(nuevo())],
    ['PUT', () => put(CLIENTE, { contactos: [nuevo()] })],
    [
      'PATCH',
      () =>
        request(app)
          .patch(`/clientes/${CLIENTE}/contactos/${ID_A}`)
          .send({ nombre: 'Otro Nombre' }),
    ],
    ['DELETE', () => request(app).delete(`/clientes/${CLIENTE}/contactos/${ID_A}`)],
  ])('%s responde 404 y no escribe', async (_m, pedir) => {
    const res = await pedir();

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' },
    });
    expect(escrituras()).toHaveLength(0);
  });

  it('busca el cliente excluyendo la baja lógica, sin mirar el estado', async () => {
    await request(app).get(`/clientes/${CLIENTE}/contactos`);

    expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
      where: { id: CLIENTE, isDeleted: false },
      select: { id: true },
    });
  });
});

// ─── CRUD individual ───────────────────────────────────────────────────────────

describe('contactos: PATCH', () => {
  const patch = (body: object, contactoId = ID_A) =>
    request(app).patch(`/clientes/${CLIENTE}/contactos/${contactoId}`).send(body);

  it('con {} responde 400 y no escribe', async () => {
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(detalles(res)).toEqual([
      { campo: 'body', mensaje: 'Enviá al menos un campo para modificar.' },
    ]);
    expect(prismaMock.contacto.update).not.toHaveBeenCalled();
  });

  it('con solo campos que no se editan responde 400', async () => {
    expect((await patch({ clienteId: ID_B, isDeleted: true })).status).toBe(400);
  });

  it('modifica solo los campos enviados y busca por id, cliente y baja lógica', async () => {
    prismaMock.contacto.update.mockResolvedValue({ ...filaA, nombre: 'Nombre Nuevo' });

    const res = await patch({ nombre: 'Nombre Nuevo' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ID_A, nombre: 'Nombre Nuevo' });
    expect(prismaMock.contacto.update).toHaveBeenCalledWith({
      where: { id: ID_A, clienteId: CLIENTE, isDeleted: false },
      data: { nombre: 'Nombre Nuevo' },
    });
  });

  it('un contacto ajeno, inexistente o dado de baja es un 404 (P2025)', async () => {
    prismaMock.contacto.update.mockRejectedValue(errorPrisma('P2025'));

    const res = await patch({ nombre: 'Nombre Nuevo' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Contacto no encontrado' },
    });
  });

  it('un email que ya tiene otro contacto del cliente es un 409 con ese contacto', async () => {
    prismaMock.contacto.update.mockRejectedValue(errorDeEmail());
    prismaMock.contacto.findFirst.mockResolvedValue({ id: ID_B, nombre: 'Bruno Gómez' });

    const res = await patch({ email: 'b@ejemplo.example' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'CONFLICT',
        details: {
          motivo: 'EMAIL_DUPLICADO',
          contactoExistente: { id: ID_B, nombre: 'Bruno Gómez' },
        },
      },
    });
  });
});

describe('contactos: DELETE', () => {
  it('da de baja el contacto (baja lógica) y responde 204', async () => {
    prismaMock.contacto.update.mockResolvedValue({ ...filaA, isDeleted: true });

    const res = await request(app).delete(`/clientes/${CLIENTE}/contactos/${ID_A}`);

    expect(res.status).toBe(204);
    expect(prismaMock.contacto.update).toHaveBeenCalledWith({
      where: { id: ID_A, clienteId: CLIENTE, isDeleted: false },
      data: { isDeleted: true, deletedAt: expect.any(Date) as unknown },
    });
  });

  it('un contacto inexistente o ya eliminado es un 404', async () => {
    prismaMock.contacto.update.mockRejectedValue(errorPrisma('P2025'));

    const res = await request(app).delete(`/clientes/${CLIENTE}/contactos/${ID_A}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('contactos: GET y POST', () => {
  it('GET lista los contactos activos con el orden de la convención', async () => {
    prismaMock.contacto.findMany.mockResolvedValue([filaA, filaB]);

    const res = await request(app).get(`/clientes/${CLIENTE}/contactos`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(prismaMock.contacto.findMany).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE, isDeleted: false },
      orderBy: [{ recibeRendiciones: 'desc' }, { nombre: 'asc' }],
    });
  });

  it('POST crea el contacto con el email normalizado', async () => {
    prismaMock.contacto.create.mockResolvedValue(fila(ID_C, { email: 'carla@ejemplo.example' }));

    const res = await request(app)
      .post(`/clientes/${CLIENTE}/contactos`)
      .send(nuevo({ email: '  CARLA@Ejemplo.Example ' }));

    expect(res.status).toBe(201);
    expect(prismaMock.contacto.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clienteId: CLIENTE,
        email: 'carla@ejemplo.example',
      }) as unknown,
    });
  });

  it('POST con un email de más de 254 caracteres responde 400 y no 500', async () => {
    const res = await request(app)
      .post(`/clientes/${CLIENTE}/contactos`)
      .send(nuevo({ email: `${'a'.repeat(250)}@x.example` }));

    expect(res.status).toBe(400);
    expect(campos(res)).toContain('email');
    expect(prismaMock.contacto.create).not.toHaveBeenCalled();
  });
});

// ─── PUT: guardado completo ────────────────────────────────────────────────────

describe('PUT /clientes/:id/contactos: validación', () => {
  it.each([
    ['sin el objeto', {}],
    ['con la lista como texto', { contactos: 'x' }],
  ])('rechaza un pedido %s', async (_caso, body) => {
    const res = await put(CLIENTE, body);

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('informa cada campo inválido con la ruta del contacto', async () => {
    const res = await put(CLIENTE, { contactos: [nuevo(), nuevo({ nombre: 'A', email: 'x' })] });

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['contactos.1.nombre', 'contactos.1.email']);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza emails repetidos dentro del pedido, ya normalizados, y marca a los dos', async () => {
    const res = await put(CLIENTE, {
      contactos: [nuevo(), nuevo({ nombre: 'Otra Persona', email: ' CARLA@ejemplo.example ' })],
    });

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['contactos.0.email', 'contactos.1.email']);
    expect(detalles(res)[0]?.mensaje).toBe(
      'Este email está repetido en otro contacto de la lista.',
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rechaza ids repetidos dentro del pedido', async () => {
    const res = await put(CLIENTE, {
      contactos: [
        { ...nuevo(), id: ID_A },
        { ...nuevo({ email: 'otro@ejemplo.example' }), id: ID_A },
      ],
    });

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['contactos.0.id', 'contactos.1.id']);
  });

  it('rechaza un email de más de 254 caracteres', async () => {
    const res = await put(CLIENTE, {
      contactos: [nuevo({ email: `${'a'.repeat(250)}@x.example` })],
    });

    expect(res.status).toBe(400);
    expect(campos(res)).toContain('contactos.0.email');
  });
});

describe('PUT /clientes/:id/contactos: reconciliación', () => {
  /** Los contactos activos que hay en la base antes del guardado. */
  const hay = (...filas: ContactoRow[]) =>
    transaccion.contacto.findMany.mockResolvedValueOnce(filas);
  /** La colección que devuelve la lectura final dentro de la transacción. */
  const quedan = (...filas: ContactoRow[]) =>
    transaccion.contacto.findMany.mockResolvedValueOnce(filas);

  it('corre todo en UNA transacción Serializable y las escrituras van por ella', async () => {
    hay(filaA);
    quedan(filaA);

    await put(CLIENTE, { contactos: [{ ...nuevo(), id: ID_A }] });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    // Nada se escribió fuera de la transacción.
    for (const metodo of ['create', 'createMany', 'update', 'updateMany'] as const) {
      expect(prismaMock.contacto[metodo]).not.toHaveBeenCalled();
    }
  });

  it('una lista vacía es válida: da de baja todos los contactos activos', async () => {
    hay(filaA, filaB);
    quedan();

    const res = await put(CLIENTE, { contactos: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(transaccion.contacto.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ID_A, ID_B] }, clienteId: CLIENTE },
      data: { isDeleted: true, deletedAt: expect.any(Date) as unknown },
    });
  });

  it('una lista vacía sobre un cliente sin contactos no escribe nada', async () => {
    hay();
    quedan();

    const res = await put(CLIENTE, { contactos: [] });

    expect(res.status).toBe(200);
    expect(escrituras()).toHaveLength(0);
  });

  it('crea los contactos nuevos con los datos normalizados y devuelve la colección final', async () => {
    hay();
    quedan(fila(ID_C, { nombre: 'Carla Díaz', email: 'carla@ejemplo.example' }));

    const res = await put(CLIENTE, {
      contactos: [nuevo({ nombre: '  Carla Díaz ', email: ' CARLA@Ejemplo.Example ' })],
    });

    expect(res.status).toBe(200);
    expect(transaccion.contacto.createMany).toHaveBeenCalledWith({
      data: [
        {
          clienteId: CLIENTE,
          nombre: 'Carla Díaz',
          area: 'Compras',
          email: 'carla@ejemplo.example',
          recibeRendiciones: false,
        },
      ],
    });
    expect(res.body).toEqual([expect.objectContaining({ id: ID_C, nombre: 'Carla Díaz' })]);
  });

  it('actualiza solo los existentes que cambiaron', async () => {
    hay(filaA, filaB);
    quedan(filaA, filaB);

    const res = await put(CLIENTE, {
      contactos: [
        {
          id: ID_A,
          nombre: 'Ana Pérez',
          area: 'Tesorería',
          email: 'a@ejemplo.example',
          recibeRendiciones: false,
        },
        {
          id: ID_B,
          nombre: 'Bruno Renombrado',
          area: 'Tesorería',
          email: 'b@ejemplo.example',
          recibeRendiciones: false,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(transaccion.contacto.update).toHaveBeenCalledTimes(1);
    expect(transaccion.contacto.update).toHaveBeenCalledWith({
      where: { id: ID_B },
      data: {
        nombre: 'Bruno Renombrado',
        area: 'Tesorería',
        email: 'b@ejemplo.example',
        recibeRendiciones: false,
        isDeleted: false,
        deletedAt: null,
      },
    });
  });

  it('no escribe nada si ningún contacto cambió (no toca updatedAt)', async () => {
    hay(filaA, filaB);
    quedan(filaA, filaB);

    const res = await put(CLIENTE, {
      contactos: [
        {
          id: ID_A,
          nombre: 'Ana Pérez',
          area: 'Tesorería',
          email: ' A@Ejemplo.Example ',
          recibeRendiciones: false,
        },
        {
          id: ID_B,
          nombre: 'Bruno Gómez',
          area: 'Tesorería',
          email: 'b@ejemplo.example',
          recibeRendiciones: false,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(escrituras()).toHaveLength(0);
  });

  it('los contactos que el pedido ya no trae se dan de baja y los demás se conservan', async () => {
    hay(filaA, filaB);
    quedan(filaA);

    await put(CLIENTE, {
      contactos: [
        {
          id: ID_A,
          nombre: 'Ana Pérez',
          area: 'Tesorería',
          email: 'a@ejemplo.example',
          recibeRendiciones: false,
        },
      ],
    });

    expect(transaccion.contacto.updateMany).toHaveBeenCalledTimes(1);
    expect(transaccion.contacto.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [ID_B] }, clienteId: CLIENTE },
      data: { isDeleted: true, deletedAt: expect.any(Date) as unknown },
    });
    expect(transaccion.contacto.update).not.toHaveBeenCalled();
  });

  it.each([
    ['un id que no existe', ID_C],
    ['el id de un contacto de otro cliente o dado de baja', 'c9999999-9999-4999-a999-999999999999'],
  ])('%s es un 404 y no escribe nada', async (_caso, id) => {
    hay(filaA);

    const res = await put(CLIENTE, { contactos: [{ ...nuevo(), id }] });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Contacto no encontrado' },
    });
    expect(escrituras()).toHaveLength(0);
  });

  describe('intercambio de emails', () => {
    const intercambio = {
      contactos: [
        {
          id: ID_A,
          nombre: 'Ana Pérez',
          area: 'Tesorería',
          email: 'b@ejemplo.example',
          recibeRendiciones: false,
        },
        {
          id: ID_B,
          nombre: 'Bruno Gómez',
          area: 'Tesorería',
          email: 'a@ejemplo.example',
          recibeRendiciones: false,
        },
      ],
    };

    it('estaciona a los dos antes de reasignar y recién después los actualiza', async () => {
      hay(filaA, filaB);
      quedan(filaA, filaB);

      const res = await put(CLIENTE, intercambio);

      expect(res.status).toBe(200);
      const [estacionar] = transaccion.contacto.updateMany.mock.invocationCallOrder;
      const actualizaciones = transaccion.contacto.update.mock.invocationCallOrder;
      expect(transaccion.contacto.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [ID_A, ID_B] }, clienteId: CLIENTE },
        data: { isDeleted: true },
      });
      expect(actualizaciones).toHaveLength(2);
      expect(estacionar).toBeLessThan(Math.min(...actualizaciones));
      // Cada uno vuelve a quedar activo, ya con el email del otro.
      expect(transaccion.contacto.update).toHaveBeenCalledWith({
        where: { id: ID_A },
        data: expect.objectContaining({
          email: 'b@ejemplo.example',
          isDeleted: false,
          deletedAt: null,
        }) as unknown,
      });
      expect(transaccion.contacto.update).toHaveBeenCalledWith({
        where: { id: ID_B },
        data: expect.objectContaining({
          email: 'a@ejemplo.example',
          isDeleted: false,
          deletedAt: null,
        }) as unknown,
      });
    });

    it('no estaciona a los que cambian de nombre pero no de email', async () => {
      hay(filaA, filaB);
      quedan(filaA, filaB);

      await put(CLIENTE, {
        contactos: [
          {
            id: ID_A,
            nombre: 'Ana Renombrada',
            area: 'Tesorería',
            email: 'a@ejemplo.example',
            recibeRendiciones: false,
          },
          {
            id: ID_B,
            nombre: 'Bruno Gómez',
            area: 'Tesorería',
            email: 'b@ejemplo.example',
            recibeRendiciones: false,
          },
        ],
      });

      expect(transaccion.contacto.updateMany).not.toHaveBeenCalled();
      expect(transaccion.contacto.update).toHaveBeenCalledTimes(1);
    });

    it('un contacto puede tomar el email de otro que se elimina en el mismo guardado', async () => {
      hay(filaA, filaB);
      quedan(filaA);

      await put(CLIENTE, {
        contactos: [
          {
            id: ID_A,
            nombre: 'Ana Pérez',
            area: 'Tesorería',
            email: 'b@ejemplo.example',
            recibeRendiciones: false,
          },
        ],
      });

      const bajas = transaccion.contacto.updateMany.mock.invocationCallOrder;
      // Primero se libera el email del eliminado, después se reasigna.
      expect(transaccion.contacto.updateMany.mock.calls[0]?.[0]).toMatchObject({
        where: { id: { in: [ID_B] } },
        data: { isDeleted: true, deletedAt: expect.any(Date) as unknown },
      });
      expect(bajas[0]).toBeLessThan(transaccion.contacto.update.mock.invocationCallOrder[0] ?? 0);
    });
  });

  describe('errores', () => {
    it('un conflicto de email real revierte todo y responde 409 con el contacto que lo tiene', async () => {
      hay();
      transaccion.contacto.createMany.mockRejectedValue(errorDeEmail());
      prismaMock.contacto.findFirst.mockResolvedValue({ id: ID_B, nombre: 'Bruno Gómez' });

      const res = await put(CLIENTE, { contactos: [nuevo({ email: 'b@ejemplo.example' })] });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: {
          code: 'CONFLICT',
          details: {
            motivo: 'EMAIL_DUPLICADO',
            contactoExistente: { id: ID_B, nombre: 'Bruno Gómez' },
          },
        },
      });
      // La búsqueda del contacto en conflicto es posterior y ajena a la transacción.
      expect(prismaMock.contacto.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ clienteId: CLIENTE, isDeleted: false }) as unknown,
        select: { id: true, nombre: true },
      });
    });

    it('un conflicto de email sin contacto identificable igual es un 409', async () => {
      hay();
      transaccion.contacto.createMany.mockRejectedValue(errorDeEmail());
      prismaMock.contacto.findFirst.mockResolvedValue(null);

      const res = await put(CLIENTE, { contactos: [nuevo()] });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { details: { motivo: 'EMAIL_DUPLICADO' } } });
    });

    it('si otra escritura modificó los contactos a la vez (P2034), responde 409 para reintentar', async () => {
      prismaMock.$transaction.mockRejectedValue(errorPrisma('P2034'));

      const res = await put(CLIENTE, { contactos: [nuevo()] });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { code: 'CONFLICT', details: { motivo: 'CONTACTOS_MODIFICADOS' } },
      });
    });

    it('un fallo inesperado de la base es un 500 genérico, sin detalles de Prisma', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      hay();
      transaccion.contacto.createMany.mockRejectedValue(errorPrisma('P1001'));

      const res = await put(CLIENTE, { contactos: [nuevo()] });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
      });
    });

    it('si una operación falla, las siguientes no se intentan', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      hay(filaA);
      transaccion.contacto.update.mockRejectedValue(errorPrisma('P1001'));

      const res = await put(CLIENTE, {
        contactos: [
          {
            id: ID_A,
            nombre: 'Ana Renombrada',
            area: 'Tesorería',
            email: 'a@ejemplo.example',
            recibeRendiciones: false,
          },
          nuevo(),
        ],
      });

      expect(res.status).toBe(500);
      expect(transaccion.contacto.createMany).not.toHaveBeenCalled();
    });
  });
});
