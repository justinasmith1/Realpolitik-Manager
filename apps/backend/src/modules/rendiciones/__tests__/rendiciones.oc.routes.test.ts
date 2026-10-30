import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Orden de compra (HU2.11), con la base simulada:
// - `POST /clientes/:id/rendiciones` con datos de OC opcionales y rechazo 409 `OC_DE_OTRO_CLIENTE`
// - `PATCH /rendiciones/:id` (actualizar / borrar datos de OC)
// - `GET /clientes/:id/ultima-oc` (sugerencia de última OC del cliente)
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  });
  const transaccion = {
    cliente: delegado(),
    requisitoCliente: delegado(),
    rendicion: delegado(),
  };
  const prismaMock = {
    cliente: delegado(),
    rendicion: delegado(),
    $transaction: vi.fn(),
  };
  return { transaccion, prismaMock };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OTRO_CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456700';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const REQ_FACTURA = 'd1e2f3a4-b5c6-4789-8abc-def012345601';
const TIPO_FACTURA = 'c1d2e3f4-a5b6-4789-8abc-def012345601';
const AHORA = new Date('2026-10-15T15:00:00.000Z');

const decimal = (n: number | null) => (n === null ? null : new Prisma.Decimal(n));

function filaRendicionConItems(extra: Record<string, unknown> = {}) {
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
    isDeleted: false,
    deletedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    items: [
      {
        id: 'f1a2b3c4-d5e6-4789-8abc-def012345600',
        rendicionId: RENDICION,
        requisitoClienteId: REQ_FACTURA,
        tipoDocumentoId: TIPO_FACTURA,
        nombreTipoDocumento: 'Factura',
        ordinal: 1,
        totalOrdinal: 1,
        diaAproximado: null,
        canalEntrega: 'CORREO',
        completado: false,
        completadoAt: null,
        createdAt: AHORA,
        updatedAt: AHORA,
        aplicaciones: [],
      },
    ],
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cliente.findFirst.mockResolvedValue({ id: CLIENTE });
  transaccion.cliente.findFirst.mockResolvedValue({
    id: CLIENTE,
    estado: 'ACTIVO',
    canalEntrega: 'CORREO',
    emisor: 'SOCIEDAD',
  });
  transaccion.requisitoCliente.findMany.mockResolvedValue(MATRIZ);
  transaccion.rendicion.findFirst.mockResolvedValue(null);
  transaccion.rendicion.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve(
      filaRendicionConItems({
        numeroOc: (data.numeroOc as string | undefined) ?? null,
        montoMensual: decimal((data.montoMensual as number | undefined) ?? null),
        montoTotal: decimal((data.montoTotal as number | undefined) ?? null),
      }),
    ),
  );
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

