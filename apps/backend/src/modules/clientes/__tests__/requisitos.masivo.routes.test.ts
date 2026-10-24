import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Carga masiva (HU2.3): la base está simulada y se recorre route → validate → controller →
// service → errorHandler. El mock no puede demostrar el índice parcial ni el aislamiento real
// (eso lo hace requisitos.masivo.integration.test.ts); sí el orden, los argumentos y las
// respuestas.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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

const TIPO = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const A = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const B = 'b2c3d4e5-f6a7-4890-bcde-f01234567890';
const C = 'c3d4e5f6-a7b8-4901-8cde-f12345678901';

const masivo = (body: object) => request(app).post('/requisitos/masivo').send(body);

const clienteDe = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
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

const campos = (res: request.Response) =>
  (res.body as { error: { details: { campo: string }[] } }).error.details.map((d) => d.campo);

beforeEach(() => {
  transaccion.tipoDocumento.findUnique.mockResolvedValue({ id: TIPO, activo: true });
  transaccion.cliente.findMany.mockResolvedValue([clienteDe(A), clienteDe(B)]);
  transaccion.requisitoCliente.findMany.mockResolvedValue([]);
  transaccion.requisitoCliente.createMany.mockResolvedValue({ count: 0 });
  transaccion.cliente.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof transaccion) => unknown) =>
    callback(transaccion),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('POST /requisitos/masivo: validación', () => {
  it.each([
    ['sin tipoDocumentoId', { clientes: [{ clienteId: A }] }, 'tipoDocumentoId'],
    ['clientes vacío', { tipoDocumentoId: TIPO, clientes: [] }, 'clientes'],
    ['sin clientes', { tipoDocumentoId: TIPO }, 'clientes'],
    [
      'clienteId que no es uuid',
      { tipoDocumentoId: TIPO, clientes: [{ clienteId: 'x' }] },
      'clientes.0.clienteId',
    ],
    [
      'cliente repetido',
      { tipoDocumentoId: TIPO, clientes: [{ clienteId: A }, { clienteId: A }] },
      'clientes.0.clienteId',
    ],
    [
      'días que no coinciden con la cantidad',
      { tipoDocumentoId: TIPO, clientes: [{ clienteId: A, cantidad: 3, diasAproximados: [1, 2] }] },
      'clientes.0.diasAproximados',
    ],
  ])('%s responde 400 y no toca la base', async (_caso, body, campo) => {
    const res = await masivo(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(campos(res)).toContain(campo);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /requisitos/masivo: carga', () => {
  it('crea el requisito en cada cliente activo y marca matrizConfigurada en la misma transacción', async () => {
    const res = await masivo({
      tipoDocumentoId: TIPO,
      canalEntrega: 'PORTAL_WEB',
      nota: 'Del mes',
      clientes: [{ clienteId: A }, { clienteId: B, cantidad: 2, diasAproximados: [5, 20] }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ creados: [A, B], omitidos: [] });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(transaccion.requisitoCliente.createMany).toHaveBeenCalledWith({
      data: [
        {
          clienteId: A,
          cantidad: 1,
          diasAproximados: [],
          tipoDocumentoId: TIPO,
          canalEntrega: 'PORTAL_WEB',
          nota: 'Del mes',
        },
        {
          clienteId: B,
          cantidad: 2,
          diasAproximados: [5, 20],
          tipoDocumentoId: TIPO,
          canalEntrega: 'PORTAL_WEB',
          nota: 'Del mes',
        },
      ],
    });
    expect(transaccion.cliente.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A, B] }, isDeleted: false, matrizConfigurada: false },
      data: { matrizConfigurada: true },
    });
  });

  it('canal y nota ausentes quedan en null', async () => {
    await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    const { data } = transaccion.requisitoCliente.createMany.mock.calls[0]?.[0] as {
      data: { canalEntrega: unknown; nota: unknown }[];
    };
    expect(data[0]).toMatchObject({ canalEntrega: null, nota: null });
  });

  it('omite a un cliente no activo con CLIENTE_NO_ACTIVO y no le escribe nada', async () => {
    transaccion.cliente.findMany.mockResolvedValue([
      clienteDe(A),
      clienteDe(B, { estado: 'SUSPENDIDO' }),
      clienteDe(C, { estado: 'INACTIVO' }),
    ]);

    const res = await masivo({
      tipoDocumentoId: TIPO,
      clientes: [{ clienteId: A }, { clienteId: B }, { clienteId: C }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      creados: [A],
      omitidos: [
        { clienteId: B, motivo: 'CLIENTE_NO_ACTIVO' },
        { clienteId: C, motivo: 'CLIENTE_NO_ACTIVO' },
      ],
    });
    const { data } = transaccion.requisitoCliente.createMany.mock.calls[0]?.[0] as {
      data: { clienteId: string }[];
    };
    expect(data.map((fila) => fila.clienteId)).toEqual([A]);
    expect(transaccion.cliente.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [A] }, isDeleted: false, matrizConfigurada: false },
      data: { matrizConfigurada: true },
    });
  });

  it('omite a un cliente que ya tiene el tipo activo con REQUISITO_DUPLICADO', async () => {
    transaccion.requisitoCliente.findMany.mockResolvedValue([{ clienteId: B }]);

    const res = await masivo({
      tipoDocumentoId: TIPO,
      clientes: [{ clienteId: A }, { clienteId: B }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      creados: [A],
      omitidos: [{ clienteId: B, motivo: 'REQUISITO_DUPLICADO' }],
    });
    expect(transaccion.requisitoCliente.findMany).toHaveBeenCalledWith({
      where: { tipoDocumentoId: TIPO, clienteId: { in: [A, B] }, isDeleted: false },
      select: { clienteId: true },
    });
  });

  it('si todos se omiten responde 200 y no inserta ni actualiza', async () => {
    transaccion.cliente.findMany.mockResolvedValue([clienteDe(A, { estado: 'INACTIVO' })]);

    const res = await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      creados: [],
      omitidos: [{ clienteId: A, motivo: 'CLIENTE_NO_ACTIVO' }],
    });
    expect(transaccion.requisitoCliente.createMany).not.toHaveBeenCalled();
    expect(transaccion.cliente.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /requisitos/masivo: errores', () => {
  it('un tipo inexistente es 404 y no inserta', async () => {
    transaccion.tipoDocumento.findUnique.mockResolvedValue(null);

    const res = await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    expect(res.status).toBe(404);
    expect(transaccion.requisitoCliente.createMany).not.toHaveBeenCalled();
  });

  it('un tipo inactivo es 400', async () => {
    transaccion.tipoDocumento.findUnique.mockResolvedValue({ id: TIPO, activo: false });

    const res = await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['tipoDocumentoId']);
    expect(transaccion.requisitoCliente.createMany).not.toHaveBeenCalled();
  });

  it('un cliente inexistente o borrado es 404 y no se crea nada', async () => {
    transaccion.cliente.findMany.mockResolvedValue([clienteDe(A)]);

    const res = await masivo({
      tipoDocumentoId: TIPO,
      clientes: [{ clienteId: A }, { clienteId: B }],
    });

    expect(res.status).toBe(404);
    expect(transaccion.requisitoCliente.createMany).not.toHaveBeenCalled();
    expect(transaccion.cliente.updateMany).not.toHaveBeenCalled();
  });

  it('una carrera con el índice parcial (P2002) se reintenta y el duplicado se omite', async () => {
    transaccion.requisitoCliente.createMany.mockRejectedValueOnce(
      errorPrisma('P2002', { target: ['clienteId', 'tipoDocumentoId'] }),
    );
    transaccion.requisitoCliente.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ clienteId: A }]);
    transaccion.cliente.findMany.mockResolvedValue([clienteDe(A)]);

    const res = await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      creados: [],
      omitidos: [{ clienteId: A, motivo: 'REQUISITO_DUPLICADO' }],
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('un P2002 de otro índice no se reintenta: es 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    transaccion.requisitoCliente.createMany.mockRejectedValue(
      errorPrisma('P2002', { target: ['cuit'] }),
    );

    const res = await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    expect(res.status).toBe(500);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('un P2003 sobre la FK del cliente es 404', async () => {
    transaccion.requisitoCliente.createMany.mockRejectedValue(
      errorPrisma('P2003', { field_name: 'RequisitoCliente_clienteId_fkey (index)' }),
    );

    const res = await masivo({ tipoDocumentoId: TIPO, clientes: [{ clienteId: A }] });

    expect(res.status).toBe(404);
  });
});
