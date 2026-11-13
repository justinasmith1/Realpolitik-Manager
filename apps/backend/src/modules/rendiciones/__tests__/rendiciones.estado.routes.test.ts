import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { clienteDePrueba } from '../../auth/__tests__/sesionSimulada';
import { registrarCambioDeEstado } from '../rendiciones.service';

// Estado de la rendición (HU3.1, ADR-0005), con la base simulada: nace EN_CURSO con su entrada
// inicial de historial, el listado filtra por estado, el detalle trae el historial en orden y
// `registrarCambioDeEstado` (sin endpoint) actualiza el estado y agrega la entrada juntos.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    groupBy: vi.fn(),
  });
  const transaccion = {
    cliente: delegado(),
    requisitoCliente: delegado(),
    rendicion: delegado(),
  };
  const prismaMock = {
    cliente: delegado(),
    rendicion: delegado(),
    itemChecklist: delegado(),
    $transaction: vi.fn(),
  };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', async () => {
  const { conSesionesSimuladas } = await import('../../auth/__tests__/sesionSimulada');
  return { prisma: conSesionesSimuladas(prismaMock) };
});

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const REQ_FACTURA = 'd1e2f3a4-b5c6-4789-8abc-def012345601';
const TIPO_FACTURA = 'c1d2e3f4-a5b6-4789-8abc-def012345601';
// Mediados de octubre de 2026 en Buenos Aires: el período máximo es noviembre.
const HOY = new Date('2026-10-15T12:00:00-03:00');
const AHORA = new Date('2026-10-15T15:00:00.000Z');
const DESPUES = new Date('2026-10-20T15:00:00.000Z');

const ALTA = { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: AHORA };

function filaRendicion(extra: Record<string, unknown> = {}) {
  return {
    id: RENDICION,
    clienteId: CLIENTE,
    anio: 2026,
    mes: 10,
    numeroFactura: 'B 00002-00001482',
    emisor: 'SOCIEDAD',
    numeroOc: null,
    montoMensual: null,
    montoTotal: null,
    estado: 'EN_CURSO',
    isDeleted: false,
    deletedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    items: [],
    historial: [ALTA],
    ...extra,
  };
}

const MATRIZ = [
  {
    id: REQ_FACTURA,
    clienteId: CLIENTE,
    tipoDocumentoId: TIPO_FACTURA,
    tipoDocumento: { nombre: 'Factura' },
    cantidad: 1,
    diasAproximados: [],
    canalEntrega: null,
    nota: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
  },
];

