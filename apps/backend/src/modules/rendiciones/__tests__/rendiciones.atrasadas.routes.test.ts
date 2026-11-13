import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { clienteDePrueba } from '../../auth/__tests__/sesionSimulada';

// Rendiciones atrasadas (HU3.4), con la base simulada: `GET /rendiciones/atrasadas` lista las
// rendiciones activas sin enviar (En curso o Completa) de dos meses atrás o más, de cualquier mes,
// de la más vieja a la más nueva.
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
const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456701';
const MUNI = { denominacion: 'Muni Ejemplo', sector: 'PUBLICO', subtipo: 'MUNICIPAL' };
const ZETA = { denominacion: 'Zeta', sector: 'PRIVADO', subtipo: null };
const ANDINA = { denominacion: 'Andina', sector: 'PRIVADO', subtipo: null };

interface OpcionesDeFila {
  anio?: number;
  mes?: number;
  estado?: string;
  cliente?: object;
}

function fila(
  n: number,
  { anio = 2026, mes = 9, estado = 'EN_CURSO', cliente = MUNI }: OpcionesDeFila = {},
) {
  return {
    id: id(n),
    clienteId: CLIENTE,
    anio,
    mes,
    numeroFactura: `B 00002-0000000${n}`,
    estado,
    cliente,
    historial: [],
  };
}

const listar = () => clienteDePrueba(app).get('/rendiciones/atrasadas');
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

describe('GET /rendiciones/atrasadas (HU3.4)', () => {
  it('pide a la base las activas, sin enviar y de septiembre o antes, y cuenta los ítems de una vez', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([fila(1), fila(2, { mes: 8 })]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isDeleted: false,
          cliente: { isDeleted: false },
          estado: { in: ['EN_CURSO', 'COMPLETA'] },
          OR: [{ anio: { lt: 2026 } }, { anio: 2026, mes: { lte: 9 } }],
        },
      }),
    );
    // Sin N+1: un solo conteo para todas.
    expect(prismaMock.itemChecklist.groupBy).toHaveBeenCalledTimes(1);
  });

  it('devuelve la fila del mes con su período y atrasada: true', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([fila(1, { estado: 'COMPLETA' })]);
    prismaMock.itemChecklist.groupBy.mockResolvedValue([
      { rendicionId: id(1), completado: true, _count: { _all: 3 } },
    ]);

    const res = await listar();

    expect(res.body).toEqual([
      {
        id: id(1),
        clienteId: CLIENTE,
        cliente: MUNI,
        numeroFactura: 'B 00002-00000001',
        estado: 'COMPLETA',
        avance: { reunidos: 3, total: 3, faltantes: 0 },
        ultimoPaso: null,
        atrasada: true,
        cobro: null,
        anio: 2026,
        mes: 9,
      },
    ]);
  });

  it('ordena de la más vieja a la más nueva y, a igual período, por cliente', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([
      fila(1, { anio: 2026, mes: 9, cliente: ZETA }),
      fila(2, { anio: 2025, mes: 12 }),
      fila(3, { anio: 2026, mes: 9, cliente: ANDINA }),
      fila(4, { anio: 2026, mes: 3 }),
    ]);

    const res = await listar();

    expect(ids(res)).toEqual([id(2), id(4), id(3), id(1)]);
  });

  it('si la base devolviera una que la regla no marca, no la lista (la marca y el listado coinciden)', async () => {
    prismaMock.rendicion.findMany.mockResolvedValue([
      fila(1),
      fila(2, { mes: 10 }),
      fila(3, { estado: 'ENVIADA' }),
    ]);

    const res = await listar();

    expect(ids(res)).toEqual([id(1)]);
  });

  it('sin atrasadas, una lista vacía y sin contar ítems', async () => {
    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(prismaMock.itemChecklist.groupBy).not.toHaveBeenCalled();
  });

  it('en enero, el límite cruza de año: noviembre del año anterior', async () => {
    vi.setSystemTime(new Date('2027-01-10T12:00:00-03:00'));

    await listar();

    expect(prismaMock.rendicion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ anio: { lt: 2026 } }, { anio: 2026, mes: { lte: 11 } }],
        }) as unknown,
      }),
    );
  });

  it('no choca con el detalle: "atrasadas" no se lee como un id', async () => {
    const res = await listar();

    expect(res.status).toBe(200);
    expect(prismaMock.rendicion.findFirst).not.toHaveBeenCalled();
    // Y el detalle por id sigue andando.
    prismaMock.rendicion.findFirst.mockResolvedValue(null);
    expect((await clienteDePrueba(app).get(`/rendiciones/${id(1)}`)).status).toBe(404);
  });
});
