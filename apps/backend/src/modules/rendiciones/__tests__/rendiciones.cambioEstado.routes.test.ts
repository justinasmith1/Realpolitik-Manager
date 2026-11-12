import { Prisma } from '@prisma/client';
import type request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { clienteDePrueba } from '../../auth/__tests__/sesionSimulada';
import { cambiarEstadoDeRendicion } from '../rendiciones.service';

// Marcar una rendición como Completa y volverla a En curso (HU3.6, ADR-0005), con la base
// simulada: `PATCH /rendiciones/:id/estado` recorre route → validate → controller → service →
// mapper → errorHandler. También el auto-revert al sumar un requisito a una Completa.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
  });
  const transaccion = {
    rendicion: delegado(),
    requisitoCliente: delegado(),
    itemChecklist: delegado(),
  };
  const prismaMock = { $transaction: vi.fn() };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', async () => {
  const { conSesionesSimuladas } = await import('../../auth/__tests__/sesionSimulada');
  return { prisma: conSesionesSimuladas(prismaMock) };
});

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const REQUISITO = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const TIPO = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const AHORA = new Date('2026-10-15T15:00:00.000Z');

const itemDe = (indice: number, completado: boolean) => ({
  id: `f1a2b3c4-d5e6-4789-8abc-def01234560${indice}`,
  rendicionId: RENDICION,
  requisitoClienteId: 'd1e2f3a4-b5c6-4789-8abc-def012345601',
  tipoDocumentoId: 'c1d2e3f4-a5b6-4789-8abc-def012345601',
  nombreTipoDocumento: 'Factura',
  ordinal: indice,
  totalOrdinal: 2,
  diaAproximado: null,
  canalEntrega: 'CORREO',
  completado,
  completadoAt: completado ? AHORA : null,
  createdAt: AHORA,
  updatedAt: AHORA,
  aplicaciones: [],
});

/** La rendición completa, como la devuelve la base con sus ítems y su historial. */
const filaDetalle = (estado: string, items = [itemDe(1, true), itemDe(2, true)]) => ({
  id: RENDICION,
  clienteId: CLIENTE,
  anio: 2026,
  mes: 10,
  numeroFactura: 'A 00001-00000001',
  emisor: 'SOCIEDAD',
  numeroOc: null,
  montoMensual: null,
  montoTotal: null,
  estado,
  historial: [{ estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: AHORA }],
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
  items,
});

/** Lo que lee `cambiarEstadoDeRendicion` de la rendición antes de decidir. */
const lecturaDe = (
  estado: string,
  completados: boolean[] = [true, true],
  extra: Record<string, unknown> = {},
) => ({
  estado,
  isDeleted: false,
  items: completados.map((completado) => ({ completado })),
  ...extra,
});

const pedir = (estado: unknown) =>
  clienteDePrueba(app).patch(`/rendiciones/${RENDICION}/estado`).send({ estado });

const detalles = (res: request.Response) =>
  (res.body as { error: { details: unknown } }).error.details;

beforeEach(() => {
  vi.resetAllMocks();
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
  // `registrarCambioDeEstadoEnTx` vuelve a leer el estado anterior dentro de la transacción.
  transaccion.rendicion.update.mockImplementation(({ data }: { data: { estado: string } }) =>
    Promise.resolve(filaDetalle(data.estado)),
  );
});

