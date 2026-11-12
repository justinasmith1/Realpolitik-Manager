import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// `POST /clientes/:id/requisitos/:requisitoId/propagar-canal` (contrato 4.5), con la base
// simulada: se recorre route → validate → controller → service → errorHandler.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const transaccion = {
    cliente: { findFirst: vi.fn() },
    requisitoCliente: { findFirst: vi.fn(), update: vi.fn() },
    rendicion: { findMany: vi.fn(), update: vi.fn() },
    itemChecklist: { groupBy: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  };
  const prismaMock = { $transaction: vi.fn() };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const REQUISITO = 'd1e2f3a4-b5c6-4789-8abc-def012345601';
const UNA = 'e1f2a3b4-c5d6-4789-8abc-def012345671';
const OTRA = 'e1f2a3b4-c5d6-4789-8abc-def012345672';

const propagar = (cuerpo: unknown, clienteId = CLIENTE, requisitoId = REQUISITO) =>
  request(app)
    .post(`/clientes/${clienteId}/requisitos/${requisitoId}/propagar-canal`)
    .send(cuerpo as object);

const detalles = (res: request.Response) =>
  (res.body as { error: { details: unknown } }).error.details;

beforeEach(() => {
  transaccion.cliente.findFirst.mockResolvedValue({ canalEntrega: 'CORREO' });
  transaccion.requisitoCliente.findFirst.mockResolvedValue({ canalEntrega: 'PORTAL_WEB' });
  transaccion.rendicion.findMany.mockResolvedValue([
    { id: UNA, isDeleted: false },
    { id: OTRA, isDeleted: false },
  ]);
  transaccion.itemChecklist.groupBy.mockResolvedValue([
    { rendicionId: UNA },
    { rendicionId: OTRA },
  ]);
  transaccion.itemChecklist.updateMany.mockResolvedValue({ count: 3 });
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('POST /clientes/:id/requisitos/:requisitoId/propagar-canal', () => {
  it('pasa los ítems del requisito al canal propio en cada rendición y cuenta los cambiados', async () => {
    transaccion.itemChecklist.updateMany
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 });

    const res = await propagar({ rendicionIds: [UNA, OTRA] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      canalEntrega: 'PORTAL_WEB',
      rendiciones: [
        { rendicionId: UNA, itemsActualizados: 3 },
        { rendicionId: OTRA, itemsActualizados: 1 },
      ],
    });
    expect(
      transaccion.itemChecklist.updateMany.mock.calls.map(([args]: unknown[]) => args),
    ).toEqual(
      [UNA, OTRA].map((rendicionId) => ({
        where: { rendicionId, requisitoClienteId: REQUISITO, canalEntrega: { not: 'PORTAL_WEB' } },
        data: { canalEntrega: 'PORTAL_WEB' },
      })),
    );
  });

  it('si el requisito hereda, usa el canal del cliente', async () => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue({ canalEntrega: null });

    const res = await propagar({ rendicionIds: [UNA] });

    expect(res.status).toBe(200);
    expect((res.body as { canalEntrega: string }).canalEntrega).toBe('CORREO');
    expect(transaccion.itemChecklist.updateMany).toHaveBeenCalledWith({
      where: { rendicionId: UNA, requisitoClienteId: REQUISITO, canalEntrega: { not: 'CORREO' } },
      data: { canalEntrega: 'CORREO' },
    });
  });

  it('solo escribe el canal de esos ítems: no toca el requisito, la rendición ni otros datos', async () => {
    await propagar({ rendicionIds: [UNA], canalEntrega: 'WHATSAPP' });

    const [[args]] = transaccion.itemChecklist.updateMany.mock.calls as [[{ data: unknown }]];
    expect(args.data).toEqual({ canalEntrega: 'PORTAL_WEB' });
    expect(transaccion.requisitoCliente.update).not.toHaveBeenCalled();
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
    expect(transaccion.itemChecklist.update).not.toHaveBeenCalled();
  });

  it('corre en una transacción serializable', async () => {
    await propagar({ rendicionIds: [UNA] });

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('busca las rendiciones solo entre las del cliente', async () => {
    await propagar({ rendicionIds: [UNA, OTRA] });

    expect(transaccion.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [UNA, OTRA] }, clienteId: CLIENTE } }),
    );
  });

  it('404 si una rendición no existe o es de otro cliente, sin escribir', async () => {
    transaccion.rendicion.findMany.mockResolvedValue([{ id: UNA, isDeleted: false }]);

    const res = await propagar({ rendicionIds: [UNA, OTRA] });

    expect(res.status).toBe(404);
    expect(transaccion.itemChecklist.updateMany).not.toHaveBeenCalled();
  });

  it('409 RENDICION_ANULADA con el id de la anulada, sin escribir en ninguna', async () => {
    transaccion.rendicion.findMany.mockResolvedValue([
      { id: UNA, isDeleted: false },
      { id: OTRA, isDeleted: true },
    ]);

    const res = await propagar({ rendicionIds: [UNA, OTRA] });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA', rendicionId: OTRA });
    expect(transaccion.itemChecklist.updateMany).not.toHaveBeenCalled();
  });

  it('409 REQUISITO_NO_EN_RENDICION si una no tiene ítems del requisito, sin escribir', async () => {
    transaccion.itemChecklist.groupBy.mockResolvedValue([{ rendicionId: OTRA }]);

    const res = await propagar({ rendicionIds: [UNA, OTRA] });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'REQUISITO_NO_EN_RENDICION', rendicionId: UNA });
    expect(transaccion.itemChecklist.groupBy).toHaveBeenCalledWith({
      by: ['rendicionId'],
      where: { rendicionId: { in: [UNA, OTRA] }, requisitoClienteId: REQUISITO },
    });
    expect(transaccion.itemChecklist.updateMany).not.toHaveBeenCalled();
  });

  it('404 si el cliente no existe o está borrado', async () => {
    transaccion.cliente.findFirst.mockResolvedValue(null);

    const res = await propagar({ rendicionIds: [UNA] });

    expect(res.status).toBe(404);
    expect(transaccion.rendicion.findMany).not.toHaveBeenCalled();
  });

  it('404 si el requisito no es del cliente o está dado de baja', async () => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue(null);

    const res = await propagar({ rendicionIds: [UNA] });

    expect(res.status).toBe(404);
    expect(transaccion.requisitoCliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: REQUISITO, clienteId: CLIENTE, isDeleted: false } }),
    );
    expect(transaccion.itemChecklist.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['sin rendiciones', { rendicionIds: [] }],
    ['con una rendición repetida', { rendicionIds: [UNA, UNA] }],
    ['con un id que no es uuid', { rendicionIds: ['no-es-uuid'] }],
    ['sin el campo', {}],
  ])('400 %s', async (_caso, cuerpo) => {
    const res = await propagar(cuerpo);

    expect(res.status).toBe(400);
    expect((detalles(res) as { campo: string }[])[0]?.campo).toMatch(/^rendicionIds/);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['el cliente', 'no-es-uuid', REQUISITO, 'id'],
    ['el requisito', CLIENTE, 'no-es-uuid', 'requisitoId'],
  ])('400 si %s no es un uuid', async (_caso, clienteId, requisitoId, campo) => {
    const res = await propagar({ rendicionIds: [UNA] }, clienteId, requisitoId);

    expect(res.status).toBe(400);
    expect((detalles(res) as { campo: string }[]).map((d) => d.campo)).toEqual([campo]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
