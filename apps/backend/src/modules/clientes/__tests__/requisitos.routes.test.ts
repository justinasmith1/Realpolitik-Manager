import { Prisma } from '@prisma/client';
import { problemaDeDias } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Igual que en contactos: la base está simulada y se recorre route → validate → controller →
// service → mapper → errorHandler. El mock no puede demostrar el índice parcial ni el aislamiento
// real; sí el orden, los argumentos y la traducción de los errores de Prisma.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  });
  const transaccion = {
    cliente: delegado(),
    tipoDocumento: delegado(),
    requisitoCliente: delegado(),
  };
  const prismaMock = {
    cliente: delegado(),
    tipoDocumento: delegado(),
    requisitoCliente: delegado(),
    $transaction: vi.fn(),
  };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const REQUISITO = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const TIPO = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const AHORA = new Date('2026-10-20T12:00:00.000Z');
const DESPUES = new Date('2026-10-20T13:00:00.000Z');

const CAMPOS_DEL_CONTRATO = [
  'actualizadoEn',
  'canalEntrega',
  'cantidad',
  'clienteId',
  'creadoEn',
  'diasAproximados',
  'id',
  'nota',
  'tipoDocumento',
];

function tipo(extra: Record<string, unknown> = {}) {
  return {
    id: TIPO,
    nombre: 'Print',
    nombreNormalizado: 'print',
    descripcion: 'No sale',
    activo: true,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...extra,
  };
}

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: REQUISITO,
    clienteId: CLIENTE,
    tipoDocumentoId: TIPO,
    cantidad: 3,
    diasAproximados: [1, 10, 20],
    canalEntrega: null,
    nota: 'Prints de la pauta de radio',
    isDeleted: false,
    deletedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    tipoDocumento: tipo(),
    ...extra,
  };
}

const clienteDe = (extra: Record<string, unknown> = {}) => ({
  id: CLIENTE,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  ...extra,
});

function errorPrisma(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    ...(meta === undefined ? {} : { meta }),
  });
}

const duplicado = (target: unknown) => errorPrisma('P2002', { target });

const errorDesconocido = (message: string) =>
  new Prisma.PrismaClientUnknownRequestError(message, {
    clientVersion: Prisma.prismaVersion.client,
  });

const silenciarConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const listar = (id = CLIENTE) => request(app).get(`/clientes/${id}/requisitos`);
const crear = (body: object, id = CLIENTE) =>
  request(app).post(`/clientes/${id}/requisitos`).send(body);
const editar = (body: object, id = CLIENTE, requisitoId = REQUISITO) =>
  request(app).patch(`/clientes/${id}/requisitos/${requisitoId}`).send(body);
const borrar = (id = CLIENTE, requisitoId = REQUISITO) =>
  request(app).delete(`/clientes/${id}/requisitos/${requisitoId}`);

const detalles = (res: request.Response) =>
  (res.body as { error: { details: { campo: string; mensaje: string }[] } }).error.details;
const campos = (res: request.Response) => detalles(res).map((detalle) => detalle.campo);

const pedidoMinimo = { tipoDocumentoId: TIPO };

