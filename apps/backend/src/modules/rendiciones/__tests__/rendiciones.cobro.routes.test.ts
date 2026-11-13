import { Prisma } from '@prisma/client';
import { hoyEnBuenosAires } from '@realpolitik/shared';
import type request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import { clienteDePrueba } from '../../auth/__tests__/sesionSimulada';
import { registrarCobro } from '../rendiciones.service';

// Cobro informado por el cliente (HU3.10), con la base simulada: `PUT` y `DELETE
// /rendiciones/:id/cobro` recorren route → validate → controller → service → mapper →
// errorHandler. El cobro es una marca de la rendición, no un estado: no toca el historial.
const { transaccion, prismaMock } = vi.hoisted(() => {
  const delegado = () => ({
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  });
  const transaccion = { rendicion: delegado() };
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
const ALTA = new Date('2026-10-15T15:00:00.000Z');
// 13/11/2026, 12:00 en Buenos Aires.
const HOY = new Date('2026-11-13T15:00:00.000Z');
/** El día siguiente a `dia` (`AAAA-MM-DD`): una fecha futura que no se vuelve válida con el tiempo. */
const diaSiguiente = (dia: string): string =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
// Mañana, según el reloj fijo de estos tests (en Buenos Aires).
const MANANA = diaSiguiente(hoyEnBuenosAires(HOY));

/** Una columna `DATE`, como la lee Prisma: la medianoche UTC del día. */
const columnaDate = (dia: string) => new Date(`${dia}T00:00:00.000Z`);

/** La rendición completa, como la devuelve la base con sus ítems y su historial. */
const filaDetalle = (
  estado: string,
  {
    cobroFecha = null,
    cobroNota = null,
  }: { cobroFecha?: Date | null; cobroNota?: string | null } = {},
) => ({
  id: RENDICION,
  clienteId: CLIENTE,
  anio: 2026,
  mes: 10,
  numeroFactura: 'A 00001-00000001',
  emisor: 'SOCIEDAD',
  numeroOc: null,
  montoMensual: null,
  montoTotal: null,
  cobroFecha,
  cobroNota,
  estado,
  historial: [{ estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: ALTA }],
  isDeleted: false,
  deletedAt: null,
  createdAt: ALTA,
  updatedAt: ALTA,
  items: [],
});

/** Lo que lee el servicio de la rendición antes de decidir. */
const lecturaDe = (estado: string, extra: Record<string, unknown> = {}) => ({
  estado,
  isDeleted: false,
  cobroFecha: null,
  ...extra,
});

const registrar = (cuerpo: unknown) =>
  clienteDePrueba(app)
    .put(`/rendiciones/${RENDICION}/cobro`)
    .send(cuerpo as object);
const quitar = () => clienteDePrueba(app).delete(`/rendiciones/${RENDICION}/cobro`);

const detalles = (res: request.Response) =>
  (res.body as { error: { details: unknown } }).error.details;

function errorPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ now: HOY, toFake: ['Date'] });
  prismaMock.$transaction.mockImplementation((trabajo: (tx: typeof transaccion) => unknown) =>
    trabajo(transaccion),
  );
  // El resultado refleja lo que se escribió.
  transaccion.rendicion.update.mockImplementation(
    ({ data }: { data: { cobroFecha: Date | null; cobroNota: string | null } }) =>
      Promise.resolve(filaDetalle('ENVIADA', data)),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PUT /rendiciones/:id/cobro (HU3.10)', () => {
  it('registra el cobro de una Enviada: 200 con el detalle, fecha como día y nota', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    const res = await registrar({ fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: RENDICION,
      cobro: { fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' },
    });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RENDICION },
        data: {
          cobroFecha: columnaDate('2026-11-10'),
          cobroNota: 'Avisó por mail Juan, de Tesorería',
        },
      }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('registra el cobro de una Aprobada, aunque una Aprobada ya no se modifique', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('APROBADA'));

    const res = await registrar({ fecha: '2026-11-12' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cobro: { fecha: '2026-11-12', nota: null } });
  });

  it('edita un cobro ya registrado: reemplaza el cobro entero', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('ENVIADA', { cobroFecha: columnaDate('2026-11-10') }),
    );

    const res = await registrar({ fecha: '2026-11-11', nota: 'Corregida' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cobro: { fecha: '2026-11-11', nota: 'Corregida' } });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cobroFecha: columnaDate('2026-11-11'), cobroNota: 'Corregida' },
      }),
    );
  });

  it('sin nota, la nota queda en null', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    const res = await registrar({ fecha: '2026-11-10' });

    expect(res.status).toBe(200);
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cobroFecha: columnaDate('2026-11-10'), cobroNota: null },
      }),
    );
  });

  it('con nota null, la nota queda en null', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    const res = await registrar({ fecha: '2026-11-10', nota: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cobro: { fecha: '2026-11-10', nota: null } });
  });

  it('recorta la nota', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    await registrar({ fecha: '2026-11-10', nota: '  Pagó  ' });

    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cobroNota: 'Pagó' }) as unknown,
      }),
    );
  });

  it('acepta la fecha de hoy (en Buenos Aires)', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    const res = await registrar({ fecha: '2026-11-13' });

    expect(res.status).toBe(200);
  });

  it('no toca el estado ni el historial: el cobro es una marca', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    await registrar({ fecha: '2026-11-10' });

    const { data } = transaccion.rendicion.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(data).sort()).toEqual(['cobroFecha', 'cobroNota']);
  });

  it('una fecha futura: 400 en fecha, sin llegar a la base', async () => {
    const res = await registrar({ fecha: MANANA });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [{ campo: 'fecha', mensaje: 'La fecha del cobro no puede ser posterior a hoy.' }],
      },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['una fecha que no existe', { fecha: '2026-02-30' }, 'fecha'],
    ['sin fecha', {}, 'fecha'],
    ['una fecha con otro formato', { fecha: '10/11/2026' }, 'fecha'],
    ['una nota vacía', { fecha: '2026-11-10', nota: '' }, 'nota'],
    ['una nota de solo espacios', { fecha: '2026-11-10', nota: '   ' }, 'nota'],
    ['una nota de 301 caracteres', { fecha: '2026-11-10', nota: 'a'.repeat(301) }, 'nota'],
  ])('%s: 400 VALIDATION_ERROR en %s', async (_caso, cuerpo, campo) => {
    const res = await registrar(cuerpo);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ campo }] },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('un id que no es un uuid: 400', async () => {
    const res = await clienteDePrueba(app)
      .put('/rendiciones/abc/cobro')
      .send({ fecha: '2026-11-10' });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('una rendición que no existe (o de un cliente borrado): 404', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(null);

    const res = await registrar({ fecha: '2026-11-10' });

    expect(res.status).toBe(404);
    expect(transaccion.rendicion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RENDICION, cliente: { isDeleted: false } } }),
    );
  });

  it('una anulada: 409 RENDICION_ANULADA, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('ENVIADA', { isDeleted: true }),
    );

    const res = await registrar({ fecha: '2026-11-10' });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('una anulada que además no está Enviada ni Aprobada: gana RENDICION_ANULADA', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('EN_CURSO', { isDeleted: true }),
    );

    const res = await registrar({ fecha: '2026-11-10' });

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
  });

  it.each(['EN_CURSO', 'COMPLETA', 'RECHAZADA'])(
    'una %s: 409 COBRO_ESTADO_INVALIDO con el estado actual, sin escribir',
    async (estado) => {
      transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe(estado));

      const res = await registrar({ fecha: '2026-11-10' });

      expect(res.status).toBe(409);
      expect(detalles(res)).toEqual({ motivo: 'COBRO_ESTADO_INVALIDO', estadoActual: estado });
      expect(transaccion.rendicion.update).not.toHaveBeenCalled();
    },
  );

  it('un rol de solo lectura (CONSULTA): 403, sin tocar la base', async () => {
    const res = await clienteDePrueba(app, 'CONSULTA')
      .put(`/rendiciones/${RENDICION}/cobro`)
      .send({ fecha: '2026-11-10' });

    expect(res.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('un conflicto de serialización (P2034) se reintenta', async () => {
    transaccion.rendicion.findFirst
      .mockRejectedValueOnce(errorPrisma('P2034'))
      .mockResolvedValueOnce(lecturaDe('ENVIADA'));

    const res = await registrar({ fecha: '2026-11-10' });

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    expect(transaccion.rendicion.update).toHaveBeenCalledTimes(1);
  });
});

describe('registrarCobro: la fecha se vuelve a comprobar con el reloj del servidor (HU3.10)', () => {
  it('una fecha posterior al "ahora" que se le pasa: 400 en fecha, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));

    await expect(
      registrarCobro(RENDICION, { fecha: MANANA }, { ahora: HOY }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ campo: 'fecha', mensaje: 'La fecha del cobro no puede ser posterior a hoy.' }],
    });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('a las 22:00 en Buenos Aires, el día siguiente en UTC ya es futuro; hoy no', async () => {
    const noche = new Date('2026-11-14T01:00:00.000Z'); // 13/11, 22:00 en Buenos Aires
    const hoyDeNoche = hoyEnBuenosAires(noche);
    expect(hoyDeNoche).toBe('2026-11-13');
    transaccion.rendicion.findFirst.mockResolvedValue(lecturaDe('ENVIADA'));

    await expect(
      registrarCobro(RENDICION, { fecha: diaSiguiente(hoyDeNoche) }, { ahora: noche }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      registrarCobro(RENDICION, { fecha: hoyDeNoche }, { ahora: noche }),
    ).resolves.toMatchObject({ id: RENDICION });
  });
});

describe('DELETE /rendiciones/:id/cobro (HU3.10)', () => {
  it('quita la marca: 200 con el detalle y las dos columnas en null', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('ENVIADA', { cobroFecha: columnaDate('2026-11-10') }),
    );

    const res = await quitar();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, cobro: null });
    expect(transaccion.rendicion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RENDICION },
        data: { cobroFecha: null, cobroNota: null },
      }),
    );
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('sin cobro registrado: 200 con el detalle, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(lecturaDe('ENVIADA'));
    transaccion.rendicion.findUniqueOrThrow.mockResolvedValueOnce(filaDetalle('ENVIADA'));

    const res = await quitar();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: RENDICION, cobro: null });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it.each(['EN_CURSO', 'RECHAZADA'])(
    'no mira el estado: quita un cobro que quedó en una %s',
    async (estado) => {
      transaccion.rendicion.findFirst.mockResolvedValueOnce(
        lecturaDe(estado, { cobroFecha: columnaDate('2026-11-10') }),
      );

      const res = await quitar();

      expect(res.status).toBe(200);
      expect(transaccion.rendicion.update).toHaveBeenCalledTimes(1);
    },
  );

  it('una anulada: 409 RENDICION_ANULADA, sin escribir', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(
      lecturaDe('ENVIADA', { isDeleted: true, cobroFecha: columnaDate('2026-11-10') }),
    );

    const res = await quitar();

    expect(res.status).toBe(409);
    expect(detalles(res)).toEqual({ motivo: 'RENDICION_ANULADA' });
    expect(transaccion.rendicion.update).not.toHaveBeenCalled();
  });

  it('una rendición que no existe: 404', async () => {
    transaccion.rendicion.findFirst.mockResolvedValueOnce(null);

    expect((await quitar()).status).toBe(404);
  });

  it('un id que no es un uuid: 400', async () => {
    const res = await clienteDePrueba(app).delete('/rendiciones/abc/cobro');

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('un rol de solo lectura (CONSULTA): 403, sin tocar la base', async () => {
    const res = await clienteDePrueba(app, 'CONSULTA').delete(`/rendiciones/${RENDICION}/cobro`);

    expect(res.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('un conflicto de serialización (P2034) se reintenta', async () => {
    transaccion.rendicion.findFirst
      .mockRejectedValueOnce(errorPrisma('P2034'))
      .mockResolvedValueOnce(lecturaDe('ENVIADA', { cobroFecha: columnaDate('2026-11-10') }));

    const res = await quitar();

    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });
});
