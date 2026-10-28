import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// `POST /rendiciones/:id/requisitos/:requisitoId` (contrato 4.5), con la base simulada: se
// recorre route → validate → controller → service → mapper → errorHandler.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  });
  const transaccion = {
    rendicion: delegado(),
    requisitoCliente: delegado(),
    itemChecklist: delegado(),
  };
  const prismaMock = { $transaction: vi.fn() };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const REQUISITO = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const TIPO = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const AHORA = new Date('2026-10-15T15:00:00.000Z');

const rendicionDe = (extra: Record<string, unknown> = {}) => ({
  id: RENDICION,
  clienteId: CLIENTE,
  isDeleted: false,
  cliente: { estado: 'ACTIVO', canalEntrega: 'CORREO' },
  ...extra,
});

/** Print x3 con días y sin canal propio. */
const requisitoDe = (extra: Record<string, unknown> = {}) => ({
  id: REQUISITO,
  clienteId: CLIENTE,
  tipoDocumentoId: TIPO,
  tipoDocumento: { nombre: 'Print' },
  cantidad: 3,
  diasAproximados: [1, 10, 20],
  canalEntrega: null,
  nota: null,
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
  ...extra,
});

/** Un ítem que la rendición ya tenía (Factura) y que no se tiene que tocar. */
const ITEM_EXISTENTE = {
  id: 'f1a2b3c4-d5e6-4789-8abc-def012345600',
  rendicionId: RENDICION,
  requisitoClienteId: 'd1e2f3a4-b5c6-4789-8abc-def012345601',
  tipoDocumentoId: 'c1d2e3f4-a5b6-4789-8abc-def012345601',
  nombreTipoDocumento: 'Factura',
  ordinal: 1,
  totalOrdinal: 1,
  diaAproximado: null,
  canalEntrega: 'PORTAL_WEB',
  completado: true,
  completadoAt: AHORA,
  createdAt: AHORA,
  updatedAt: AHORA,
};

function errorPrisma(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    ...(meta === undefined ? {} : { meta }),
  });
}

const sumar = (rendicionId = RENDICION, requisitoId = REQUISITO) =>
  request(app).post(`/rendiciones/${rendicionId}/requisitos/${requisitoId}`);

const detalles = (res: request.Response) =>
  (res.body as { error: { details: unknown } }).error.details;

/** Los ítems que recibió `createMany`. */
const itemsCreados = () =>
  (transaccion.itemChecklist.createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }])[0]
    .data;

