import { Prisma, type TipoDocumento as TipoDocumentoRow } from '@prisma/client';
import { normalizarNombreTipoDocumento, TipoDocumentoSchema } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Igual que en clientes: solo la base es simulada y se recorre la cadena real
// route → validate → controller → service → mapper → errorHandler. Lo que solo PostgreSQL puede
// probar (el índice único, la concurrencia, `updatedAt` sin escribir) está en
// `tipos-documento.integration.test.ts`.
const prismaMock = vi.hoisted(() => ({
  tipoDocumento: {
    findMany:
      vi.fn<
        (args: {
          where: { activo?: boolean };
          orderBy: { nombreNormalizado: 'asc' | 'desc' };
        }) => Promise<TipoDocumentoRow[]>
      >(),
    create: vi.fn<(args: { data: Prisma.TipoDocumentoCreateInput }) => Promise<TipoDocumentoRow>>(),
    update:
      vi.fn<
        (args: {
          where: { id: string; activo?: { not: boolean } };
          data: Prisma.TipoDocumentoUpdateInput;
        }) => Promise<TipoDocumentoRow>
      >(),
    findUnique:
      vi.fn<
        (args: {
          where: { id?: string; nombreNormalizado?: string };
          select?: Record<string, boolean>;
        }) => Promise<TipoDocumentoRow | null>
      >(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const ID = 'd1e2f3a4-b5c6-4789-8abc-def012345678';
const OTRO_ID = 'e2f3a4b5-c6d7-4890-9bcd-ef0123456789';
const AHORA = new Date('2026-10-21T12:00:00.000Z');
const DESPUES = new Date('2026-10-21T13:00:00.000Z');

/** Las claves exactas de un tipo en la API: ni `nombreNormalizado` ni nada de Prisma. */
const CAMPOS_DEL_CONTRATO = ['activo', 'actualizadoEn', 'creadoEn', 'descripcion', 'id', 'nombre'];

/** Una fila de la base, con la clave calculada como lo hace el backend. */
function fila(extra: Partial<TipoDocumentoRow> = {}): TipoDocumentoRow {
  const nombre = extra.nombre ?? 'Constancia ARCA';
  return {
    id: ID,
    nombre,
    nombreNormalizado: normalizarNombreTipoDocumento(nombre),
    descripcion: null,
    activo: true,
    createdAt: AHORA,
    updatedAt: AHORA,
    ...extra,
  };
}

/** Lo que devolvería la base al insertar `data`. */
function filaInsertada({ data }: { data: Prisma.TipoDocumentoCreateInput }): TipoDocumentoRow {
  return fila({
    nombre: data.nombre,
    nombreNormalizado: data.nombreNormalizado,
    descripcion: data.descripcion ?? null,
    activo: data.activo ?? true,
  });
}

/** Error que lanza Prisma 5 (PostgreSQL) cuando se viola un índice único. */
function errorDeIndiceUnico(campos: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (${campos.map((c) => `\`${c}\``).join(',')})`,
    { code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { target: campos } },
  );
}

const errorDePrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });

const ERROR_INTERNO = {
  error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
};

const NO_ENCONTRADO = {
  error: { code: 'NOT_FOUND', message: 'Tipo de documento no encontrado' },
};

/** El 409 completo, con el registro que ya tiene la clave. */
const conflictoCon = (existente: Pick<TipoDocumentoRow, 'id' | 'nombre' | 'activo'>) => ({
  error: {
    code: 'CONFLICT',
    message: 'Ya existe un tipo de documento con ese nombre',
    details: {
      motivo: 'TIPO_DOCUMENTO_DUPLICADO',
      tipoDocumentoExistente: {
        id: existente.id,
        nombre: existente.nombre,
        activo: existente.activo,
      },
    },
  },
});

const camposConError = (res: request.Response) =>
  (res.body as { error: { details: { campo: string }[] } }).error.details.map((d) => d.campo);

const camposDe = (cuerpo: unknown) => Object.keys(cuerpo as object).sort();

/** Silencia el log del errorHandler en los casos 500. */
const silenciarConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const listar = (query = '') => request(app).get(`/tipos-documento${query}`);
const crear = (body: object) => request(app).post('/tipos-documento').send(body);
const editar = (id: string, body: object) =>
  request(app).patch(`/tipos-documento/${id}`).send(body);
const cambiarEstado = (id: string, body: object) =>
  request(app).patch(`/tipos-documento/${id}/estado`).send(body);

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('GET /tipos-documento', () => {
  it('por defecto pide solo los activos, ordenados por nombreNormalizado', async () => {
    prismaMock.tipoDocumento.findMany.mockResolvedValue([fila()]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(prismaMock.tipoDocumento.findMany).toHaveBeenCalledWith({
      where: { activo: true },
      orderBy: { nombreNormalizado: 'asc' },
    });
    expect(res.body).toEqual([
      {
        id: ID,
        nombre: 'Constancia ARCA',
        descripcion: null,
        activo: true,
        creadoEn: AHORA.toISOString(),
        actualizadoEn: AHORA.toISOString(),
      },
    ]);
  });

  it('incluirInactivos=true pide todos, activos e inactivos', async () => {
    prismaMock.tipoDocumento.findMany.mockResolvedValue([
      fila(),
      fila({ id: OTRO_ID, nombre: 'Print', activo: false }),
    ]);

    const res = await listar('?incluirInactivos=true');

    expect(res.status).toBe(200);
    expect(prismaMock.tipoDocumento.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { nombreNormalizado: 'asc' },
    });
    expect((res.body as { activo: boolean }[]).map((tipo) => tipo.activo)).toEqual([true, false]);
  });

  it('incluirInactivos=false equivale a no enviarlo', async () => {
    prismaMock.tipoDocumento.findMany.mockResolvedValue([]);

    await listar('?incluirInactivos=false');

    expect(prismaMock.tipoDocumento.findMany).toHaveBeenCalledWith({
      where: { activo: true },
      orderBy: { nombreNormalizado: 'asc' },
    });
  });

  it('respeta el orden de la base: no reordena por el nombre visible', async () => {
    // Ordenadas por clave: "acido" < "beta" < "gama", aunque por `nombre` (mayúsculas primero)
    // el orden sería otro.
    prismaMock.tipoDocumento.findMany.mockResolvedValue([
      fila({ id: ID, nombre: 'Ácido' }),
      fila({ id: OTRO_ID, nombre: 'beta' }),
      fila({ id: 'f3a4b5c6-d7e8-4901-8cde-f01234567890', nombre: 'Gama' }),
    ]);

    const res = await listar();

    expect((res.body as { nombre: string }[]).map((tipo) => tipo.nombre)).toEqual([
      'Ácido',
      'beta',
      'Gama',
    ]);
  });

  it('sin resultados responde 200 con una lista vacía', async () => {
    prismaMock.tipoDocumento.findMany.mockResolvedValue([]);

    const res = await listar();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('cada tipo trae solo los campos del contrato: sin nombreNormalizado ni campos de Prisma', async () => {
    prismaMock.tipoDocumento.findMany.mockResolvedValue([fila({ descripcion: 'Algo' })]);

    const res = await listar();

    const [tipo] = res.body as unknown[];
    expect(camposDe(tipo)).toEqual(CAMPOS_DEL_CONTRATO);
    expect(TipoDocumentoSchema.safeParse(tipo).success).toBe(true);
  });

  it.each([
    ['un 1', '?incluirInactivos=1'],
    ['TRUE en mayúsculas', '?incluirInactivos=TRUE'],
    ['un texto cualquiera', '?incluirInactivos=si'],
    ['un valor vacío', '?incluirInactivos='],
    ['el parámetro repetido', '?incluirInactivos=true&incluirInactivos=false'],
  ])('responde 400 por %s, sin consultar la base', async (_caso, query) => {
    const res = await listar(query);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(camposConError(res)).toEqual(['incluirInactivos']);
    expect(prismaMock.tipoDocumento.findMany).not.toHaveBeenCalled();
  });

  it('responde 500 genérico ante un fallo de la base', async () => {
    silenciarConsoleError();
    prismaMock.tipoDocumento.findMany.mockRejectedValue(errorDePrisma('P1001'));

    const res = await listar();

    expect(res.status).toBe(500);
    expect(res.body).toEqual(ERROR_INTERNO);
  });
});

describe('POST /tipos-documento', () => {
  const simularAltas = () =>
    prismaMock.tipoDocumento.create.mockImplementation((args) =>
      Promise.resolve(filaInsertada(args)),
    );

  describe('alta exitosa', () => {
    it('crea un tipo activo y responde 201 con el contrato', async () => {
      simularAltas();

      const res = await crear({ nombre: 'Constancia ARCA' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: ID,
        nombre: 'Constancia ARCA',
        descripcion: null,
        activo: true,
        creadoEn: AHORA.toISOString(),
        actualizadoEn: AHORA.toISOString(),
      });
      expect(camposDe(res.body)).toEqual(CAMPOS_DEL_CONTRATO);
      expect(prismaMock.tipoDocumento.create).toHaveBeenCalledWith({
        data: {
          nombre: 'Constancia ARCA',
          nombreNormalizado: 'constancia arca',
          descripcion: null,
          activo: true,
        },
      });
    });

    it('no consulta antes si el nombre existe: la garantía es el índice único', async () => {
      simularAltas();

      await crear({ nombre: 'Constancia ARCA' });

      expect(prismaMock.tipoDocumento.findUnique).not.toHaveBeenCalled();
    });

    it('guarda el nombre recortado tal como llegó y la clave normalizada', async () => {
      simularAltas();

      const res = await crear({ nombre: '  Constancía   ARCA ' });

      expect(res.status).toBe(201);
      expect(prismaMock.tipoDocumento.create.mock.calls[0]?.[0].data).toMatchObject({
        nombre: 'Constancía   ARCA',
        nombreNormalizado: 'constancia arca',
      });
    });

    it.each([
      ['Año', 'año'],
      ['Ano', 'ano'],
      ['AÑO', 'año'],
    ])('la ñ no es una n: "%s" se guarda con la clave "%s"', async (nombre, clave) => {
      simularAltas();

      await crear({ nombre });

      expect(prismaMock.tipoDocumento.create.mock.calls[0]?.[0].data.nombreNormalizado).toBe(clave);
    });

    it('guarda la descripción enviada y convierte una vacía en null', async () => {
      simularAltas();

      const conTexto = await crear({ nombre: 'OC', descripcion: '  Orden de compra ' });
      const vacia = await crear({ nombre: 'CAE', descripcion: '   ' });

      expect(conTexto.body).toMatchObject({ descripcion: 'Orden de compra' });
      expect(vacia.body).toMatchObject({ descripcion: null });
    });

    it('ignora id, activo, fechas y nombreNormalizado enviados: los fija el servidor', async () => {
      simularAltas();

      const res = await crear({
        nombre: 'Factura',
        id: OTRO_ID,
        activo: false,
        creadoEn: '2020-01-01T00:00:00.000Z',
        nombreNormalizado: 'otra clave',
      });

      expect(res.status).toBe(201);
      expect(prismaMock.tipoDocumento.create).toHaveBeenCalledWith({
        data: { nombre: 'Factura', nombreNormalizado: 'factura', descripcion: null, activo: true },
      });
    });
  });

  describe('nombre duplicado', () => {
    it('responde 409 con el tipo que ya tiene la clave', async () => {
      const existente = fila({ id: OTRO_ID, nombre: 'Constancia ARCA' });
      prismaMock.tipoDocumento.create.mockRejectedValue(errorDeIndiceUnico(['nombreNormalizado']));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(existente);

      const res = await crear({ nombre: 'constancia  arca' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(conflictoCon(existente));
      expect(prismaMock.tipoDocumento.findUnique).toHaveBeenCalledWith({
        where: { nombreNormalizado: 'constancia arca' },
        select: { id: true, nombre: true, activo: true },
      });
    });

    it('informa el tipo existente aunque esté inactivo', async () => {
      const existente = fila({ id: OTRO_ID, nombre: 'Print', activo: false });
      prismaMock.tipoDocumento.create.mockRejectedValue(errorDeIndiceUnico(['nombreNormalizado']));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(existente);

      const res = await crear({ nombre: 'PRINT' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(conflictoCon(existente));
    });

    it('si el dueño de la clave cambió de nombre en el medio, reintenta el alta', async () => {
      prismaMock.tipoDocumento.create
        .mockRejectedValueOnce(errorDeIndiceUnico(['nombreNormalizado']))
        .mockImplementationOnce((args) => Promise.resolve(filaInsertada(args)));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(null);

      const res = await crear({ nombre: 'Factura' });

      expect(res.status).toBe(201);
      expect(prismaMock.tipoDocumento.create).toHaveBeenCalledTimes(2);
    });

    it('si la clave sigue rechazada sin dueño, deja de reintentar y responde 500', async () => {
      silenciarConsoleError();
      prismaMock.tipoDocumento.create.mockRejectedValue(errorDeIndiceUnico(['nombreNormalizado']));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(null);

      const res = await crear({ nombre: 'Factura' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual(ERROR_INTERNO);
      expect(prismaMock.tipoDocumento.create).toHaveBeenCalledTimes(3);
    });

    it('un P2002 de otro índice no es un nombre duplicado: responde 500', async () => {
      silenciarConsoleError();
      prismaMock.tipoDocumento.create.mockRejectedValue(errorDeIndiceUnico(['id']));

      const res = await crear({ nombre: 'Factura' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual(ERROR_INTERNO);
      expect(prismaMock.tipoDocumento.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('datos inválidos', () => {
    it.each([
      ['sin nombre', {}, 'nombre'],
      ['un nombre vacío', { nombre: '' }, 'nombre'],
      ['un nombre de solo espacios', { nombre: '   ' }, 'nombre'],
      ['un nombre de 101 caracteres', { nombre: 'x'.repeat(101) }, 'nombre'],
      ['un nombre que no es texto', { nombre: 123 }, 'nombre'],
      ['un nombre con caracteres de control', { nombre: 'Factura\u0000A' }, 'nombre'],
      [
        'una descripción de 501 caracteres',
        { nombre: 'OC', descripcion: 'x'.repeat(501) },
        'descripcion',
      ],
      ['una descripción que no es texto', { nombre: 'OC', descripcion: 5 }, 'descripcion'],
    ])('responde 400 por %s, sin tocar la base', async (_caso, body, campo) => {
      const res = await crear(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', message: 'Los datos enviados no son válidos' },
      });
      expect(camposConError(res)).toEqual([campo]);
      expect(prismaMock.tipoDocumento.create).not.toHaveBeenCalled();
    });

    it('acepta un nombre de exactamente 100 caracteres', async () => {
      simularAltas();

      const res = await crear({ nombre: 'x'.repeat(100) });

      expect(res.status).toBe(201);
    });

    it('responde 400 con campo "body" si el JSON está mal formado', async () => {
      const res = await request(app)
        .post('/tipos-documento')
        .set('Content-Type', 'application/json')
        .send('{"nombre": ');

      expect(res.status).toBe(400);
      expect(camposConError(res)).toEqual(['body']);
    });
  });

  it('responde 500 genérico, sin detalles internos, ante un error inesperado', async () => {
    const espia = silenciarConsoleError();
    prismaMock.tipoDocumento.create.mockRejectedValue(
      new Error('SELECT secreto FROM "TipoDocumento"'),
    );

    const res = await crear({ nombre: 'Factura' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(ERROR_INTERNO);
    expect(JSON.stringify(espia.mock.calls)).not.toContain('secreto');
  });
});

describe('PATCH /tipos-documento/:id', () => {
  /** El `update` aplica `data` sobre la fila guardada, como lo haría la base. */
  const simularEdicion = (guardada: TipoDocumentoRow) =>
    prismaMock.tipoDocumento.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...guardada, ...(data as Partial<TipoDocumentoRow>), updatedAt: DESPUES }),
    );

  describe('edición exitosa', () => {
    it('cambia el nombre y recalcula la clave, en el mismo tipo', async () => {
      simularEdicion(fila());

      const res = await editar(ID, { nombre: 'Constancia de ARCA' });

      expect(res.status).toBe(200);
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: { nombre: 'Constancia de ARCA', nombreNormalizado: 'constancia de arca' },
      });
      expect(res.body).toMatchObject({
        id: ID,
        nombre: 'Constancia de ARCA',
        actualizadoEn: DESPUES.toISOString(),
      });
      expect(camposDe(res.body)).toEqual(CAMPOS_DEL_CONTRATO);
    });

    it('cambiar solo la descripción no toca el nombre ni la clave', async () => {
      simularEdicion(fila());

      const res = await editar(ID, { descripcion: 'Constancia de inscripción' });

      expect(res.status).toBe(200);
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: { descripcion: 'Constancia de inscripción' },
      });
      expect(res.body).toMatchObject({
        nombre: 'Constancia ARCA',
        descripcion: 'Constancia de inscripción',
      });
    });

    it.each([
      ['null', null],
      ['un texto vacío', ''],
    ])('descripcion: %s la borra', async (_caso, descripcion) => {
      simularEdicion(fila({ descripcion: 'Vieja' }));

      const res = await editar(ID, { descripcion });

      expect(res.status).toBe(200);
      expect(prismaMock.tipoDocumento.update.mock.calls[0]?.[0].data).toEqual({
        descripcion: null,
      });
      expect(res.body).toMatchObject({ descripcion: null });
    });

    it('edita un tipo inactivo sin reactivarlo', async () => {
      simularEdicion(fila({ activo: false }));

      const res = await editar(ID, { nombre: 'Constancia AFIP' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nombre: 'Constancia AFIP', activo: false });
      expect(prismaMock.tipoDocumento.update.mock.calls[0]?.[0].where).toEqual({ id: ID });
    });

    it('cambiar solo mayúsculas o acentos del propio nombre no es un duplicado', async () => {
      simularEdicion(fila());

      const res = await editar(ID, { nombre: 'CONSTANCÍA arca' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ID, nombre: 'CONSTANCÍA arca' });
      expect(prismaMock.tipoDocumento.update.mock.calls[0]?.[0].data).toEqual({
        nombre: 'CONSTANCÍA arca',
        nombreNormalizado: 'constancia arca',
      });
    });

    it('ignora activo y nombreNormalizado en el cuerpo: activo se cambia con /estado', async () => {
      simularEdicion(fila());

      await editar(ID, { nombre: 'Print', activo: false, nombreNormalizado: 'otra clave' });

      expect(prismaMock.tipoDocumento.update.mock.calls[0]?.[0].data).toEqual({
        nombre: 'Print',
        nombreNormalizado: 'print',
      });
    });
  });

  describe('nombre duplicado', () => {
    it('responde 409 si el nombre nuevo pertenece a otro tipo', async () => {
      const otro = fila({ id: OTRO_ID, nombre: 'Print', activo: false });
      prismaMock.tipoDocumento.update.mockRejectedValue(errorDeIndiceUnico(['nombreNormalizado']));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(otro);

      const res = await editar(ID, { nombre: 'PRINT' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(conflictoCon(otro));
    });

    it('si la clave terminó siendo del propio tipo (carrera), reintenta en vez de señalarse a sí mismo', async () => {
      prismaMock.tipoDocumento.update
        .mockRejectedValueOnce(errorDeIndiceUnico(['nombreNormalizado']))
        .mockResolvedValueOnce(fila({ nombre: 'Print' }));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(fila({ nombre: 'Print' }));

      const res = await editar(ID, { nombre: 'Print' });

      expect(res.status).toBe(200);
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('tipo inexistente', () => {
    it.each([
      ['cambia el nombre', { nombre: 'Print' }],
      ['cambia solo la descripción', { descripcion: 'x' }],
    ])('responde 404 si no existe y el pedido %s', async (_caso, body) => {
      prismaMock.tipoDocumento.update.mockRejectedValue(errorDePrisma('P2025'));

      const res = await editar(ID, body);

      expect(res.status).toBe(404);
      expect(res.body).toEqual(NO_ENCONTRADO);
    });
  });

  describe('datos inválidos', () => {
    it.each([
      ['un pedido vacío', {}],
      ['un pedido con solo campos que no se editan acá', { activo: false, id: OTRO_ID }],
    ])('responde 400 por %s, sin tocar la base', async (_caso, body) => {
      const res = await editar(ID, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(prismaMock.tipoDocumento.update).not.toHaveBeenCalled();
    });

    it.each([
      ['un nombre vacío', { nombre: '' }, 'nombre'],
      ['un nombre null', { nombre: null }, 'nombre'],
      ['un nombre de 101 caracteres', { nombre: 'x'.repeat(101) }, 'nombre'],
      ['una descripción de 501 caracteres', { descripcion: 'x'.repeat(501) }, 'descripcion'],
    ])('responde 400 por %s', async (_caso, body, campo) => {
      const res = await editar(ID, body);

      expect(res.status).toBe(400);
      expect(camposConError(res)).toEqual([campo]);
      expect(prismaMock.tipoDocumento.update).not.toHaveBeenCalled();
    });

    it('responde 400 si el id no es un uuid, sin tocar la base', async () => {
      const res = await editar('no-es-un-uuid', { nombre: 'Print' });

      expect(res.status).toBe(400);
      expect(camposConError(res)).toEqual(['id']);
      expect(prismaMock.tipoDocumento.update).not.toHaveBeenCalled();
    });
  });
});

describe('PATCH /tipos-documento/:id/estado', () => {
  /**
   * Base simulada con una fila: el `update` condicional solo escribe si `activo` es distinto del
   * pedido (si no, P2025, como PostgreSQL sin filas afectadas) y entonces cambia `updatedAt`.
   * `findUnique` devuelve la fila guardada.
   */
  function simularBase(guardada: TipoDocumentoRow | null) {
    let actual = guardada;
    prismaMock.tipoDocumento.update.mockImplementation(({ where, data }) => {
      if (actual === null || actual.activo === where.activo?.not) {
        return Promise.reject(errorDePrisma('P2025'));
      }
      actual = { ...actual, activo: data.activo as boolean, updatedAt: DESPUES };
      return Promise.resolve(actual);
    });
    prismaMock.tipoDocumento.findUnique.mockImplementation(() => Promise.resolve(actual));
  }

  describe('cambio de estado', () => {
    it('desactiva: escribe con un UPDATE condicional y cambia solo activo', async () => {
      simularBase(fila({ descripcion: 'Algo' }));

      const res = await cambiarEstado(ID, { activo: false });

      expect(res.status).toBe(200);
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledWith({
        where: { id: ID, activo: { not: false } },
        data: { activo: false },
      });
      expect(res.body).toEqual({
        id: ID,
        nombre: 'Constancia ARCA',
        descripcion: 'Algo',
        activo: false,
        creadoEn: AHORA.toISOString(),
        actualizadoEn: DESPUES.toISOString(),
      });
      // Si escribió, la respuesta es la fila escrita: no hace falta leerla aparte.
      expect(prismaMock.tipoDocumento.findUnique).not.toHaveBeenCalled();
    });

    it('reactiva un tipo inactivo', async () => {
      simularBase(fila({ activo: false }));

      const res = await cambiarEstado(ID, { activo: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ activo: true, actualizadoEn: DESPUES.toISOString() });
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledWith({
        where: { id: ID, activo: { not: true } },
        data: { activo: true },
      });
    });

    it('ignora cualquier otro campo del cuerpo', async () => {
      simularBase(fila());

      await cambiarEstado(ID, { activo: false, nombre: 'Otro', descripcion: 'x' });

      expect(prismaMock.tipoDocumento.update.mock.calls[0]?.[0].data).toEqual({ activo: false });
    });
  });

  describe('pedir el estado que ya tiene (no-op)', () => {
    it.each([true, false])(
      'activo: %s sobre un tipo que ya lo tiene responde 200 sin escribir',
      async (activo) => {
        simularBase(fila({ activo }));

        const res = await cambiarEstado(ID, { activo });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ activo, actualizadoEn: AHORA.toISOString() });
        // El UPDATE condicional no matcheó (no hubo escritura) y se leyó la fila para responder.
        await expect(prismaMock.tipoDocumento.update.mock.results[0]?.value).rejects.toMatchObject({
          code: 'P2025',
        });
        expect(prismaMock.tipoDocumento.findUnique).toHaveBeenCalledWith({ where: { id: ID } });
      },
    );

    it('repetirlo varias veces devuelve siempre lo mismo', async () => {
      simularBase(fila());

      const primera = await cambiarEstado(ID, { activo: false });
      const segunda = await cambiarEstado(ID, { activo: false });

      expect(segunda.status).toBe(200);
      expect(segunda.body).toEqual(primera.body);
    });
  });

  describe('carrera entre la escritura y la lectura', () => {
    it('si otro pedido cambió el estado justo en medio, reintenta y responde el estado pedido', async () => {
      prismaMock.tipoDocumento.update
        .mockRejectedValueOnce(errorDePrisma('P2025'))
        .mockResolvedValueOnce(fila({ activo: false, updatedAt: DESPUES }));
      prismaMock.tipoDocumento.findUnique.mockResolvedValueOnce(fila({ activo: true }));

      const res = await cambiarEstado(ID, { activo: false });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ activo: false });
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledTimes(2);
    });

    it('si el estado oscila en todos los intentos, termina en 500 sin quedar en un bucle', async () => {
      silenciarConsoleError();
      prismaMock.tipoDocumento.update.mockRejectedValue(errorDePrisma('P2025'));
      prismaMock.tipoDocumento.findUnique.mockResolvedValue(fila({ activo: true }));

      const res = await cambiarEstado(ID, { activo: false });

      expect(res.status).toBe(500);
      expect(prismaMock.tipoDocumento.update).toHaveBeenCalledTimes(3);
    });
  });

  it.each([true, false])('responde 404 si el tipo no existe (activo: %s)', async (activo) => {
    simularBase(null);

    const res = await cambiarEstado(ID, { activo });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(NO_ENCONTRADO);
  });

  describe('datos inválidos', () => {
    it.each([
      ['un cuerpo sin activo', {}],
      ['activo como texto', { activo: 'false' }],
      ['activo nulo', { activo: null }],
      ['activo numérico', { activo: 0 }],
    ])('responde 400 por %s, sin tocar la base', async (_caso, body) => {
      const res = await cambiarEstado(ID, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(camposConError(res)).toEqual(['activo']);
      expect(prismaMock.tipoDocumento.update).not.toHaveBeenCalled();
    });

    it('responde 400 si el id no es un uuid', async () => {
      const res = await cambiarEstado('123', { activo: false });

      expect(res.status).toBe(400);
      expect(camposConError(res)).toEqual(['id']);
      expect(prismaMock.tipoDocumento.update).not.toHaveBeenCalled();
    });
  });

  it('responde 500 genérico ante un fallo de Prisma que no es un 404', async () => {
    silenciarConsoleError();
    prismaMock.tipoDocumento.update.mockRejectedValue(errorDePrisma('P1001'));

    const res = await cambiarEstado(ID, { activo: false });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(ERROR_INTERNO);
  });
});

describe('rutas que no existen', () => {
  it('DELETE /tipos-documento/:id no existe: responde 404', async () => {
    const res = await request(app).delete(`/tipos-documento/${ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