const listar = (query = '') => clienteDePrueba(app).get(`/clientes/${CLIENTE}/rendiciones${query}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  for (const db of [prismaMock, transaccion]) {
    db.cliente.findFirst.mockResolvedValue({
      id: CLIENTE,
      estado: 'ACTIVO',
      canalEntrega: 'CORREO',
      emisor: 'SOCIEDAD',
    });
  }
  transaccion.requisitoCliente.findMany.mockResolvedValue(MATRIZ);
  transaccion.rendicion.create.mockResolvedValue(filaRendicion());
  prismaMock.rendicion.findMany.mockResolvedValue([]);
  prismaMock.itemChecklist.groupBy.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('POST /clientes/:id/rendiciones: nace en curso', () => {
  it('crea la rendición EN_CURSO y su entrada inicial de historial en la misma escritura', async () => {
    const res = await clienteDePrueba(app)
      .post(`/clientes/${CLIENTE}/rendiciones`)
      .send({ anio: 2026, mes: 10, numeroFactura: 'B 00002-00001482' });

    expect(res.status).toBe(201);
    // Una sola creación, dentro de la transacción del alta: rendición e historial van juntos.
    expect(transaccion.rendicion.create).toHaveBeenCalledTimes(1);
    expect(transaccion.rendicion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: 'EN_CURSO',
          historial: { create: { estadoAnterior: null, estadoNuevo: 'EN_CURSO' } },
        }) as unknown,
      }),
    );
    expect(res.body).toMatchObject({
      estado: 'EN_CURSO',
      historial: [{ estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: AHORA.toISOString() }],
    });
  });
});

describe('GET /clientes/:id/rendiciones: filtro por estado', () => {
  it('sin el parámetro no filtra por estado', async () => {
    await listar();

    const where = (prismaMock.rendicion.findMany.mock.calls[0]?.[0] as { where: object }).where;
    expect(where).not.toHaveProperty('estado');
  });

  it('con ?estado= filtra por ese estado y devuelve el estado de cada una', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([filaRendicion({ estado: 'ENVIADA' })]);

    const res = await listar('?estado=ENVIADA');

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteId: CLIENTE, isDeleted: false, estado: 'ENVIADA' },
      }),
    );
    expect(res.body).toEqual([expect.objectContaining({ estado: 'ENVIADA', vigencia: 'ACTIVA' })]);
    // El listado no lleva el historial: es del detalle.
    expect((res.body as object[])[0]).not.toHaveProperty('historial');
  });

  it('se combina con la vigencia: una anulada conserva su estado', async () => {
    await listar('?estado=COMPLETA&vigencia=ANULADA');

    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteId: CLIENTE, isDeleted: true, estado: 'COMPLETA' },
      }),
    );
  });

  it.each(['?estado=en_curso', '?estado=ATRASADA', '?estado=', '?estado=EN_CURSO&estado=COMPLETA'])(
    '400 VALIDATION_ERROR con %s, sin consultar la base',
    async (query) => {
      const res = await listar(query);

      expect(res.status).toBe(400);
      expect(
        (res.body as { error: { code: string; details: { campo: string }[] } }).error,
      ).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ campo: 'estado' }] });
      expect(prismaMock.rendicion.findMany).not.toHaveBeenCalled();
    },
  );
});

describe('GET /rendiciones/:id: estado e historial', () => {
  it('pide el historial ordenado del más viejo al más nuevo y lo devuelve así', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValue(
      filaRendicion({
        estado: 'COMPLETA',
        historial: [ALTA, { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: DESPUES }],
      }),
    );

    const res = await clienteDePrueba(app).get(`/rendiciones/${RENDICION}`);

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          historial: {
            orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
            select: {
              estadoAnterior: true,
              estadoNuevo: true,
              fecha: true,
              fechaEfectiva: true,
              motivo: true,
            },
          },
        }) as unknown,
      }),
    );
    expect(res.body).toMatchObject({
      estado: 'COMPLETA',
      historial: [
        { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: AHORA.toISOString() },
        { estadoAnterior: 'EN_CURSO', estadoNuevo: 'COMPLETA', fecha: DESPUES.toISOString() },
      ],
    });
    // El motivo (HU3.8) forma parte del contrato: sin valor en la base, viaja como null.
    expect((res.body as { historial: object[] }).historial[0]).toHaveProperty('motivo', null);
  });

  it('una anulada conserva el último estado que tenía', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValue(
      filaRendicion({ estado: 'ENVIADA', isDeleted: true, deletedAt: DESPUES }),
    );

    const res = await clienteDePrueba(app).get(`/rendiciones/${RENDICION}`);

    expect(res.body).toMatchObject({ estado: 'ENVIADA', vigencia: 'ANULADA' });
  });
});

describe('registrarCambioDeEstado (sin endpoint)', () => {
  beforeEach(() => {
    transaccion.rendicion.findFirst.mockResolvedValue({ estado: 'EN_CURSO' });
    transaccion.rendicion.update.mockImplementation(
      ({ data }: { data: { estado: string; historial: { create: object } } }) =>
        Promise.resolve(
          filaRendicion({
            estado: data.estado,
            historial: [ALTA, { ...data.historial.create, fecha: DESPUES }],
          }),
        ),
    );
  });

  it('actualiza el estado y agrega la entrada con el anterior, en una sola escritura', async () => {
    const detalle = await registrarCambioDeEstado(RENDICION, 'COMPLETA');

    expect(transaccion.rendicion.update).toHaveBeenCalledTimes(1);
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
    expect(detalle.estado).toBe('COMPLETA');
    expect(detalle.historial.map((h) => [h.estadoAnterior, h.estadoNuevo])).toEqual([
      [null, 'EN_CURSO'],
      ['EN_CURSO', 'COMPLETA'],
    ]);
  });

  it('lee el estado anterior y escribe dentro de una transacción serializable', async () => {
    await registrarCambioDeEstado(RENDICION, 'COMPLETA');

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaccion.rendicion.findFirst).toHaveBeenCalledWith({
      where: { id: RENDICION, cliente: { isDeleted: false } },
      select: { estado: true, cobroFecha: true },
    });
  });

  it('rechazar una rendición con cobro registrado es COBRO_REGISTRADO, también por el punto único (HU3.10)', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue({
      estado: 'ENVIADA',
      cobroFecha: new Date('2026-11-10T00:00:00.000Z'),
    });

    await expect(
      registrarCambioDeEstado(RENDICION, 'RECHAZADA', 'Falta la firma'),
    ).rejects.toMatchObject({
      status: 409,
      details: { motivo: 'COBRO_REGISTRADO' },
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('guarda el motivo cuando viene (lo va a usar el rechazo, HU3.8)', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue({ estado: 'ENVIADA' });

    await registrarCambioDeEstado(RENDICION, 'RECHAZADA', 'Falta la constancia');

    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          historial: {
            create: {
              estadoAnterior: 'ENVIADA',
              estadoNuevo: 'RECHAZADA',
              motivo: 'Falta la constancia',
            },
          },
        }) as unknown,
      }),
    );
  });

  it('si la rendición no existe, es un 404 y no escribe nada', async () => {
    transaccion.rendicion.findFirst.mockResolvedValue(null);

    await expect(registrarCambioDeEstado(RENDICION, 'COMPLETA')).rejects.toMatchObject({
      status: 404,
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });
});
