import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Reintentos del alta de una rendición (`POST /clientes/:id/rendiciones`), con la base simulada.
// Un conflicto de serialización se reintenta siempre, en cualquier punto del alta: también antes
// de resolver el emisor (al leer el cliente o la matriz). Una factura duplicada se responde 409 con
// la rendición que la tiene, buscada con el emisor que resolvió el alta.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
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
const OTRA = 'e1f2a3b4-c5d6-4789-8abc-def012345699';
const REQ_FACTURA = 'd1e2f3a4-b5c6-4789-8abc-def012345601';
const TIPO_FACTURA = 'c1d2e3f4-a5b6-4789-8abc-def012345601';
// Mediados de octubre de 2026 en Buenos Aires: el período máximo es noviembre.
const HOY = new Date('2026-10-15T12:00:00-03:00');
const AHORA = new Date('2026-10-15T15:00:00.000Z');

const pedido = { anio: 2026, mes: 10, numeroFactura: 'B 00002-00001482' };
const abrir = (body: object = pedido) =>
  request(app).post(`/clientes/${CLIENTE}/rendiciones`).send(body);

function errorPrisma(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    ...(meta === undefined ? {} : { meta }),
  });
}

/** Las dos formas en que Prisma informa un conflicto de serialización. */
const CONFLICTOS = [
  ['P2034', () => errorPrisma('P2034')],
  ['P2010 con SQLSTATE 40001', () => errorPrisma('P2010', { code: '40001' })],
] as const;

const facturaDuplicada = () => errorPrisma('P2002', { target: ['emisor', 'numeroFactura'] });

const EXISTENTE = {
  id: OTRA,
  clienteId: OTRO_CLIENTE,
  anio: 2026,
  mes: 9,
  numeroFactura: 'B 00002-00001482',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  transaccion.cliente.findFirst.mockResolvedValue({
    id: CLIENTE,
    estado: 'ACTIVO',
    canalEntrega: 'CORREO',
    emisor: 'SOCIEDAD',
  });
  transaccion.requisitoCliente.findMany.mockResolvedValue([
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
  ]);
  transaccion.rendicion.create.mockImplementation(
    (args: { data: Record<string, unknown> & { items: { createMany: { data: object[] } } } }) =>
      Promise.resolve({
        id: RENDICION,
        clienteId: CLIENTE,
        anio: 2026,
        mes: 10,
        numeroFactura: args.data.numeroFactura,
        emisor: args.data.emisor,
        numeroOc: null,
        montoMensual: null,
        montoTotal: null,
        isDeleted: false,
        deletedAt: null,
        createdAt: AHORA,
        updatedAt: AHORA,
        items: args.data.items.createMany.data.map((item, indice) => ({
          id: `f1a2b3c4-d5e6-4789-8abc-def01234567${indice}`,
          rendicionId: RENDICION,
          completado: false,
          completadoAt: null,
          createdAt: AHORA,
          updatedAt: AHORA,
          aplicaciones: [],
          ...item,
        })),
      }),
  );
  // Como Prisma: el error del trabajo sale tal cual de `$transaction`, que se vuelve a llamar en
  // cada reintento.
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('POST /clientes/:id/rendiciones: conflictos de serialización', () => {
  it.each(CONFLICTOS)(
    'un %s al leer el cliente, antes de resolver el emisor, se reintenta y la rendición se abre',
    async (_caso, conflicto) => {
      transaccion.cliente.findFirst.mockRejectedValueOnce(conflicto());

      const res = await abrir();

      expect(res.status).toBe(201);
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
      expect(transaccion.rendicion.create).toHaveBeenCalledTimes(1);
      expect(res.body).toMatchObject({ emisor: 'SOCIEDAD' });
    },
  );

  it('un conflicto al leer la matriz, antes de crear, también se reintenta', async () => {
    transaccion.requisitoCliente.findMany.mockRejectedValueOnce(errorPrisma('P2034'));

    const res = await abrir();

    expect(res.status).toBe(201);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('un conflicto al crear, con el emisor ya resuelto, también se reintenta', async () => {
    transaccion.rendicion.create.mockRejectedValueOnce(errorPrisma('P2034'));

    const res = await abrir();

    expect(res.status).toBe(201);
    expect(transaccion.rendicion.create).toHaveBeenCalledTimes(2);
  });

  it('si el conflicto se repite en todos los intentos, se corta y responde 500 (no reintenta para siempre)', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    transaccion.cliente.findFirst.mockRejectedValue(errorPrisma('P2034'));

    const res = await abrir();

    expect(res.status).toBe(500);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3);
    expect(transaccion.rendicion.create).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe('POST /clientes/:id/rendiciones: factura duplicada después de un reintento', () => {
  it('busca la existente con el emisor que resolvió el intento que chocó', async () => {
    // Primer intento: conflicto de serialización. Segundo: la factura ya la tiene otra rendición.
    transaccion.cliente.findFirst.mockRejectedValueOnce(errorPrisma('P2034'));
    transaccion.rendicion.create.mockRejectedValueOnce(facturaDuplicada());
    prismaMock.rendicion.findFirst.mockResolvedValue(EXISTENTE);

    const res = await abrir({ ...pedido, emisor: 'PERSONA_FISICA' });

    expect(res.status).toBe(409);
    expect((res.body as { error: { details: unknown } }).error.details).toEqual({
      motivo: 'RENDICION_DUPLICADA',
      rendicionExistente: EXISTENTE,
    });
    expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isDeleted: false, numeroFactura: 'B 00002-00001482', emisor: 'PERSONA_FISICA' },
      }),
    );
  });

  it('si la que tenía la factura ya no está en ningún intento, se corta a los 3 y no la da por duplicada', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    transaccion.rendicion.create.mockRejectedValue(facturaDuplicada());
    prismaMock.rendicion.findFirst.mockResolvedValue(null);

    const res = await abrir();

    expect(res.status).toBe(500);
    expect(transaccion.rendicion.create).toHaveBeenCalledTimes(3);
    espia.mockRestore();
  });
});