beforeEach(() => {
  for (const db of [prismaMock, transaccion]) {
    db.cliente.findFirst.mockResolvedValue(clienteDe());
    db.tipoDocumento.findUnique.mockResolvedValue({ id: TIPO, activo: true });
    db.requisitoCliente.findMany.mockResolvedValue([]);
    db.requisitoCliente.findFirst.mockResolvedValue(fila());
    db.requisitoCliente.count.mockResolvedValue(1);
    db.cliente.update.mockResolvedValue(clienteDe({ matrizConfigurada: true }));
  }
  transaccion.requisitoCliente.create.mockImplementation(
    (args: { data: Record<string, unknown> }) =>
      Promise.resolve(
        fila({
          cantidad: args.data.cantidad,
          diasAproximados: args.data.diasAproximados,
          canalEntrega: args.data.canalEntrega,
          nota: args.data.nota,
          tipoDocumentoId: args.data.tipoDocumentoId,
        }),
      ),
  );
  transaccion.requisitoCliente.update.mockImplementation(
    (args: { data: Record<string, unknown> }) =>
      Promise.resolve(fila({ ...args.data, updatedAt: DESPUES })),
  );
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) =>
    callback(transaccion),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('requisitos: params', () => {
  it.each([
    ['GET', () => listar('no-es-uuid')],
    ['POST', () => crear(pedidoMinimo, 'no-es-uuid')],
  ])(
    '%s con el id del cliente mal formado responde 400 y no toca la base',
    async (_metodo, pedir) => {
      const res = await pedir();

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(campos(res)).toContain('id');
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['PATCH', () => editar({ nota: 'Otra nota' }, CLIENTE, 'no-es-uuid')],
    ['DELETE', () => borrar(CLIENTE, 'no-es-uuid')],
  ])('%s con el id del requisito mal formado responde 400', async (_metodo, pedir) => {
    const res = await pedir();

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['requisitoId']);
    expect(detalles(res)[0]?.mensaje).toBe('El ID del requisito debe ser un UUID válido.');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('PATCH informa los dos ids si ambos están mal formados', async () => {
    const res = await editar({ nota: 'Otra nota' }, 'x', 'y');

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['id', 'requisitoId']);
  });
});

describe('GET /clientes/:id/requisitos', () => {
  it('devuelve los requisitos activos, ordenados por la clave del tipo, con el DTO del contrato', async () => {
    prismaMock.requisitoCliente.findMany.mockResolvedValue([
      fila(),
      fila({
        id: 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789',
        tipoDocumento: tipo({ id: 'f3a4b5c6-d7e8-4901-8cde-f01234567890', nombre: 'Factura' }),
      }),
    ]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
      where: { id: CLIENTE, isDeleted: false },
      select: { id: true },
    });
    expect(prismaMock.requisitoCliente.findMany).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE, isDeleted: false },
      orderBy: { tipoDocumento: { nombreNormalizado: 'asc' } },
      include: { tipoDocumento: true },
    });
    const listado = res.body as { tipoDocumento: object }[];
    const primero = listado[0];
    expect(primero).toBeDefined();
    if (primero === undefined) return;
    expect(Object.keys(primero).sort()).toEqual(CAMPOS_DEL_CONTRATO);
    expect(Object.keys(primero.tipoDocumento).sort()).toEqual(['activo', 'id', 'nombre']);
    expect(res.body).toEqual([
      {
        id: REQUISITO,
        clienteId: CLIENTE,
        tipoDocumento: { id: TIPO, nombre: 'Print', activo: true },
        cantidad: 3,
        diasAproximados: [1, 10, 20],
        canalEntrega: null,
        nota: 'Prints de la pauta de radio',
        creadoEn: AHORA.toISOString(),
        actualizadoEn: AHORA.toISOString(),
      },
      {
        id: 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789',
        clienteId: CLIENTE,
        tipoDocumento: {
          id: 'f3a4b5c6-d7e8-4901-8cde-f01234567890',
          nombre: 'Factura',
          activo: true,
        },
        cantidad: 3,
        diasAproximados: [1, 10, 20],
        canalEntrega: null,
        nota: 'Prints de la pauta de radio',
        creadoEn: AHORA.toISOString(),
        actualizadoEn: AHORA.toISOString(),
      },
    ]);
  });

  it('un cliente sin requisitos activos responde 200 con lista vacía', async () => {
    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('un cliente inexistente es 404 y no lista requisitos', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    const res = await listar();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Cliente no encontrado' } });
    expect(prismaMock.requisitoCliente.findMany).not.toHaveBeenCalled();
  });

  it('un cliente con baja lógica no cumple el where y es el mismo 404', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    const res = await listar();

    expect(res.status).toBe(404);
    expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
      where: { id: CLIENTE, isDeleted: false },
      select: { id: true },
    });
    expect(prismaMock.requisitoCliente.findMany).not.toHaveBeenCalled();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)('consulta un cliente %s', async (estado) => {
    prismaMock.cliente.findFirst.mockResolvedValue({ id: CLIENTE, estado });
    prismaMock.requisitoCliente.findMany.mockResolvedValue([fila()]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
      where: { id: CLIENTE, isDeleted: false },
      select: { id: true },
    });
  });

  it('un requisito cuyo tipo fue desactivado sigue en el listado, con activo false', async () => {
    prismaMock.requisitoCliente.findMany.mockResolvedValue([
      fila({ tipoDocumento: tipo({ activo: false }) }),
    ]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect((res.body as { tipoDocumento: { activo: boolean } }[])[0]?.tipoDocumento.activo).toBe(
      false,
    );
  });
});

