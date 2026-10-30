import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Igual que en requisitos: la base está simulada y se recorre route → validate → controller →
// service → mapper → errorHandler. El mock no puede demostrar el índice parcial ni el aislamiento
// real; sí el orden, los argumentos y la traducción de los errores de Prisma.
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

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OTRO_CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456700';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const OTRA = 'e1f2a3b4-c5d6-4789-8abc-def012345699';
const REQ_PRINT = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const REQ_FACTURA = 'd1e2f3a4-b5c6-4789-8abc-def012345601';
const TIPO_PRINT = 'c1d2e3f4-a5b6-4789-8abc-def012345678';
const TIPO_FACTURA = 'c1d2e3f4-a5b6-4789-8abc-def012345601';
// Mediados de octubre de 2026 en Buenos Aires: el período máximo es noviembre.
const HOY = new Date('2026-10-15T12:00:00-03:00');
const AHORA = new Date('2026-10-15T15:00:00.000Z');

const CAMPOS_DE_RENDICION = [
  'actualizadoEn',
  'anio',
  'anuladaEn',
  'clienteId',
  'creadoEn',
  'emisor',
  'estado',
  'id',
  'mes',
  'numeroFactura',
];

function filaRendicion(extra: Record<string, unknown> = {}) {
  return {
    id: RENDICION,
    clienteId: CLIENTE,
    anio: 2026,
    mes: 10,
    numeroFactura: 'A 00001-00000001',
    isDeleted: false,
    deletedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...extra,
  };
}

const requisito = (extra: Record<string, unknown>) => ({
  clienteId: CLIENTE,
  nota: 'No se copia',
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
  ...extra,
});

// Print x3 con días y sin canal propio; Factura x1 sin días y con canal propio.
const MATRIZ = [
  requisito({
    id: REQ_PRINT,
    tipoDocumentoId: TIPO_PRINT,
    tipoDocumento: { nombre: 'Print' },
    cantidad: 3,
    diasAproximados: [1, 10, 20],
    canalEntrega: null,
  }),
  requisito({
    id: REQ_FACTURA,
    tipoDocumentoId: TIPO_FACTURA,
    tipoDocumento: { nombre: 'Factura' },
    cantidad: 1,
    diasAproximados: [],
    canalEntrega: 'PORTAL_WEB',
  }),
];

const clienteDe = (extra: Record<string, unknown> = {}) => ({
  id: CLIENTE,
  estado: 'ACTIVO',
  canalEntrega: 'CORREO',
  emisor: 'SOCIEDAD',
  ...extra,
});

function errorPrisma(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
    ...(meta === undefined ? {} : { meta }),
  });
}

const silenciarConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const abrir = (body: object, id = CLIENTE) =>
  request(app).post(`/clientes/${id}/rendiciones`).send(body);
const listar = (query = '', id = CLIENTE) =>
  request(app).get(`/clientes/${id}/rendiciones${query}`);
const obtener = (id = RENDICION) => request(app).get(`/rendiciones/${id}`);
const anular = (body: object = { estado: 'ANULADA' }, id = RENDICION) =>
  request(app).patch(`/rendiciones/${id}/estado`).send(body);

interface CuerpoDeError {
  error: { code: string; details: unknown };
}
const error = (res: request.Response) => (res.body as CuerpoDeError).error;
const campos = (res: request.Response) =>
  (error(res).details as { campo: string }[]).map((detalle) => detalle.campo);

/** Escrito como lo cargaría la operadora: se guarda en su forma canónica `B 00002-00001482`. */
const pedido = { anio: 2026, mes: 10, numeroFactura: 'b 2-1482' };

