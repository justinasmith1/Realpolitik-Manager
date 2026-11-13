import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { clienteDePrueba } from '../../auth/__tests__/sesionSimulada';

// Pantalla Rendiciones (HU3.2), con la base simulada: `GET /rendiciones?anio=&mes=` lista las
// rendiciones activas del período, de todos los clientes, con su avance, la fecha de su último
// paso y en el orden de la pantalla.
const { prismaMock } = vi.hoisted(() => {
  const delegado = () => ({ findFirst: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() });
  return {
    prismaMock: {
      cliente: delegado(),
      rendicion: delegado(),
      itemChecklist: delegado(),
      $transaction: vi.fn(),
    },
  };
});

vi.mock('../../../lib/prisma', async () => {
  const { conSesionesSimuladas } = await import('../../auth/__tests__/sesionSimulada');
  return { prisma: conSesionesSimuladas(prismaMock) };
});

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const id = (n: number) => `e1f2a3b4-c5d6-4789-8abc-${String(n).padStart(12, '0')}`;
const CLIENTE_A = 'a1b2c3d4-e5f6-4789-abcd-ef0123456701';
const CLIENTE_B = 'a1b2c3d4-e5f6-4789-abcd-ef0123456702';
const ENVIO = new Date('2026-11-03T15:00:00.000Z');
const ALTA = new Date('2026-11-01T12:00:00.000Z');

const MUNI = { denominacion: 'Muni Ejemplo', sector: 'PUBLICO', subtipo: 'MUNICIPAL' };
const ZETA = { denominacion: 'Zeta', sector: 'PRIVADO', subtipo: null };

function fila(
  n: number,
  {
    clienteId = CLIENTE_A,
    cliente = MUNI,
    estado = 'EN_CURSO',
    historial = [{ estadoNuevo: 'EN_CURSO', fecha: ALTA }],
    anio = 2026,
    mes = 11,
    cobroFecha = null,
  }: {
    clienteId?: string;
    cliente?: object;
    estado?: string;
    anio?: number;
    mes?: number;
    cobroFecha?: Date | null;
    historial?: { estadoNuevo: string; fecha: Date; fechaEfectiva?: Date | null }[];
  } = {},
) {
  return {
    id: id(n),
    clienteId,
    anio,
    mes,
    numeroFactura: `B 00002-0000000${n}`,
    estado,
    cliente,
    historial,
    cobroFecha,
  };
}

/** Conteos como los devuelve `groupBy`: completados y pendientes de cada rendición. */
function conteos(avances: Record<number, [reunidos: number, total: number]>) {
  return Object.entries(avances).flatMap(([n, [reunidos, total]]) => [
    { rendicionId: id(Number(n)), completado: true, _count: { _all: reunidos } },
    { rendicionId: id(Number(n)), completado: false, _count: { _all: total - reunidos } },
  ]);
}

const listar = (query = '?anio=2026&mes=11') => clienteDePrueba(app).get(`/rendiciones${query}`);
const ids = (res: request.Response) => (res.body as { id: string }[]).map((r) => r.id);

