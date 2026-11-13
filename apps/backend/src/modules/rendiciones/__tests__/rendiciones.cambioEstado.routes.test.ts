import { Prisma } from '@prisma/client';
import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { clienteDePrueba } from '../../auth/__tests__/sesionSimulada';
import { cambiarEstadoDeRendicion, motivoParaNoModificar } from '../rendiciones.service';

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

/** La aplicación vigente de un ítem, como la lee `APLICACION_VIGENTE`. */
const aplicacionVigente = (indice: number) => ({
  id: `b1c2d3e4-f5a6-4789-8abc-00000000010${indice}`,
  documentoId: `b1c2d3e4-f5a6-4789-8abc-00000000020${indice}`,
  aplicadaEn: AHORA,
  documento: { nombreOriginal: 'factura.pdf', tipoContenido: 'application/pdf', tamanioBytes: 10 },
});

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
  // Reunido = con su documento vigente (HU2.8): lo exige la regla del envío (HU3.6, deuda).
  aplicaciones: completado ? [aplicacionVigente(indice)] : [],
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
  anio: 2026,
  mes: 10,
  items: completados.map((completado, indice) => itemDe(indice + 1, completado)),
  historial: [],
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
    // ENVIADA no tiene salida (volver de Enviada no lo pide ninguna HU todavía).
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

  it('el servicio rechaza EN_CURSO → ENVIADA: TRANSICION_INVALIDA', async () => {
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

  it.each([{ estado: 'ATRASADA' }, { estado: 'RECHAZADA' }, {}])(
    '400 VALIDATION_ERROR con el cuerpo %j',
    async (cuerpo) => {
      const res = await clienteDePrueba(app).patch(`/rendiciones/${RENDICION}/estado`).send(cuerpo);

      expect(res.status).toBe(400);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe('PATCH /rendiciones/:id/estado — deuda de la HU3.6', () => {
  it('una anulada que pide su mismo estado: 409 RENDICION_ANULADA (no es idempotente)', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('COMPLETA', [true], { isDeleted: true }),
    );

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('EN_CURSO → EN_CURSO: 200 sin escribir ni agregar historial', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('EN_CURSO', [true, false]));
    transaccion.rendicion.findUniqueOrThrow.mockResolvedValueOnce(filaDetalle('EN_CURSO'));

    const res = await pedir('EN_CURSO');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, estado: 'EN_CURSO' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('un ítem reunido sin documento vigente cuenta como faltante: 409 ITEMS_PENDIENTES', async () => {
    const sinDocumento = { ...itemDe(2, true), aplicaciones: [] };
    transaccion.rendicion.findFirst.mockResolvedValueOnce({
      ...lecturaDe('EN_CURSO'),
      items: [itemDe(1, true), sinDocumento],
    });

    const res = await pedir('COMPLETA');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'ITEMS_PENDIENTES', faltantes: 1 });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /rendiciones/:id/estado — Enviada (HU3.7)', () => {
  const enviar = (cuerpo: Record<string, unknown> = {}) =>
    clienteDePrueba(app)
      .patch(`/rendiciones/${RENDICION}/estado`)
      .send({ estado: 'ENVIADA', ...cuerpo });

  /** El `create` del historial que recibió el `update`. */
  const entradaCreada = () =>
    (
      transaccion.rendicion.update.mock.calls[0]?.[0] as {
        data: { historial: { create: Record<string, unknown> } };
      }
    ).data.historial.create;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('COMPLETA → ENVIADA sin fecha: hoy en Buenos Aires como fecha efectiva', async () => {
    // 23:30 del 12/11 en Buenos Aires (en UTC ya es 13/11).
    vi.useFakeTimers({ now: new Date('2026-11-13T02:30:00.000Z'), toFake: ['Date'] });
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('COMPLETA'))
      .mockResolvedValueOnce({ estado: 'COMPLETA' });

    const res = await enviar();

    expect(res.status).toBe(200);
    expect(entradaCreada()).toEqual({
      estadoAnterior: 'COMPLETA',
      estadoNuevo: 'ENVIADA',
      motivo: null,
      fechaEfectiva: new Date('2026-11-12T00:00:00.000Z'),
    });
  });

  it('COMPLETA → ENVIADA con una fecha pasada del período: la guarda', async () => {
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('COMPLETA'))
      .mockResolvedValueOnce({ estado: 'COMPLETA' });

    const res = await enviar({ fechaEnvio: '2026-10-01' });

    expect(res.status).toBe(200);
    expect(entradaCreada()).toMatchObject({ fechaEfectiva: new Date('2026-10-01T00:00:00.000Z') });
  });

  it('fecha anterior al primer día del período: 400 en fechaEnvio, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('COMPLETA'));

    const res = await enviar({ fechaEnvio: '2026-09-30' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [
          {
            campo: 'fechaEnvio',
            mensaje:
              'La fecha de envío no puede ser anterior al 01/10/2026, el primer día del período.',
          },
        ],
      },
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('fecha futura: 400 del schema, sin llegar a la base', async () => {
    const res = await enviar({ fechaEnvio: '2999-01-01' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'fechaEnvio' }] },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('fechaEnvio con otro estado: 400, sin llegar a la base', async () => {
    const res = await clienteDePrueba(app)
      .patch(`/rendiciones/${RENDICION}/estado`)
      .send({ estado: 'COMPLETA', fechaEnvio: '2026-10-01' });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('COMPLETA → ENVIADA con un faltante: 409 ITEMS_PENDIENTES', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('COMPLETA', [true, false]));

    const res = await enviar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'ITEMS_PENDIENTES', faltantes: 1 });
  });

  it.each(['EN_CURSO', 'RECHAZADA', 'APROBADA'])(
    '%s → ENVIADA: 409 TRANSICION_INVALIDA',
    async (estado) => {
      transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe(estado));

      const res = await enviar();

      expect(res.status).toBe(409);
      expect(detalles(res)).toEqual({
        motivo: 'TRANSICION_INVALIDA',
        estadoActual: estado,
        estadoNuevo: 'ENVIADA',
      });
      expect(transaccion.rendicion.update).not.toHaveBeenCalled();
    },
  );

  it('una anulada → ENVIADA: 409 RENDICION_ANULADA', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('COMPLETA', [true], { isDeleted: true }),
    );

    const res = await enviar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
  });

  it('ENVIADA → COMPLETA o EN_CURSO: 409 TRANSICION_INVALIDA (volver de Enviada no está permitido)', async () => {
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('ENVIADA'))
      .mockResolvedValueOnce(lecturaDe('ENVIADA'));

    expect((await pedir('EN_CURSO')).status).toBe(409);
    expect((await pedir('COMPLETA')).status).toBe(409);
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /rendiciones/:id/estado — respuesta del cliente (HU3.8)', () => {
  const responder = (cuerpo: Record<string, unknown>) =>
    clienteDePrueba(app).patch(`/rendiciones/${RENDICION}/estado`).send(cuerpo);

  /** El `create` del historial que recibió el `update`. */
  const entradaCreada = () =>
    (
      transaccion.rendicion.update.mock.calls[0]?.[0] as {
        data: { historial: { create: Record<string, unknown> } };
      }
    ).data.historial.create;

  /** El `update` devuelve la rendición con la entrada nueva en su historial, como la base. */
  const devolverConEntrada = () =>
    transaccion.rendicion.update.mockImplementation(
      ({ data }: { data: { estado: string; historial: { create: Record<string, unknown> } } }) =>
        Promise.resolve({
          ...filaDetalle(data.estado),
          historial: [
            { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: AHORA, motivo: null },
            { fecha: AHORA, fechaEfectiva: null, ...data.historial.create },
          ],
        }),
    );

  it('ENVIADA → APROBADA: 200, sin motivo ni fecha efectiva en la entrada', async () => {
    devolverConEntrada();
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('ENVIADA'))
      .mockResolvedValueOnce({ estado: 'ENVIADA' });

    const res = await responder({ estado: 'APROBADA' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, estado: 'APROBADA' });
    expect(entradaCreada()).toEqual({
      estadoAnterior: 'ENVIADA',
      estadoNuevo: 'APROBADA',
      motivo: null,
    });
  });

  it('ENVIADA → RECHAZADA con motivo: 200 y el historial lo devuelve', async () => {
    devolverConEntrada();
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('ENVIADA'))
      .mockResolvedValueOnce({ estado: 'ENVIADA' });

    const res = await responder({ estado: 'RECHAZADA', motivo: 'Faltó el CUIT 20-12345678-4' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'RECHAZADA' });
    expect(entradaCreada()).toEqual({
      estadoAnterior: 'ENVIADA',
      estadoNuevo: 'RECHAZADA',
      motivo: 'Faltó el CUIT 20-12345678-4',
    });
    const historial = (res.body as { historial: Array<{ motivo?: string | null }> }).historial;
    expect(historial.map((paso) => paso.motivo)).toEqual([null, 'Faltó el CUIT 20-12345678-4']);
  });

  it('ENVIADA → RECHAZADA con un cobro registrado: 409 COBRO_REGISTRADO, sin escribir (HU3.10)', async () => {
    devolverConEntrada();
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('ENVIADA'))
      .mockResolvedValueOnce({
        estado: 'ENVIADA',
        cobroFecha: new Date('2026-11-10T00:00:00.000Z'),
      });

    const res = await responder({ estado: 'RECHAZADA', motivo: 'Faltó la firma' });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'COBRO_REGISTRADO' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('ENVIADA → APROBADA con un cobro registrado: 200, el cobro no impide aprobar (HU3.10)', async () => {
    devolverConEntrada();
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('ENVIADA'))
      .mockResolvedValueOnce({
        estado: 'ENVIADA',
        cobroFecha: new Date('2026-11-10T00:00:00.000Z'),
      });

    const res = await responder({ estado: 'APROBADA' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'APROBADA' });
    expect(transaccion.rendicion.update).toHaveBeenCalledTimes(1);
  });

  it('APROBADA → RECHAZADA con un cobro: sigue siendo TRANSICION_INVALIDA, no COBRO_REGISTRADO (HU3.10)', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('APROBADA', [true, true], { cobroFecha: new Date('2026-11-10T00:00:00.000Z') }),
    );

    const res = await responder({ estado: 'RECHAZADA', motivo: 'texto' });

    expect(res.status).toBe(409);
    expect(detalles(res)).toMatchObject({ motivo: 'TRANSICION_INVALIDA' });
  });

  it('RECHAZADA sin motivo: 400 en motivo (no 409), sin llegar a la base', async () => {
    const res = await responder({ estado: 'RECHAZADA' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'motivo' }] },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('RECHAZADA con motivo sobre una EN_CURSO: 409 TRANSICION_INVALIDA, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('EN_CURSO'));

    const res = await responder({ estado: 'RECHAZADA', motivo: 'texto' });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({
      motivo: 'TRANSICION_INVALIDA',
      estadoActual: 'EN_CURSO',
      estadoNuevo: 'RECHAZADA',
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('APROBADA con motivo: 400 en motivo, sin llegar a la base', async () => {
    const res = await responder({ estado: 'APROBADA', motivo: 'algo' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo: 'motivo' }] },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('APROBADA sobre una ya APROBADA: 200 idempotente, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('APROBADA'));
    transaccion.rendicion.findUniqueOrThrow.mockResolvedValueOnce(filaDetalle('APROBADA'));

    const res = await responder({ estado: 'APROBADA' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'APROBADA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /rendiciones/:id/estado — corregir una rechazada (HU3.9)', () => {
  /** Un paso del historial como lo lee `HISTORIAL_EN_ORDEN`. */
  const paso = (
    estadoNuevo: string,
    fecha: string,
    extra: { fechaEfectiva?: Date; motivo?: string } = {},
  ) => ({
    estadoAnterior: null,
    estadoNuevo,
    fecha: new Date(fecha),
    fechaEfectiva: null,
    motivo: null,
    ...extra,
  });
  /** Enviada el 20/10 y rechazada el 05/11 (23:30 en Buenos Aires: en UTC ya es 06/11). */
  const HISTORIAL_RECHAZADO = [
    paso('EN_CURSO', '2026-10-02T12:00:00.000Z'),
    paso('COMPLETA', '2026-10-19T12:00:00.000Z'),
    paso('ENVIADA', '2026-10-20T12:00:00.000Z', {
      fechaEfectiva: new Date('2026-10-20T00:00:00.000Z'),
    }),
    paso('RECHAZADA', '2026-11-06T02:30:00.000Z', { motivo: 'Falta la firma' }),
    paso('EN_CURSO', '2026-11-06T13:00:00.000Z'),
    paso('COMPLETA', '2026-11-07T13:00:00.000Z'),
  ];

  afterEach(() => {
    vi.useRealTimers();
  });

  it('RECHAZADA → EN_CURSO: 200, con su entrada en el historial y sin tocar los ítems', async () => {
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(lecturaDe('RECHAZADA', [true, false]))
      .mockResolvedValueOnce({ estado: 'RECHAZADA' });

    const res = await pedir('EN_CURSO');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'EN_CURSO' });
    // No exige todo reunido (hay un faltante) ni pide motivo.
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          estado: 'EN_CURSO',
          historial: {
            create: { estadoAnterior: 'RECHAZADA', estadoNuevo: 'EN_CURSO', motivo: null },
          },
        },
      }),
    );
    expect(transaccion.itemChecklist.update).not.toHaveBeenCalled();
    expect(transaccion.itemChecklist.createMany).not.toHaveBeenCalled();
  });

  it('una rechazada anulada → EN_CURSO: 409 RENDICION_ANULADA, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('RECHAZADA', [true], { isDeleted: true }),
    );

    const res = await pedir('EN_CURSO');

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETA', 'APROBADA'])(
    'RECHAZADA → %s: 409 TRANSICION_INVALIDA (solo se reabre a En curso)',
    async (estado) => {
      transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('RECHAZADA'));

      const res = await pedir(estado);

      expect(res.status).toBe(409);
      expect(detalles(res)).toMatchObject({ motivo: 'TRANSICION_INVALIDA' });
      expect(transaccion.rendicion.update).not.toHaveBeenCalled();
    },
  );

  it('reenvío con fecha anterior al día del último rechazo: 400 en fechaEnvio, sin escribir', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-10T15:00:00.000Z'), toFake: ['Date'] });
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('COMPLETA', [true, true], { historial: HISTORIAL_RECHAZADO }),
    );

    const res = await clienteDePrueba(app)
      .patch(`/rendiciones/${RENDICION}/estado`)
      .send({ estado: 'ENVIADA', fechaEnvio: '2026-11-04' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [
          {
            campo: 'fechaEnvio',
            mensaje:
              'La fecha de envío no puede ser anterior al 05/11/2026, el día del último rechazo.',
          },
        ],
      },
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('reenvío el mismo día del rechazo: 200 con esa fecha efectiva', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-10T15:00:00.000Z'), toFake: ['Date'] });
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce(
        lecturaDe('COMPLETA', [true, true], { historial: HISTORIAL_RECHAZADO }),
      )
      .mockResolvedValueOnce({ estado: 'COMPLETA' });

    const res = await clienteDePrueba(app)
      .patch(`/rendiciones/${RENDICION}/estado`)
      .send({ estado: 'ENVIADA', fechaEnvio: '2026-11-05' });

    expect(res.status).toBe(200);
    const { data } = transaccion.rendicion.update.mock.calls[0]?.[0] as {
      data: { historial: { create: Record<string, unknown> } };
    };
    expect(data.historial.create).toMatchObject({
      estadoNuevo: 'ENVIADA',
      fechaEfectiva: new Date('2026-11-05T00:00:00.000Z'),
    });
  });
});

describe('motivoParaNoModificar (HU3.8 y HU3.9)', () => {
  it.each(['ENVIADA', 'APROBADA', 'RECHAZADA'] as const)(
    '%s: 409 RENDICION_ENVIADA con el texto "La rendición ya no se puede modificar."',
    (estado) => {
      expect(motivoParaNoModificar({ isDeleted: false, estado })).toMatchObject({
        status: 409,
        message: 'La rendición ya no se puede modificar.',
        details: { motivo: 'RENDICION_ENVIADA' },
      });
    },
  );

  it.each(['EN_CURSO', 'COMPLETA'] as const)('%s se puede modificar', (estado) => {
    expect(motivoParaNoModificar({ isDeleted: false, estado })).toBeNull();
  });
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