/** Lo que la creación recibió en `data` (sin el anidado de ítems). */
function datosCreados() {
  const llamada = transaccion.rendicion.create.mock.calls[0] as
    | [{ data: Record<string, unknown> & { items: { createMany: { data: unknown[] } } } }]
    | undefined;
  return llamada?.[0].data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  for (const db of [prismaMock, transaccion]) {
    db.cliente.findFirst.mockResolvedValue(clienteDe());
  }
  transaccion.requisitoCliente.findMany.mockResolvedValue(MATRIZ);
  // La creación devuelve la rendición con los ítems que recibió, como lo haría la base.
  transaccion.rendicion.create.mockImplementation(
    (args: { data: Record<string, unknown> & { items: { createMany: { data: object[] } } } }) =>
      Promise.resolve(
        filaRendicion({
          numeroFactura: args.data.numeroFactura,
          emisor: args.data.emisor,
          items: args.data.items.createMany.data.map((item, indice) => ({
            id: `f1a2b3c4-d5e6-4789-8abc-def01234567${indice}`,
            rendicionId: RENDICION,
            completado: false,
            completadoAt: null,
            createdAt: AHORA,
            updatedAt: AHORA,
            ...item,
          })),
        }),
      ),
  );
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('POST /clientes/:id/rendiciones', () => {
  it('abre la rendición con un ítem por unidad de cada requisito activo (201)', async () => {
    const res = await abrir(pedido);

    expect(res.status).toBe(201);
    const items = (res.body as { items: Record<string, unknown>[] }).items;
    // Por nombre del tipo y ordinal: Factura antes que Print.
    expect(
      items.map(({ nombreTipoDocumento, ordinal, totalOrdinal, diaAproximado }) => ({
        nombreTipoDocumento,
        ordinal,
        totalOrdinal,
        diaAproximado,
      })),
    ).toEqual([
      { nombreTipoDocumento: 'Factura', ordinal: 1, totalOrdinal: 1, diaAproximado: null },
      { nombreTipoDocumento: 'Print', ordinal: 1, totalOrdinal: 3, diaAproximado: 1 },
      { nombreTipoDocumento: 'Print', ordinal: 2, totalOrdinal: 3, diaAproximado: 10 },
      { nombreTipoDocumento: 'Print', ordinal: 3, totalOrdinal: 3, diaAproximado: 20 },
    ]);
    expect(items.every((item) => item.completado === false && item.completadoEn === null)).toBe(
      true,
    );
  });

  it('el canal del ítem es el del requisito o, si no tiene, el del cliente', async () => {
    const res = await abrir(pedido);

    const canales = (res.body as { items: { nombreTipoDocumento: string; canalEntrega: string }[] })
      .items;
    expect(canales.find((item) => item.nombreTipoDocumento === 'Factura')?.canalEntrega).toBe(
      'PORTAL_WEB',
    );
    expect(
      canales
        .filter((item) => item.nombreTipoDocumento === 'Print')
        .every((item) => item.canalEntrega === 'CORREO'),
    ).toBe(true);
  });

  it('guarda el número de factura en su forma canónica y copia solo el snapshot del contrato', async () => {
    await abrir({ ...pedido, numeroFactura: '  b2 - 1482 ' });

    const datos = datosCreados();
    expect(datos).toMatchObject({
      clienteId: CLIENTE,
      anio: 2026,
      mes: 10,
      numeroFactura: 'B 00002-00001482',
    });
    expect(datos?.items.createMany.data[0]).toEqual({
      requisitoClienteId: REQ_FACTURA,
      tipoDocumentoId: TIPO_FACTURA,
      nombreTipoDocumento: 'Factura',
      ordinal: 1,
      totalOrdinal: 1,
      diaAproximado: null,
      canalEntrega: 'PORTAL_WEB',
    });
  });

  it('responde con la rendición del contrato, sin campos internos', async () => {
    const res = await abrir(pedido);

    const cuerpo = res.body as Record<string, unknown>;
    expect(Object.keys(cuerpo).sort()).toEqual([...CAMPOS_DE_RENDICION, 'items'].sort());
    expect(cuerpo).toMatchObject({
      estado: 'ACTIVA',
      anuladaEn: null,
      numeroFactura: 'B 00002-00001482',
    });
  });

  it('lee la matriz y crea la rendición en una transacción serializable', async () => {
    await abrir(pedido);

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaccion.requisitoCliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clienteId: CLIENTE, isDeleted: false } }),
    );
  });

  it.each([
    ['sin número de factura', { anio: 2026, mes: 10 }, 'numeroFactura'],
    ['con un número de factura en blanco', { ...pedido, numeroFactura: '   ' }, 'numeroFactura'],
    [
      'con un número de factura sin letra',
      { ...pedido, numeroFactura: '00002-00001482' },
      'numeroFactura',
    ],
    ['con la letra D', { ...pedido, numeroFactura: 'D 00002-00001482' }, 'numeroFactura'],
    ['con el formato viejo', { ...pedido, numeroFactura: 'FC-1234' }, 'numeroFactura'],
    ['con un mes fuera de rango', { ...pedido, mes: 13 }, 'mes'],
    ['con un año anterior a 2020', { ...pedido, anio: 2019 }, 'anio'],
    ['con un período posterior al mes siguiente', { ...pedido, mes: 12 }, 'mes'],
  ])('400 %s', async (_caso, body, campo) => {
    const res = await abrir(body);

    expect(res.status).toBe(400);
    expect(campos(res)).toContain(campo);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('el 400 de un número de factura inválido dice el formato esperado con un ejemplo', async () => {
    const res = await abrir({ ...pedido, numeroFactura: 'B 000002-00001482' });

    expect(res.status).toBe(400);
    expect(error(res).details).toEqual([
      {
        campo: 'numeroFactura',
        mensaje: expect.stringContaining('B 00002-00001482') as unknown,
      },
    ]);
  });

  it.each(['b 2-1482', 'B2-1482', ' B 00002 - 00001482 ', 'B 00002-00001482'])(
    'escrituras distintas del mismo comprobante se guardan igual (%j): la unicidad las ve como una',
    async (numeroFactura) => {
      await abrir({ ...pedido, numeroFactura });

      expect(datosCreados()?.numeroFactura).toBe('B 00002-00001482');
    },
  );

  it('acepta el mes siguiente al actual', async () => {
    const res = await abrir({ ...pedido, mes: 11 });

    expect(res.status).toBe(201);
  });

  it('400 si el id del cliente no es un uuid', async () => {
    const res = await abrir(pedido, 'no-es-uuid');

    expect(res.status).toBe(400);
    expect(campos(res)).toEqual(['id']);
  });

  it('404 si el cliente no existe o está borrado', async () => {
    transaccion.cliente.findFirst.mockResolvedValue(null);

    const res = await abrir(pedido);

    expect(res.status).toBe(404);
    expect(transaccion.cliente.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CLIENTE, isDeleted: false } }),
    );
    expect(transaccion.rendicion.create).not.toHaveBeenCalled();
  });

  it.each(['INACTIVO', 'SUSPENDIDO'])('409 CLIENTE_NO_ACTIVO con el cliente %s', async (estado) => {
    transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ estado }));

    const res = await abrir(pedido);

    expect(res.status).toBe(409);
    expect(error(res).details).toEqual({ motivo: 'CLIENTE_NO_ACTIVO', estado });
    expect(transaccion.rendicion.create).not.toHaveBeenCalled();
  });

  it('409 MATRIZ_VACIA sin requisitos activos', async () => {
    transaccion.requisitoCliente.findMany.mockResolvedValue([]);

    const res = await abrir(pedido);

    expect(res.status).toBe(409);
    expect(error(res).details).toEqual({ motivo: 'MATRIZ_VACIA' });
    expect(transaccion.rendicion.create).not.toHaveBeenCalled();
  });

  describe('emisor (HU2.9)', () => {
    it('sin emisor en el pedido, copia el del cliente', async () => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ emisor: 'PERSONA_FISICA' }));

      const res = await abrir(pedido);

      expect(res.status).toBe(201);
      expect(datosCreados()).toMatchObject({ emisor: 'PERSONA_FISICA' });
      expect(res.body).toMatchObject({ emisor: 'PERSONA_FISICA' });
    });

    it('el emisor del pedido prevalece sobre el del cliente', async () => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ emisor: 'SOCIEDAD' }));

      const res = await abrir({ ...pedido, emisor: 'PERSONA_FISICA' });

      expect(res.status).toBe(201);
      expect(datosCreados()).toMatchObject({ emisor: 'PERSONA_FISICA' });
    });

    it('si el cliente tiene emisor, el pedido puede omitirlo y no se escribe null', async () => {
      await abrir(pedido);

      expect(datosCreados()).toMatchObject({ emisor: 'SOCIEDAD' });
    });

    it('lee el emisor del cliente dentro de la transacción del alta', async () => {
      await abrir(pedido);

      expect(transaccion.cliente.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ emisor: true }) as unknown,
        }),
      );
    });

    it('400 en `emisor` si ni el pedido ni el cliente lo tienen, sin crear nada', async () => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ emisor: null }));

      const res = await abrir(pedido);

      expect(res.status).toBe(400);
      expect(error(res).code).toBe('VALIDATION_ERROR');
      expect(campos(res)).toEqual(['emisor']);
      expect(transaccion.rendicion.create).not.toHaveBeenCalled();
    });

    it('con un cliente sin emisor, elegirlo en el pedido alcanza', async () => {
      transaccion.cliente.findFirst.mockResolvedValue(clienteDe({ emisor: null }));

      const res = await abrir({ ...pedido, emisor: 'SOCIEDAD' });

      expect(res.status).toBe(201);
      expect(datosCreados()).toMatchObject({ emisor: 'SOCIEDAD' });
    });

    it('un emisor desconocido o null en el pedido es 400 en `emisor`, sin tocar la base', async () => {
      for (const emisor of ['OTRO', null]) {
        const res = await abrir({ ...pedido, emisor });
        expect(res.status).toBe(400);
        expect(campos(res)).toEqual(['emisor']);
      }
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('un cliente inactivo sigue siendo 409 CLIENTE_NO_ACTIVO antes de pedir el emisor', async () => {
      transaccion.cliente.findFirst.mockResolvedValue(
        clienteDe({ estado: 'INACTIVO', emisor: null }),
      );

      const res = await abrir(pedido);

      expect(res.status).toBe(409);
      expect(error(res).details).toMatchObject({ motivo: 'CLIENTE_NO_ACTIVO' });
    });
  });

  describe('factura duplicada para el mismo emisor (HU2.9)', () => {
    // Lo que informa Prisma de verdad (verificado contra PostgreSQL 16, también dentro de una
    // transacción serializable): `meta.target` son las COLUMNAS del índice, no su nombre. Los
    // nombres se aceptan igual por si otra versión de Prisma informa el índice.
    it.each([
      ['las columnas que informa Prisma (emisor)', ['emisor', 'numeroFactura']],
      ['el nombre del índice por emisor', 'uq_rendicion_emisor_factura_activa'],
    ])(
      '409 RENDICION_DUPLICADA con la rendición existente y su clienteId (P2002 con %s)',
      async (_caso, target) => {
        transaccion.rendicion.create.mockRejectedValue(errorPrisma('P2002', { target }));
        prismaMock.rendicion.findFirst.mockResolvedValue({
          id: OTRA,
          clienteId: OTRO_CLIENTE,
          anio: 2026,
          mes: 9,
          numeroFactura: 'B 00002-00001482',
        });

        const res = await abrir(pedido);

        expect(res.status).toBe(409);
        expect(error(res).details).toEqual({
          motivo: 'RENDICION_DUPLICADA',
          rendicionExistente: {
            id: OTRA,
            clienteId: OTRO_CLIENTE,
            anio: 2026,
            mes: 9,
            numeroFactura: 'B 00002-00001482',
          },
        });
      },
    );

    it('busca la existente por (emisor, número) entre todos los clientes, sin mirar a las heredadas sin emisor', async () => {
      transaccion.rendicion.create.mockRejectedValue(
        errorPrisma('P2002', { target: ['emisor', 'numeroFactura'] }),
      );
      prismaMock.rendicion.findFirst.mockResolvedValue({
        id: OTRA,
        clienteId: OTRO_CLIENTE,
        anio: 2026,
        mes: 9,
        numeroFactura: 'B 00002-00001482',
      });

      await abrir(pedido);

      // El valor canónico, no lo que se escribió; sin filtrar por el cliente que abre. Una alta
      // siempre lleva emisor, así que solo puede chocar con el índice por emisor: buscar también
      // una heredada (`emisor: null`) del mismo cliente podría llevar a la rendición equivocada.
      expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDeleted: false, numeroFactura: 'B 00002-00001482', emisor: 'SOCIEDAD' },
        }),
      );
    });

    it('el emisor que se busca es el que resolvió el alta (el del pedido, no el del cliente)', async () => {
      transaccion.rendicion.create.mockRejectedValue(
        errorPrisma('P2002', { target: ['emisor', 'numeroFactura'] }),
      );
      prismaMock.rendicion.findFirst.mockResolvedValue({
        id: OTRA,
        clienteId: OTRO_CLIENTE,
        anio: 2026,
        mes: 9,
        numeroFactura: 'B 00002-00001482',
      });

      await abrir({ ...pedido, emisor: 'PERSONA_FISICA' });

      expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ emisor: 'PERSONA_FISICA' }) as unknown,
        }),
      );
    });

    it('si la rendición que tenía la factura ya no está, reintenta el alta', async () => {
      transaccion.rendicion.create.mockRejectedValueOnce(
        errorPrisma('P2002', { target: ['emisor', 'numeroFactura'] }),
      );
      prismaMock.rendicion.findFirst.mockResolvedValue(null);

      const res = await abrir(pedido);

      expect(res.status).toBe(201);
      expect(transaccion.rendicion.create).toHaveBeenCalledTimes(2);
    });

    it('el mismo número con otro emisor no es duplicado: se abre', async () => {
      // El índice solo rechaza (emisor, número) repetidos; con otro emisor la base acepta.
      const res = await abrir({ ...pedido, emisor: 'PERSONA_FISICA' });

      expect(res.status).toBe(201);
      expect(prismaMock.rendicion.findFirst).not.toHaveBeenCalled();
    });
  });

  it('un P2002 de otro índice no es RENDICION_DUPLICADA: sigue siendo 500', async () => {
    const espia = silenciarConsoleError();
    transaccion.rendicion.create.mockRejectedValue(
      errorPrisma('P2002', { target: ['rendicionId', 'requisitoClienteId', 'ordinal'] }),
    );

    const res = await abrir(pedido);

    expect(res.status).toBe(500);
    expect(prismaMock.rendicion.findFirst).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe('GET /clientes/:id/rendiciones', () => {
  beforeEach(() => {
    prismaMock.rendicion.findMany.mockResolvedValue([
      filaRendicion(),
      filaRendicion({ id: OTRA, mes: 9, numeroFactura: 'A 00001-00000002' }),
    ]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue([
      { rendicionId: RENDICION, completado: false, _count: { _all: 3 } },
      { rendicionId: RENDICION, completado: true, _count: { _all: 1 } },
      { rendicionId: OTRA, completado: false, _count: { _all: 2 } },
    ]);
  });

  it('lista las activas, ordenadas, con el avance de cada una', async () => {
    const res = await listar();

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith({
      where: { clienteId: CLIENTE, isDeleted: false },
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }, { createdAt: 'desc' }],
    });
    const lista = res.body as { id: string; resumen: unknown }[];
    expect(lista.map(({ id, resumen }) => ({ id, resumen }))).toEqual([
      { id: RENDICION, resumen: { totalItems: 4, completados: 1 } },
      { id: OTRA, resumen: { totalItems: 2, completados: 0 } },
    ]);
    expect(Object.keys(lista[0] ?? {}).sort()).toEqual([...CAMPOS_DE_RENDICION, 'resumen'].sort());
  });

  it('filtra por año y mes', async () => {
    await listar('?anio=2026&mes=9');

    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clienteId: CLIENTE, isDeleted: false, anio: 2026, mes: 9 },
      }),
    );
  });

  it('con requisitoId lista solo las que tienen ítems de ese requisito', async () => {
    const requisitoId = 'd1e2f3a4-b5c6-4789-8abc-def012345601';

    await listar(`?estado=ACTIVA&requisitoId=${requisitoId}`);

    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clienteId: CLIENTE,
          isDeleted: false,
          items: { some: { requisitoClienteId: requisitoId } },
        },
      }),
    );
  });

  it('400 si requisitoId no es un uuid', async () => {
    const res = await listar('?requisitoId=no-es-uuid');

    expect(res.status).toBe(400);
    expect(
      (res.body as { error: { details: { campo: string }[] } }).error.details.map((d) => d.campo),
    ).toEqual(['requisitoId']);
    expect(prismaMock.rendicion.findMany).not.toHaveBeenCalled();
  });

  it('sin rendiciones responde una lista vacía y no cuenta ítems', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(prismaMock.itemChecklist.groupBy).not.toHaveBeenCalled();
  });

  describe('filtro de estado', () => {
    const ORDEN = [{ anio: 'desc' }, { mes: 'desc' }, { createdAt: 'desc' }];

    it('sin estado lista solo las activas (default ACTIVA)', async () => {
      await listar();

      expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith({
        where: { clienteId: CLIENTE, isDeleted: false },
        orderBy: ORDEN,
      });
    });

    it('ACTIVA es lo mismo que no mandarlo', async () => {
      await listar('?estado=ACTIVA');

      expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith({
        where: { clienteId: CLIENTE, isDeleted: false },
        orderBy: ORDEN,
      });
    });

    it('ANULADA lista solo las anuladas, con su estado y fecha', async () => {
      prismaMock.rendicion.findMany.mockResolvedValue([
        filaRendicion({ isDeleted: true, deletedAt: new Date('2026-10-20T15:00:00.000Z') }),
      ]);

      const res = await listar('?estado=ANULADA&anio=2026');

      expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith({
        where: { clienteId: CLIENTE, isDeleted: true, anio: 2026 },
        orderBy: ORDEN,
      });
      expect(res.body).toEqual([
        expect.objectContaining({ estado: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' }),
      ]);
    });

    it('TODAS no filtra por estado y ordena primero las activas', async () => {
      await listar('?estado=TODAS');

      expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith({
        where: { clienteId: CLIENTE },
        orderBy: [{ isDeleted: 'asc' }, ...ORDEN],
      });
    });

    it.each(['?estado=activa', '?estado=BORRADA', '?estado=', '?estado=ACTIVA&estado=TODAS'])(
      '400 VALIDATION_ERROR con %s',
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

  it.each(['?anio=abc', '?mes=13', '?anio=2019'])('400 con %s', async (query) => {
    const res = await listar(query);

    expect(res.status).toBe(400);
    expect(prismaMock.rendicion.findMany).not.toHaveBeenCalled();
  });

  it('404 si el cliente no existe o está borrado', async () => {
    prismaMock.cliente.findFirst.mockResolvedValue(null);

    const res = await listar();

    expect(res.status).toBe(404);
    expect(prismaMock.rendicion.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /rendiciones/:id', () => {
  it('ordena los ítems como la apertura, aunque la base los devuelva en otro orden', async () => {
    // Nombres que solo difieren en acento o mayúscula: una collation de la base podría
    // ordenarlos distinto que `compararItemsDeChecklist` de shared.
    const nombres = ['Zeta', 'arco', 'Árbol', 'alfa'];
    transaccion.requisitoCliente.findMany.mockResolvedValue(
      nombres.map((nombre, indice) =>
        requisito({
          id: `d1e2f3a4-b5c6-4789-8abc-def01234560${indice}`,
          tipoDocumentoId: `c1d2e3f4-a5b6-4789-8abc-def01234560${indice}`,
          tipoDocumento: { nombre },
          cantidad: 1,
          diasAproximados: [],
          canalEntrega: null,
        }),
      ),
    );
    const apertura = await abrir(pedido);
    const ordenDeApertura = (
      apertura.body as { items: { nombreTipoDocumento: string }[] }
    ).items.map((item) => item.nombreTipoDocumento);
    // La base devuelve los mismos ítems al revés.
    const filasGuardadas = datosCreados()
      ?.items.createMany.data.map((item, indice) => ({
        id: `f1a2b3c4-d5e6-4789-8abc-def01234567${indice}`,
        rendicionId: RENDICION,
        completado: false,
        completadoAt: null,
        createdAt: AHORA,
        updatedAt: AHORA,
        ...(item as object),
      }))
      .reverse();
    prismaMock.rendicion.findFirst.mockResolvedValue(filaRendicion({ items: filasGuardadas }));

    const detalle = await obtener();

    expect(ordenDeApertura).toEqual(['alfa', 'Árbol', 'arco', 'Zeta']);
    expect(
      (detalle.body as { items: { nombreTipoDocumento: string }[] }).items.map(
        (item) => item.nombreTipoDocumento,
      ),
    ).toEqual(ordenDeApertura);
  });

  it('trae la rendición activa con su checklist', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValue(filaRendicion({ items: [] }));

    const res = await obtener();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, estado: 'ACTIVA', items: [] });
    expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RENDICION, cliente: { isDeleted: false } },
      }),
    );
  });

  it('una anulada también se ve, como historial, con su estado', async () => {
    const anuladaEn = new Date('2026-10-01T10:00:00.000Z');
    prismaMock.rendicion.findFirst.mockResolvedValue(
      filaRendicion({ isDeleted: true, deletedAt: anuladaEn, items: [] }),
    );

    const res = await obtener();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'ANULADA', anuladaEn: anuladaEn.toISOString() });
    expect(Object.keys(res.body as object).sort()).toEqual(
      [...CAMPOS_DE_RENDICION, 'items'].sort(),
    );
  });

  it('404 si no existe o su cliente está borrado', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValue(null);

    const res = await obtener();

    expect(res.status).toBe(404);
  });
});