// "Hoy" fijo: mediados de noviembre de 2026 en Buenos Aires. Atrasadas: septiembre o antes.
const HOY = new Date('2026-11-15T12:00:00-03:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  prismaMock.rendicion.findMany.mockResolvedValue([]);
  prismaMock.itemChecklist.groupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('GET /rendiciones?anio=&mes= (pantalla Rendiciones, HU3.2)', () => {
  it('pide solo las activas del período, de clientes vigentes, y cuenta los ítems de una vez', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([fila(1), fila(2)]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { anio: 2026, mes: 11, isDeleted: false, cliente: { isDeleted: false } },
      }),
    );
    // Sin N+1: un solo conteo para todas las rendiciones.
    expect(prismaMock.itemChecklist.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.itemChecklist.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rendicionId: { in: [id(1), id(2)] } } }),
    );
  });

  it('devuelve la fila del contrato: cliente, factura, estado y avance', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([fila(1)]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue(conteos({ 1: [2, 5] }));

    const res = await listar();

    expect(res.body).toEqual([
      {
        id: id(1),
        clienteId: CLIENTE_A,
        cliente: MUNI,
        numeroFactura: 'B 00002-00000001',
        estado: 'EN_CURSO',
        avance: { reunidos: 2, total: 5, faltantes: 3 },
        ultimoPaso: null,
        atrasada: false,
        cobro: null,
      },
    ]);
  });

  it('una rendición cobrada lleva la fecha del cobro como día, sin correrlo (HU3.10)', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([
      fila(1, {
        estado: 'ENVIADA',
        historial: [{ estadoNuevo: 'ENVIADA', fecha: ENVIO }],
        cobroFecha: new Date('2026-11-10T00:00:00.000Z'),
      }),
      fila(2),
    ]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue(conteos({ 1: [5, 5], 2: [1, 5] }));

    const res = await listar();

    const cobros = Object.fromEntries(
      (res.body as { id: string; cobro: unknown }[]).map((r) => [r.id, r.cobro]),
    );
    expect(cobros).toEqual({ [id(1)]: { fecha: '2026-11-10' }, [id(2)]: null });
  });

  it('pide la fecha del cobro de cada rendición (HU3.10)', async () => {
    await listar();

    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ cobroFecha: true }) as unknown,
      }),
    );
  });

  it('un cliente con dos rendiciones en el mes tiene una fila por cada una', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([fila(1), fila(2)]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue(conteos({ 1: [1, 4], 2: [3, 4] }));

    const res = await listar();

    expect(res.body).toEqual([
      expect.objectContaining({ id: id(1), clienteId: CLIENTE_A }),
      expect.objectContaining({ id: id(2), clienteId: CLIENTE_A }),
    ]);
  });

  it('ordena: primero las Rechazadas, después por avance de menor a mayor y, a igual avance, por cliente', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([
      fila(1, { cliente: ZETA, clienteId: CLIENTE_B }), // 50 %
      fila(2), // 100 %
      fila(3, {
        estado: 'RECHAZADA',
        historial: [{ estadoNuevo: 'RECHAZADA', fecha: ENVIO }],
      }), // 100 %, pero rechazada
      fila(4), // 50 %, Muni antes que Zeta
      fila(5, { cliente: ZETA, clienteId: CLIENTE_B }), // 0 %
    ]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue(
      conteos({ 1: [1, 2], 2: [2, 2], 3: [2, 2], 4: [2, 4], 5: [0, 3] }),
    );

    const res = await listar();

    expect(ids(res)).toEqual([id(3), id(5), id(4), id(1), id(2)]);
  });

  it('una rendición sin ítems cuenta como 0 % de avance', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([fila(1), fila(2, { cliente: ZETA })]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue(conteos({ 1: [1, 2] }));

    const res = await listar();

    expect(ids(res)).toEqual([id(2), id(1)]);
    expect((res.body as { avance: object }[])[0]?.avance).toEqual({
      reunidos: 0,
      total: 0,
      faltantes: 0,
    });
  });

  describe('fecha del último paso según el estado', () => {
    it.each(['EN_CURSO', 'COMPLETA'])('%s: sin fecha', async (estado) => {
      prismaMock.rendicion.findMany.mockResolvedValue([
        fila(1, { estado, historial: [{ estadoNuevo: estado, fecha: ENVIO }] }),
      ]);

      const res = await listar();

      expect((res.body as { ultimoPaso: unknown }[])[0]?.ultimoPaso).toBeNull();
    });

    it.each(['ENVIADA', 'APROBADA', 'RECHAZADA'])(
      '%s: el estado y la fecha de la entrada que la llevó ahí',
      async (estado) => {
        prismaMock.rendicion.findMany.mockResolvedValue([
          fila(1, { estado, historial: [{ estadoNuevo: estado, fecha: ENVIO }] }),
        ]);

        const res = await listar();

        expect((res.body as { ultimoPaso: unknown }[])[0]?.ultimoPaso).toEqual({
          estado,
          fecha: ENVIO.toISOString(),
        });
      },
    );

    it('ENVIADA con fecha de envío elegida (HU3.7): esa fecha, no la del registro', async () => {
      prismaMock.rendicion.findMany.mockResolvedValue([
        fila(1, {
          estado: 'ENVIADA',
          // Prisma lee una columna DATE como la medianoche UTC de ese día.
          historial: [
            {
              estadoNuevo: 'ENVIADA',
              fecha: ENVIO,
              fechaEfectiva: new Date('2026-10-03T00:00:00Z'),
            },
          ],
        }),
      ]);

      const res = await listar();

      // El inicio del 03/10 en Buenos Aires: "Enviada 03/10" en la pantalla.
      expect((res.body as { ultimoPaso: unknown }[])[0]?.ultimoPaso).toEqual({
        estado: 'ENVIADA',
        fecha: '2026-10-03T03:00:00.000Z',
      });
    });

    it('pide solo la última entrada del historial, la más reciente', async () => {
      await listar();

      expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            historial: {
              orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { estadoNuevo: true, fecha: true, fechaEfectiva: true },
            },
          }) as unknown,
        }),
      );
    });

    it('si la última entrada no es la del estado actual, no inventa una fecha', async () => {
      prismaMock.rendicion.findMany.mockResolvedValue([
        fila(1, { estado: 'ENVIADA', historial: [{ estadoNuevo: 'COMPLETA', fecha: ENVIO }] }),
      ]);

      const res = await listar();

      expect((res.body as { ultimoPaso: unknown }[])[0]?.ultimoPaso).toBeNull();
    });
  });

  it('un período sin rendiciones es una lista vacía, sin contar ítems', async () => {
    const res = await listar('?anio=2026&mes=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(prismaMock.itemChecklist.groupBy).not.toHaveBeenCalled();
  });

  it.each([
    ['sin parámetros', '', ['anio', 'mes']],
    ['sin mes', '?anio=2026', ['mes']],
    ['con un mes 13', '?anio=2026&mes=13', ['mes']],
    ['con un año fuera de rango', '?anio=2019&mes=1', ['anio']],
    ['con un mes repetido', '?anio=2026&mes=1&mes=2', ['mes']],
  ])('400 VALIDATION_ERROR %s, sin consultar la base', async (_caso, query, campos) => {
    const res = await listar(query);

    expect(res.status).toBe(400);
    const error = (res.body as { error: { code: string; details: { campo: string }[] } }).error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.map((d) => d.campo)).toEqual(campos);
    expect(prismaMock.rendicion.findMany).not.toHaveBeenCalled();
  });

  describe('atrasada (HU3.4)', () => {
    it.each([
      ['septiembre (dos meses atrás), En curso', 9, 'EN_CURSO', true],
      ['septiembre, Completa', 9, 'COMPLETA', true],
      ['septiembre, Enviada', 9, 'ENVIADA', false],
      ['octubre (mes anterior), En curso', 10, 'EN_CURSO', false],
      ['noviembre (mes actual), En curso', 11, 'EN_CURSO', false],
    ])('%s: atrasada %s', async (_caso, mes, estado, atrasada) => {
      prismaMock.rendicion.findMany.mockResolvedValue([fila(1, { mes, estado, historial: [] })]);

      const res = await listar(`?anio=2026&mes=${mes}`);

      expect((res.body as { atrasada: boolean }[])[0]?.atrasada).toBe(atrasada);
    });

    it('ordena: primero las atrasadas, después las Rechazadas, después por avance', async () => {
      prismaMock.rendicion.findMany.mockResolvedValue([
        fila(1, { mes: 9, estado: 'EN_CURSO' }),
        fila(2, { mes: 9, estado: 'RECHAZADA', historial: [] }),
        fila(3, { mes: 9, estado: 'COMPLETA', cliente: ZETA, clienteId: CLIENTE_B }),
        fila(4, { mes: 9, estado: 'ENVIADA', historial: [] }),
      ]);
      // La atrasada Completa tiene más avance que la enviada, y aun así va antes.
      prismaMock.itemChecklist.groupBy.mockResolvedValue(
        conteos({ 1: [1, 4], 2: [3, 4], 3: [4, 4], 4: [0, 4] }),
      );

      const res = await listar('?anio=2026&mes=9');

      expect(ids(res)).toEqual([id(1), id(3), id(2), id(4)]);
      expect((res.body as { atrasada: boolean }[]).map((r) => r.atrasada)).toEqual([
        true,
        true,
        false,
        false,
      ]);
    });
  });

  it('no choca con el detalle: GET /rendiciones/:id sigue siendo una rendición', async () => {
    prismaMock.rendicion.findFirst.mockResolvedValue(null);

    const res = await clienteDePrueba(app).get(`/rendiciones/${id(1)}`);

    expect(res.status).toBe(404);
    expect(prismaMock.rendicion.findFirst).toHaveBeenCalled();
    expect(prismaMock.rendicion.findMany).not.toHaveBeenCalled();
  });
});