describe('POST /clientes/:id/requisitos', () => {
  it('crea una fila nueva con los defaults del schema y marca la matriz en la misma transacción', async () => {
    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaccion.requisitoCliente.findFirst).not.toHaveBeenCalled();
    expect(transaccion.requisitoCliente.create).toHaveBeenCalledWith({
      data: {
        clienteId: CLIENTE,
        tipoDocumentoId: TIPO,
        cantidad: 1,
        diasAproximados: [],
        canalEntrega: null,
        nota: null,
      },
      include: { tipoDocumento: true },
    });
    const data = transaccion.requisitoCliente.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(data.data).not.toHaveProperty('isDeleted');
    expect(data.data).not.toHaveProperty('id');
    expect(transaccion.requisitoCliente.count).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE, isDeleted: false },
    });
    expect(transaccion.cliente.update).toHaveBeenCalledWith({
      where: { id: CLIENTE, isDeleted: false },
      data: { matrizConfigurada: true },
    });
    expect(transaccion.requisitoCliente.create.mock.invocationCallOrder[0]).toBeLessThan(
      transaccion.requisitoCliente.count.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transaccion.requisitoCliente.count.mock.invocationCallOrder[0]).toBeLessThan(
      transaccion.cliente.update.mock.invocationCallOrder[0] ?? 0,
    );
    expect(res.body).toMatchObject({
      id: REQUISITO,
      cantidad: 1,
      diasAproximados: [],
      canalEntrega: null,
      nota: null,
      tipoDocumento: { id: TIPO, nombre: 'Print', activo: true },
    });
  });

  it('guarda los días ordenados y no reescribe el flag si la matriz ya estaba configurada', async () => {
    transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ matrizConfigurada: true }));
    transaccion.requisitoCliente.count.mockResolvedValue(2);

    const res = await crear({
      tipoDocumentoId: TIPO,
      cantidad: 3,
      diasAproximados: [20, 1, 15],
      canalEntrega: 'CORREO',
      nota: '  Prints  ',
    });

    expect(res.status).toBe(201);
    expect(transaccion.requisitoCliente.create).toHaveBeenCalledWith({
      data: {
        clienteId: CLIENTE,
        tipoDocumentoId: TIPO,
        cantidad: 3,
        diasAproximados: [1, 15, 20],
        canalEntrega: 'CORREO',
        nota: 'Prints',
      },
      include: { tipoDocumento: true },
    });
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it('después de una baja del mismo tipo inserta otra fila: no reactiva la anterior', async () => {
    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(201);
    expect(transaccion.requisitoCliente.update).not.toHaveBeenCalled();
    expect(prismaMock.requisitoCliente.findFirst).not.toHaveBeenCalled();
  });

  it('un tipo que no existe es 404 y no inserta', async () => {
    transaccion.tipoDocumento.findUnique.mockResolvedValue(null);

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Tipo de documento no encontrado' },
    });
    expect(transaccion.requisitoCliente.create).not.toHaveBeenCalled();
  });

  it('un tipo inactivo es 400 en tipoDocumentoId y no inserta', async () => {
    transaccion.tipoDocumento.findUnique.mockResolvedValue({ id: TIPO, activo: false });

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['tipoDocumentoId']);
    expect(detalles(res)[0]?.mensaje).toBe('El tipo de documento está inactivo.');
    expect(transaccion.requisitoCliente.create).not.toHaveBeenCalled();
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    'un cliente %s es 409 CLIENTE_NO_ACTIVO y no se reintenta',
    async (estado) => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ estado }));

      const res = await crear(pedidoMinimo);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'El cliente no está activo',
          details: { motivo: 'CLIENTE_NO_ACTIVO', estado },
        },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(transaccion.requisitoCliente.create).not.toHaveBeenCalled();
    },
  );

  it('un cliente borrado es 404', async () => {
    transaccion.cliente.findFirst.mockResolvedValue(null);

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { message: 'Cliente no encontrado' } });
    expect(transaccion.requisitoCliente.create).not.toHaveBeenCalled();
  });

  it.each([
    ['columnas', ['clienteId', 'tipoDocumentoId']],
    ['el nombre del índice', 'uq_requisito_cliente_tipo_activo'],
    ['el nombre del índice dentro de una lista', ['uq_requisito_cliente_tipo_activo']],
  ])('un P2002 con %s es 409 REQUISITO_DUPLICADO', async (_caso, target) => {
    transaccion.requisitoCliente.create.mockRejectedValue(duplicado(target));
    prismaMock.requisitoCliente.findFirst.mockResolvedValue({
      id: REQUISITO,
      tipoDocumentoId: TIPO,
      cantidad: 3,
    });

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'El cliente ya tiene un requisito para ese tipo de documento',
        details: {
          motivo: 'REQUISITO_DUPLICADO',
          requisitoExistente: { id: REQUISITO, tipoDocumentoId: TIPO, cantidad: 3 },
        },
      },
    });
    expect(prismaMock.requisitoCliente.findFirst).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE, tipoDocumentoId: TIPO, isDeleted: false },
      select: { id: true, tipoDocumentoId: true, cantidad: true },
    });
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it.each([
    ['el CUIT', ['cuit']],
    ['el email de un contacto', ['clienteId', 'email']],
  ])('un P2002 de %s no es REQUISITO_DUPLICADO: sigue siendo 500', async (_caso, target) => {
    const espia = silenciarConsoleError();
    transaccion.requisitoCliente.create.mockRejectedValue(duplicado(target));

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
    });
    expect(prismaMock.requisitoCliente.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(espia.mock.calls)).not.toContain('cuit');
  });

  it('si el duplicado ya no está al ir a buscarlo, reintenta el alta', async () => {
    let intentos = 0;
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) => {
      intentos += 1;
      if (intentos === 1) throw duplicado(['clienteId', 'tipoDocumentoId']);
      return callback(transaccion);
    });
    prismaMock.requisitoCliente.findFirst.mockResolvedValue(null);

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('reintenta un P2034 y, si el segundo intento cierra, responde 201', async () => {
    let intentos = 0;
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) => {
      intentos += 1;
      if (intentos === 1) throw errorPrisma('P2034');
      return callback(transaccion);
    });

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('agotados 3 P2034 responde 500, sin inventar un 409', async () => {
    silenciarConsoleError();
    prismaMock.$transaction.mockRejectedValue(errorPrisma('P2034'));
    prismaMock.requisitoCliente.findFirst.mockResolvedValue(null);

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(prismaMock.requisitoCliente.findFirst).toHaveBeenCalledTimes(1);
  });

  it('agotados los P2034, si el duplicado ya quedó confirmado, responde 409', async () => {
    prismaMock.$transaction.mockRejectedValue(errorPrisma('P2034'));
    prismaMock.requisitoCliente.findFirst.mockResolvedValue({
      id: REQUISITO,
      tipoDocumentoId: TIPO,
      cantidad: 3,
    });

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'El cliente ya tiene un requisito para ese tipo de documento',
        details: {
          motivo: 'REQUISITO_DUPLICADO',
          requisitoExistente: { id: REQUISITO, tipoDocumentoId: TIPO, cantidad: 3 },
        },
      },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });

  it('un CHECK de días nombrado por Prisma es 400 en diasAproximados', async () => {
    transaccion.requisitoCliente.create.mockRejectedValue(
      errorPrisma('P2004', {
        database_error: 'new row violates check constraint "ck_requisito_dias_coherentes"',
      }),
    );

    // El pedido es válido para el schema: el 400 sale de la traducción del CHECK, no de Zod.
    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['diasAproximados']);
  });

  it('un CHECK de cantidad informado como error desconocido es 400 en cantidad', async () => {
    transaccion.requisitoCliente.create.mockRejectedValue(
      errorDesconocido('check constraint "ck_requisito_cantidad_positiva"'),
    );

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['cantidad']);
  });

  it('ck_requisito_baja_logica no se traduce a 400', async () => {
    silenciarConsoleError();
    transaccion.requisitoCliente.create.mockRejectedValue(
      errorPrisma('P2004', { database_error: 'ck_requisito_baja_logica' }),
    );

    const res = await crear(pedidoMinimo);

    expect(res.status).toBe(500);
  });

  it('una FK del tipo es 404 y una FK de otra tabla sigue siendo 500', async () => {
    transaccion.requisitoCliente.create.mockRejectedValueOnce(
      errorPrisma('P2003', { field_name: 'RequisitoCliente_tipoDocumentoId_fkey (index)' }),
    );

    const primero = await crear(pedidoMinimo);

    expect(primero.status).toBe(404);
    expect(primero.body).toMatchObject({
      error: { message: 'Tipo de documento no encontrado' },
    });

    silenciarConsoleError();
    transaccion.requisitoCliente.create.mockRejectedValueOnce(
      errorPrisma('P2003', { field_name: 'ItemChecklist_rendicionId_fkey' }),
    );

    const segundo = await crear(pedidoMinimo);

    expect(segundo.status).toBe(500);
  });

  it.each([
    ['sin tipo', {}, 'tipoDocumentoId'],
    ['cantidad 0', { tipoDocumentoId: TIPO, cantidad: 0 }, 'cantidad'],
    ['cantidad 32 (más de una por día)', { tipoDocumentoId: TIPO, cantidad: 32 }, 'cantidad'],
    [
      'días que no coinciden con la cantidad',
      { tipoDocumentoId: TIPO, cantidad: 2, diasAproximados: [1] },
      'diasAproximados',
    ],
  ])('responde 400 por %s, sin abrir transacción', async (_caso, body, campo) => {
    const res = await crear(body);

    expect(res.status).toBe(400);
    expect(campos(res)).toContain(campo);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('PATCH /clientes/:id/requisitos/:requisitoId', () => {
  it('cambia solo la nota y no toca el flag ni el tipo', async () => {
    const res = await editar({ nota: 'Otra nota', tipoDocumentoId: TIPO });

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaccion.requisitoCliente.update).toHaveBeenCalledWith({
      where: { id: REQUISITO, clienteId: CLIENTE, isDeleted: false },
      data: { nota: 'Otra nota' },
      include: { tipoDocumento: true },
    });
    expect(transaccion.requisitoCliente.findFirst).not.toHaveBeenCalled();
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
    expect(transaccion.requisitoCliente.count).not.toHaveBeenCalled();
  });

  it('nota null y canal null se guardan', async () => {
    const res = await editar({ nota: null, canalEntrega: null });

    expect(res.status).toBe(200);
    expect(transaccion.requisitoCliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nota: null, canalEntrega: null } }),
    );
  });

  it('cambiar la cantidad cuando no hay días guardados es válido', async () => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue(
      fila({ diasAproximados: [], cantidad: 1 }),
    );

    const res = await editar({ cantidad: 4 });

    expect(res.status).toBe(200);
    expect(transaccion.requisitoCliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cantidad: 4 } }),
    );
  });

  it('cambiar la cantidad sin mandar los días, si ya había días, es 400 y no escribe', async () => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue(
      fila({ cantidad: 3, diasAproximados: [1, 10, 20] }),
    );

    const res = await editar({ cantidad: 2 });

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['diasAproximados']);
    expect(detalles(res)[0]?.mensaje).toBe(problemaDeDias(2, [1, 10, 20]));
    expect(transaccion.requisitoCliente.update).not.toHaveBeenCalled();
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it('cantidad y días juntos se validan sobre el pedido y no leen la fila para eso', async () => {
    const res = await editar({ cantidad: 2, diasAproximados: [8, 2] });

    expect(res.status).toBe(200);
    expect(transaccion.requisitoCliente.findFirst).not.toHaveBeenCalled();
    expect(transaccion.requisitoCliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cantidad: 2, diasAproximados: [2, 8] } }),
    );
  });

  it('un pedido vacío es 400 y no abre transacción', async () => {
    const res = await editar({});

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['body']);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('mandar solo el tipo es 400: el schema lo descarta y el pedido queda vacío', async () => {
    const res = await editar({ tipoDocumentoId: TIPO });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('un requisito de otro cliente, o ya dado de baja, es 404', async () => {
    transaccion.requisitoCliente.update.mockRejectedValue(errorPrisma('P2025'));

    const res = await editar({ nota: 'Otra nota' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Requisito no encontrado' } });
    expect(transaccion.requisitoCliente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: REQUISITO, clienteId: CLIENTE, isDeleted: false },
      }),
    );
  });

  it('edita un requisito cuyo tipo ya está inactivo', async () => {
    transaccion.requisitoCliente.update.mockResolvedValue(
      fila({ nota: 'Sigue', tipoDocumento: tipo({ activo: false }), updatedAt: DESPUES }),
    );

    const res = await editar({ nota: 'Sigue' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nota: 'Sigue',
      tipoDocumento: { id: TIPO, nombre: 'Print', activo: false },
    });
    expect(transaccion.tipoDocumento.findUnique).not.toHaveBeenCalled();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    'un cliente %s es 409 y no actualiza',
    async (estado) => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ estado }));

      const res = await editar({ nota: 'Otra nota' });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { details: { motivo: 'CLIENTE_NO_ACTIVO', estado } },
      });
      expect(transaccion.requisitoCliente.update).not.toHaveBeenCalled();
    },
  );

  it('un P2002 durante la edición no se traduce a REQUISITO_DUPLICADO', async () => {
    silenciarConsoleError();
    transaccion.requisitoCliente.update.mockRejectedValue(
      duplicado(['clienteId', 'tipoDocumentoId']),
    );

    const res = await editar({ nota: 'Otra nota' });

    expect(res.status).toBe(500);
    expect(prismaMock.requisitoCliente.findFirst).not.toHaveBeenCalled();
  });

  it('reintenta un P2034 y responde 200 al segundo intento', async () => {
    let intentos = 0;
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) => {
      intentos += 1;
      if (intentos === 1) throw errorPrisma('P2034');
      return callback(transaccion);
    });

    const res = await editar({ nota: 'Otra nota' });

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('DELETE /clientes/:id/requisitos/:requisitoId', () => {
  it('da de baja la fila, no la borra, y no mueve el flag si quedan requisitos', async () => {
    transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ matrizConfigurada: true }));
    transaccion.requisitoCliente.count.mockResolvedValue(1);

    const res = await borrar();

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaccion.requisitoCliente.update).toHaveBeenCalledWith({
      where: { id: REQUISITO, clienteId: CLIENTE, isDeleted: false },
      data: { isDeleted: true, deletedAt: expect.any(Date) as unknown },
    });
    expect(transaccion.requisitoCliente.update.mock.invocationCallOrder[0]).toBeLessThan(
      transaccion.requisitoCliente.count.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it('al dar de baja el último requisito, el flag vuelve a false', async () => {
    transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ matrizConfigurada: true }));
    transaccion.requisitoCliente.count.mockResolvedValue(0);

    const res = await borrar();

    expect(res.status).toBe(204);
    expect(transaccion.cliente.update).toHaveBeenCalledWith({
      where: { id: CLIENTE, isDeleted: false },
      data: { matrizConfigurada: false },
    });
    expect(transaccion.requisitoCliente.count.mock.invocationCallOrder[0]).toBeLessThan(
      transaccion.cliente.update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('no escribe el cliente si el flag ya era false', async () => {
    transaccion.requisitoCliente.count.mockResolvedValue(0);

    const res = await borrar();

    expect(res.status).toBe(204);
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it('borrar de nuevo un requisito ya dado de baja es 404 y no recalcula el flag', async () => {
    transaccion.requisitoCliente.update.mockRejectedValue(errorPrisma('P2025'));

    const res = await borrar();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Requisito no encontrado' } });
    expect(transaccion.requisitoCliente.count).not.toHaveBeenCalled();
    expect(transaccion.cliente.update).not.toHaveBeenCalled();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'] as const)(
    'un cliente %s es 409 y no da de baja',
    async (estado) => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ estado }));

      const res = await borrar();

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        error: { details: { motivo: 'CLIENTE_NO_ACTIVO', estado } },
      });
      expect(transaccion.requisitoCliente.update).not.toHaveBeenCalled();
    },
  );

  it('reintenta un P2034 y responde 204 al segundo intento', async () => {
    let intentos = 0;
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) => {
      intentos += 1;
      if (intentos === 1) throw errorPrisma('P2034');
      return callback(transaccion);
    });

    const res = await borrar();

    expect(res.status).toBe(204);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('agotados 3 P2034 responde 500', async () => {
    silenciarConsoleError();
    prismaMock.$transaction.mockRejectedValue(errorPrisma('P2034'));

    const res = await borrar();

    expect(res.status).toBe(500);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
  });
});