describe('POST /clientes/:id/rendiciones — Orden de Compra (HU2.11)', () => {
  it('persiste numeroOc, montoMensual y montoTotal cuando vienen en el payload y los devuelve como número', async () => {
    const res = await request(app).post(`/clientes/${CLIENTE}/rendiciones`).send({
      anio: 2026,
      mes: 10,
      numeroFactura: 'B 00002-00001482',
      numeroOc: '  OC-2026-01  ',
      montoMensual: 1250000,
      montoTotal: 15000000.5,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      numeroOc: 'OC-2026-01',
      montoMensual: 1250000,
      montoTotal: 15000000.5,
    });
    expect(transaccion.rendicion.findFirst).toHaveBeenCalledWith({
      where: { numeroOc: 'OC-2026-01', isDeleted: false, clienteId: { not: CLIENTE } },
      select: { id: true },
    });
  });

  it('responde 409 OC_DE_OTRO_CLIENTE si otra rendición activa de otro cliente usa ese numeroOc', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce({ id: 'otra-rendicion-id' });

    const res = await request(app).post(`/clientes/${CLIENTE}/rendiciones`).send({
      anio: 2026,
      mes: 10,
      numeroFactura: 'B 00002-00001482',
      numeroOc: 'OC-AJENA',
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: {
        code: 'CONFLICT',
        details: { motivo: 'OC_DE_OTRO_CLIENTE', numeroOc: 'OC-AJENA' },
      },
    });
    expect(transaccion.rendicion.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /rendiciones/:id — Actualizar OC (HU2.11)', () => {
  beforeEach(() => {
    transaccion.rendicion.findFirst
      .mockResolvedValueOnce({ id: RENDICION, clienteId: CLIENTE, isDeleted: false })
      .mockResolvedValueOnce(null);
    transaccion.rendicion.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(
        filaRendicionConItems({
          numeroOc: data.numeroOc !== undefined ? data.numeroOc : 'OC-100',
          montoMensual:
            data.montoMensual !== undefined
              ? decimal(data.montoMensual as number | null)
              : decimal(500000),
          montoTotal:
            data.montoTotal !== undefined
              ? decimal(data.montoTotal as number | null)
              : decimal(6000000),
        }),
      ),
    );
  });

  it('actualiza los tres campos de la OC y devuelve el detalle de la rendición', async () => {
    const res = await request(app)
      .patch(`/rendiciones/${RENDICION}`)
      .send({ numeroOc: ' OC-999 ', montoMensual: 1250000, montoTotal: 15000000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: RENDICION,
      numeroOc: 'OC-999',
      montoMensual: 1250000,
      montoTotal: 15000000,
    });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RENDICION },
        data: { numeroOc: 'OC-999', montoMensual: 1250000, montoTotal: 15000000 },
      }),
    );
  });

  it('permite borrar datos enviando null', async () => {
    const res = await request(app)
      .patch(`/rendiciones/${RENDICION}`)
      .send({ numeroOc: null, montoMensual: null, montoTotal: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      numeroOc: null,
      montoMensual: null,
      montoTotal: null,
    });
  });

  it('rechaza con 400 un body vacío o con monto negativo', async () => {
    const vacio = await request(app).patch(`/rendiciones/${RENDICION}`).send({});
    expect(vacio.status).toBe(400);

    const negativo = await request(app)
      .patch(`/rendiciones/${RENDICION}`)
      .send({ montoMensual: -10 });
    expect(negativo.status).toBe(400);
  });

  it('responde 404 si la rendición no existe', async () => {
    transaccion.rendicion.findFirst.mockReset().mockResolvedValueOnce(null);

    const res = await request(app).patch(`/rendiciones/${RENDICION}`).send({ numeroOc: 'OC-1' });
    expect(res.status).toBe(404);
  });

  it('responde 409 RENDICION_ANULADA si la rendición está anulada', async () => {
    transaccion.rendicion.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: RENDICION, clienteId: CLIENTE, isDeleted: true });

    const res = await request(app).patch(`/rendiciones/${RENDICION}`).send({ numeroOc: 'OC-1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { code: 'CONFLICT', details: { motivo: 'RENDICION_ANULADA' } },
    });
  });

  it('responde 409 OC_DE_OTRO_CLIENTE si el nuevo numeroOc pertenece a otro cliente', async () => {
    transaccion.rendicion.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: RENDICION, clienteId: CLIENTE, isDeleted: false })
      .mockResolvedValueOnce({ id: OTRO_CLIENTE });

    const res = await request(app)
      .patch(`/rendiciones/${RENDICION}`)
      .send({ numeroOc: 'OC-AJENA' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: { code: 'CONFLICT', details: { motivo: 'OC_DE_OTRO_CLIENTE', numeroOc: 'OC-AJENA' } },
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });
});

describe('GET /clientes/:id/ultima-oc — Sugerencia de OC (HU2.11)', () => {
  it('devuelve los 3 campos de la rendición activa más reciente con numeroOc no nulo', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValueOnce({
      numeroOc: 'OC-2026-42',
      montoMensual: decimal(1250000),
      montoTotal: decimal(15000000),
    });

    const res = await request(app).get(`/clientes/${CLIENTE}/ultima-oc`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      numeroOc: 'OC-2026-42',
      montoMensual: 1250000,
      montoTotal: 15000000,
    });
    expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE, isDeleted: false, numeroOc: { not: null } },
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { createdAt: 'desc' }],
      select: { numeroOc: true, montoMensual: true, montoTotal: true },
    });
  });

  it('devuelve null si el cliente no tiene ninguna rendición con OC', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).get(`/clientes/${CLIENTE}/ultima-oc`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('responde 404 si el cliente no existe', async () => {
    prismaMock.cliente.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).get(`/clientes/${CLIENTE}/ultima-oc`);
    expect(res.status).toBe(404);
  });
});
