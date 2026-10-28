import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// `PATCH /rendiciones/:id/items/:itemId/canal` (contrato 4.5), con la base simulada: se recorre
// route → validate → controller → service → mapper → errorHandler.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  });
  const transaccion = {
    rendicion: delegado(),
    itemChecklist: delegado(),
    requisitoCliente: delegado(),
  };
  const prismaMock = { $transaction: vi.fn() };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const ITEM = 'f1a2b3c4-d5e6-4789-8abc-def012345600';
const AHORA = new Date('2026-10-15T15:00:00.000Z');

const itemDe = (canalEntrega: string) => ({
  id: ITEM,
  rendicionId: RENDICION,
  requisitoClienteId: 'd1e2f3a4-b5c6-4789-8abc-def012345601',
  tipoDocumentoId: 'c1d2e3f4-a5b6-4789-8abc-def012345601',
  nombreTipoDocumento: 'Factura',
  ordinal: 1,
  totalOrdinal: 1,
  diaAproximado: null,
  canalEntrega,
  completado: false,
  completadoAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
});

const rendicionCon = (canalEntrega: string) => ({
  id: RENDICION,
  clienteId: CLIENTE,
  anio: 2026,
  mes: 10,
  numeroFactura: 'A 00001-00000001',
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
  items: [itemDe(canalEntrega)],
});

const corregir = (cuerpo: unknown, rendicionId = RENDICION, itemId = ITEM) =>
  request(app)
    .patch(`/rendiciones/${rendicionId}/items/${itemId}/canal`)
    .send(cuerpo as object);

const detalles = (res: request.Response) =>
  (res.body as { error: { details: unknown } }).error.details;

beforeEach(() => {
  transaccion.rendicion.findFirst.mockResolvedValue({ id: RENDICION, isDeleted: false });
  transaccion.itemChecklist.findFirst.mockResolvedValue({ id: ITEM, canalEntrega: 'CORREO' });
  transaccion.itemChecklist.update.mockResolvedValue({});
  transaccion.rendicion.findUniqueOrThrow.mockResolvedValue(rendicionCon('PORTAL_WEB'));
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('PATCH /rendiciones/:id/items/:itemId/canal', () => {
  it('cambia el canal del ítem y devuelve el detalle actualizado', async () => {
    const res = await corregir({ canalEntrega: 'PORTAL_WEB' });

    expect(res.status).toBe(200);
    expect(transaccion.itemChecklist.update).toHaveBeenCalledWith({
      where: { id: ITEM },
      data: { canalEntrega: 'PORTAL_WEB' },
    });
    expect(res.body).toMatchObject({
      id: RENDICION,
      estado: 'ACTIVA',
      items: [{ id: ITEM, canalEntrega: 'PORTAL_WEB' }],
    });
  });

  it('solo escribe el canal: no toca el requisito ni otros datos del ítem', async () => {
    await corregir({ canalEntrega: 'PORTAL_WEB', diaAproximado: 9, ordinal: 3 });

    expect(transaccion.itemChecklist.update).toHaveBeenCalledTimes(1);
    expect(transaccion.itemChecklist.update.mock.calls[0]?.[0]).toEqual({
      where: { id: ITEM },
      data: { canalEntrega: 'PORTAL_WEB' },
    });
    expect(transaccion.requisitoCliente.findFirst).not.toHaveBeenCalled();
    expect(transaccion.itemChecklist.updateMany).not.toHaveBeenCalled();
  });

  it('con el mismo canal responde 200 sin escribir (idempotente)', async () => {
    transaccion.rendicion.findUniqueOrThrow.mockResolvedValue(rendicionCon('CORREO'));

    const res = await corregir({ canalEntrega: 'CORREO' });

    expect(res.status).toBe(200);
    expect(transaccion.itemChecklist.update).not.toHaveBeenCalled();
    expect((res.body as { items: { canalEntrega: string }[] }).items[0]?.canalEntrega).toBe(
      'CORREO',
    );
  });

  it('corre en una transacción serializable', async () => {
    await corregir({ canalEntrega: 'PORTAL_WEB' });

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('409 RENDICION_ANULADA con una rendición anulada, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue({ id: RENDICION, isDeleted: true });

    const res = await corregir({ canalEntrega: 'PORTAL_WEB' });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.itemChecklist.update).not.toHaveBeenCalled();
  });

  it('404 si la rendición no existe o su cliente está borrado', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue(null);

    const res = await corregir({ canalEntrega: 'PORTAL_WEB' });

    expect(res.status).toBe(404);
    expect(transaccion.rendicion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RENDICION, cliente: { isDeleted: false } } }),
    );
  });

  it('404 si el ítem no existe o es de otra rendición', async () => {
    transaccion.itemChecklist.findFirst.mockResolvedValue(null);

    const res = await corregir({ canalEntrega: 'PORTAL_WEB' });

    expect(res.status).toBe(404);
    expect(transaccion.itemChecklist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM, rendicionId: RENDICION } }),
    );
    expect(transaccion.itemChecklist.update).not.toHaveBeenCalled();
  });

  it.each([
    ['un canal inexistente', { canalEntrega: 'FAX' }, 'canalEntrega'],
    ['sin canal', {}, 'canalEntrega'],
  ])('400 con %s', async (_caso, cuerpo, campo) => {
    const res = await corregir(cuerpo);

    expect(res.status).toBe(400);
    expect((detalles(res) as { campo: string }[]).map((d) => d.campo)).toEqual([campo]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['la rendición', 'no-es-uuid', ITEM, 'id'],
    ['el ítem', RENDICION, 'no-es-uuid', 'itemId'],
  ])('400 si %s no es un uuid', async (_caso, rendicionId, itemId, campo) => {
    const res = await corregir({ canalEntrega: 'CORREO' }, rendicionId, itemId);

    expect(res.status).toBe(400);
    expect((detalles(res) as { campo: string }[]).map((d) => d.campo)).toEqual([campo]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