describe('PATCH /rendiciones/:id/estado', () => {
  beforeEach(() => {
    prismaMock.rendicion.findFirst.mockResolvedValue(filaRendicion());
    prismaMock.rendicion.update.mockImplementation(
      (args: { data: { isDeleted: boolean; deletedAt: Date } }) =>
        Promise.resolve(filaRendicion(args.data)),
    );
  });

  it('anula con baja lógica y responde la rendición anulada', async () => {
    const res = await anular();

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.update).toHaveBeenCalledWith({
      where: { id: RENDICION, isDeleted: false },
      data: { isDeleted: true, deletedAt: expect.any(Date) as unknown },
    });
    const cuerpo = res.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ estado: 'ANULADA', anuladaEn: HOY.toISOString() });
    expect(Object.keys(cuerpo).sort()).toEqual(CAMPOS_DE_RENDICION);
  });

  it('una ya anulada se devuelve tal cual, sin escribir', async () => {
    const antes = new Date('2026-10-01T10:00:00.000Z');
    prismaMock.rendicion.findFirst.mockResolvedValue(
      filaRendicion({ isDeleted: true, deletedAt: antes }),
    );

    const res = await anular();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'ANULADA', anuladaEn: antes.toISOString() });
    expect(prismaMock.rendicion.update).not.toHaveBeenCalled();
  });

  it('si otro pedido la anuló en el medio, devuelve cómo quedó', async () => {
    const antes = new Date('2026-10-01T10:00:00.000Z');
    prismaMock.rendicion.update.mockRejectedValue(errorPrisma('P2025'));
    prismaMock.rendicion.findFirst
      .mockResolvedValueOnce(filaRendicion())
      .mockResolvedValueOnce(filaRendicion({ isDeleted: true, deletedAt: antes }));

    const res = await anular();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'ANULADA', anuladaEn: antes.toISOString() });
  });

  it('se puede anular aunque el cliente no esté activo: no consulta su estado', async () => {
    await anular();

    expect(prismaMock.rendicion.findFirst).toHaveBeenCalledWith({
      where: { id: RENDICION, cliente: { isDeleted: false } },
    });
    expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
  });

  it('404 si no existe o su cliente está borrado', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValue(null);

    const res = await anular();

    expect(res.status).toBe(404);
    expect(prismaMock.rendicion.update).not.toHaveBeenCalled();
  });

  it.each([{ estado: 'ACTIVA' }, {}, { estado: 'OTRO' }])(
    '400 con %j: no es reversible',
    async (body) => {
      const res = await anular(body);

      expect(res.status).toBe(400);
      expect(prismaMock.rendicion.update).not.toHaveBeenCalled();
    },
  );
});