describe('PATCH /rendiciones/:id/estado (HU3.6)', () => {
  it('EN_CURSO → COMPLETA con todos los ítems completados: 200 con la rendición y su historial', async () => {
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('EN_CURSO'))
      .mockResolvedValueOnce({ estado: 'EN_CURSO' });

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, estado: 'COMPLETA' });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RENDICION },
        data: {
          estado: 'COMPLETA',
          historial: {
            create: { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', motivo: null },
          },
        },
      }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('EN_CURSO → COMPLETA con un ítem pendiente: 409 ITEMS_PENDIENTES con faltantes 1, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('EN_CURSO', [true, false]));

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'ITEMS_PENDIENTES', faltantes: 1 });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('EN_CURSO → COMPLETA con cero ítems: 409 ITEMS_PENDIENTES con faltantes 0', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('EN_CURSO', []));

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'ITEMS_PENDIENTES', faltantes: 0 });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('COMPLETA → EN_CURSO: 200, aunque falte algún documento', async () => {
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('COMPLETA', [true, false]))
      .mockResolvedValueOnce({ estado: 'COMPLETA' });

    const res = await pedir('EN_CURSO');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'EN_CURSO' });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          estado: 'EN_CURSO',
          historial: {
            create: { estadoAnterior: 'COMPLETA', estadoNuevo: 'EN_CURSO', motivo: null },
          },
        },
      }),
    );
  });

  it('COMPLETA → COMPLETA es idempotente: 200 sin escribir ni agregar historial', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('COMPLETA'));
    transaccion.rendicion.findUniqueOrThrow.mockResolvedValueOnce(filaDetalle('COMPLETA'));

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, estado: 'COMPLETA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('una rendición anulada: 409 RENDICION_ANULADA, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('EN_CURSO', [true], { isDeleted: true }),
    );

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('una transición fuera de las permitidas: 409 TRANSICION_INVALIDA con los dos estados', async () => {
    // El schema solo deja pasar EN_CURSO y COMPLETA: se prueba el servicio con un estado de partida
    // que no tiene salida hacia ninguno de los dos (ENVIADA → COMPLETA).
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({
      motivo: 'TRANSICION_INVALIDA',
      estadoActual: 'ENVIADA',
      estadoNuevo: 'COMPLETA',
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('el servicio rechaza EN_CURSO → ENVIADA (todavía sin HU): TRANSICION_INVALIDA', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('EN_CURSO'));

    await expect(cambiarEstadoDeRendicion(RENDICION, 'ENVIADA')).rejects.toMatchObject({
      status: 409,
      details: { motivo: 'TRANSICION_INVALIDA', estadoActual: 'EN_CURSO', estadoNuevo: 'ENVIADA' },
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('404 si la rendición no existe o su cliente está borrado', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(null);

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(404);
  });

  it.each([{ estado: 'ENVIADA' }, { estado: 'APROBADA' }, {}])(
    '400 VALIDATION_ERROR con el cuerpo %j',
    async (cuerpo) => {
      const res = await clienteDePrueba(app).patch(`/rendiciones/${RENDICION}/estado`).send(cuerpo);

      expect(res.status).toBe(400);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('POST /rendiciones/:id/requisitos/:requisitoId — auto-revert (HU3.6)', () => {
  const rendicionDe = (estado: string) => ({
    id: RENDICION,
    clienteId: CLIENTE,
    estado,
    isDeleted: false,
    cliente: { estado: 'ACTIVO', canalEntrega: 'CORREO' },
  });

  beforeEach(() => {
    transaccion.requisitoCliente.findFirst.mockResolvedValue({
      id: REQUISITO,
      clienteId: CLIENTE,
      tipoDocumentoId: TIPO,
      tipoDocumento: { nombre: 'Print' },
      cantidad: 1,
      diasAproximados: [],
      canalEntrega: null,
      nota: null,
      isDeleted: false,
      deletedAt: null,
      createdAt: AHORA,
      updatedAt: AHORA,
    });
    transaccion.itemChecklist.findFirst.mockResolvedValue(null);
    transaccion.itemChecklist.createMany.mockResolvedValue({ count: 1 });
    transaccion.rendicion.findUniqueOrThrow.mockResolvedValue(filaDetalle('EN_CURSO'));
  });

  it('sobre una COMPLETA vuelve a EN_CURSO, con el motivo, en la misma transacción', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue(rendicionDe('COMPLETA'));

    const res = await clienteDePrueba(app).post(
      `/rendiciones/${RENDICION}/requisitos/${REQUISITO}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'EN_CURSO' });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          estado: 'EN_CURSO',
          historial: {
            create: {
              estadoAnterior: 'COMPLETA',
              estadoNuevo: 'EN_CURSO',
              motivo: 'Revertida a En curso al agregar requisito',
            },
          },
        },
      }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('sobre una EN_CURSO no cambia el estado ni agrega historial', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue(rendicionDe('EN_CURSO'));

    const res = await clienteDePrueba(app).post(
      `/rendiciones/${RENDICION}/requisitos/${REQUISITO}`,
    );

    expect(res.status).toBe(200);
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });
});