beforeEach(() => {
  transaccion.rendicion.findFirst.mockResolvedValue(rendicionDe());
  transaccion.requisitoCliente.findFirst.mockResolvedValue(requisitoDe());
  transaccion.itemChecklist.findFirst.mockResolvedValue(null);
  transaccion.itemChecklist.createMany.mockResolvedValue({ count: 3 });
  // Después de sumar, la base devuelve los ítems viejos más los nuevos.
  transaccion.rendicion.findUniqueOrThrow.mockImplementation(() =>
    Promise.resolve({
      id: RENDICION,
      clienteId: CLIENTE,
      anio: 2026,
      mes: 10,
      numeroFactura: 'A 00001-00000001',
      isDeleted: false,
      deletedAt: null,
      createdAt: AHORA,
      updatedAt: AHORA,
      items: [
        ITEM_EXISTENTE,
        ...itemsCreados().map((item, indice) => ({
          id: `f1a2b3c4-d5e6-4789-8abc-def01234567${indice}`,
          completado: false,
          completadoAt: null,
          createdAt: AHORA,
          updatedAt: AHORA,
          ...item,
        })),
      ],
    }),
  );
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('POST /rendiciones/:id/requisitos/:requisitoId', () => {
  it('suma un ítem por unidad de cantidad, con su ordinal, su día y el canal efectivo', async () => {
    const res = await sumar();

    expect(res.status).toBe(200);
    expect(itemsCreados()).toEqual(
      [1, 2, 3].map((ordinal) => ({
        rendicionId: RENDICION,
        requisitoClienteId: REQUISITO,
        tipoDocumentoId: TIPO,
        nombreTipoDocumento: 'Print',
        ordinal,
        totalOrdinal: 3,
        diaAproximado: [1, 10, 20][ordinal - 1],
        canalEntrega: 'CORREO',
      })),
    );
    expect((res.body as { items: unknown[] }).items).toHaveLength(4);
  });

  it('con canal propio, el ítem lleva el del requisito', async () => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue(
      requisitoDe({ cantidad: 1, diasAproximados: [], canalEntrega: 'WHATSAPP' }),
    );

    await sumar();

    expect(itemsCreados()).toEqual([
      expect.objectContaining({
        ordinal: 1,
        totalOrdinal: 1,
        diaAproximado: null,
        canalEntrega: 'WHATSAPP',
      }),
    ]);
  });

  it('no modifica ni borra los ítems que la rendición ya tenía', async () => {
    const res = await sumar();

    expect(transaccion.itemChecklist.update).not.toHaveBeenCalled();
    expect(transaccion.itemChecklist.deleteMany).not.toHaveBeenCalled();
    expect((res.body as { items: { id: string; completado: boolean }[] }).items[0]).toMatchObject({
      id: ITEM_EXISTENTE.id,
      completado: true,
    });
  });

  it('corre en una transacción serializable', async () => {
    await sumar();

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('409 REQUISITO_YA_EN_RENDICION si la rendición ya tiene ítems de ese tipo de documento', async () => {
    transaccion.itemChecklist.findFirst.mockResolvedValue({ id: ITEM_EXISTENTE.id });

    const res = await sumar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'REQUISITO_YA_EN_RENDICION' });
    expect(transaccion.itemChecklist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rendicionId: RENDICION, tipoDocumentoId: TIPO } }),
    );
    expect(transaccion.itemChecklist.createMany).not.toHaveBeenCalled();
  });

  it('409 REQUISITO_YA_EN_RENDICION si la base rechaza el ítem repetido (dos pedidos a la vez)', async () => {
    transaccion.itemChecklist.createMany.mockRejectedValue(
      errorPrisma('P2002', { target: ['rendicionId', 'requisitoClienteId', 'ordinal'] }),
    );

    const res = await sumar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'REQUISITO_YA_EN_RENDICION' });
  });

  it('409 RENDICION_ANULADA con una rendición anulada', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue(rendicionDe({ isDeleted: true }));

    const res = await sumar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.itemChecklist.createMany).not.toHaveBeenCalled();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'])('409 CLIENTE_NO_ACTIVO con el cliente %s', async (estado) => {
    transaccion.rendicion.findFirst.mockResolvedValue(
      rendicionDe({ cliente: { estado, canalEntrega: 'CORREO' } }),
    );

    const res = await sumar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'CLIENTE_NO_ACTIVO', estado });
    expect(transaccion.itemChecklist.createMany).not.toHaveBeenCalled();
  });

  it('404 si la rendición no existe o su cliente está borrado', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue(null);

    const res = await sumar();

    expect(res.status).toBe(404);
    expect(transaccion.rendicion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RENDICION, cliente: { isDeleted: false } } }),
    );
  });

  it('404 si el requisito no existe, está dado de baja o es de otro cliente', async () => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue(null);

    const res = await sumar();

    expect(res.status).toBe(404);
    expect(transaccion.requisitoCliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: REQUISITO, clienteId: CLIENTE, isDeleted: false } }),
    );
    expect(transaccion.itemChecklist.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['la rendición', 'no-es-uuid', REQUISITO, 'id'],
    ['el requisito', RENDICION, 'no-es-uuid', 'requisitoId'],
  ])('400 si %s no es un uuid', async (_caso, rendicionId, requisitoId, campo) => {
    const res = await sumar(rendicionId, requisitoId);

    expect(res.status).toBe(400);
    expect((detalles(res) as { campo: string }[]).map((detalle) => detalle.campo)).toEqual([campo]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
