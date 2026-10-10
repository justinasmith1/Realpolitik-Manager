import { Prisma, type Cliente as ClienteRow } from '@prisma/client';
import { ClienteSchema } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Igual que en el alta: Prisma se reemplaza por dobles y se recorre la cadena real
// route → validate → controller → service → mapper → errorHandler.
/** Lo que el service lee del cliente guardado antes de editarlo (el `select` de `findFirst`). */
type ClienteGuardado = Pick<
  ClienteRow,
  'sector' | 'canalEntrega' | 'emailContacto' | 'emailsAdicionales'
>;

const prismaMock = vi.hoisted(() => ({
  cliente: {
    findFirst: vi.fn<(args: unknown) => Promise<ClienteGuardado | null>>(),
    update:
      vi.fn<
        (args: {
          where: { id: string; isDeleted: boolean };
          data: Prisma.ClienteUpdateInput;
        }) => Promise<ClienteRow>
      >(),
    findUnique:
      vi.fn<
        (args: {
          where: { cuit: string };
          select: Record<string, boolean>;
        }) => Promise<Pick<ClienteRow, 'id' | 'razonSocial' | 'estado'> | null>
      >(),
  },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const app = createApp({ corsOrigins: ['http://localhost:5173'] });

const ID = 'c3d4e5f6-a7b8-4901-8def-012345678901';
const ID_OTRO = 'd4e5f6a7-b8c9-4012-9ef0-123456789012';
const AHORA = new Date('2026-10-08T12:00:00.000Z');

/** Cliente público guardado, con `telefono` y `emailsAdicionales` que la edición no debe pisar. */
const filaGuardada: ClienteRow = {
  id: ID,
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: ['otro@municipio.example'],
  telefono: '+54 11 4000-1234',
  portalUrl: null,
  canalEntrega: 'CORREO',
  whatsappNumero: null,
  periodicidadTipo: null,
  periodicidadDiaLimite: null,
  periodicidadMesInicioCiclo: null,
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  estado: 'ACTIVO',
  isDeleted: false,
  deletedAt: null,
  createdAt: AHORA,
  updatedAt: AHORA,
};

/** Lo que devolvería la base al aplicar `data` sobre la fila guardada. */
function filaActualizada(
  data: Prisma.ClienteUpdateInput,
  base: ClienteRow = filaGuardada,
): ClienteRow {
  const cambios = Object.fromEntries(
    Object.entries(data).filter(([, valor]) => valor !== undefined),
  );
  return { ...base, ...cambios };
}

function errorDeIndiceUnico(campos: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (${campos.map((c) => `\`${c}\``).join(',')})`,
    { code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { target: campos } },
  );
}

/** El cliente guardado que ve el service: por defecto, el de `filaGuardada`. */
const guardado = (extra: Partial<ClienteGuardado> = {}): ClienteGuardado => ({
  sector: filaGuardada.sector,
  canalEntrega: filaGuardada.canalEntrega,
  emailContacto: filaGuardada.emailContacto,
  emailsAdicionales: filaGuardada.emailsAdicionales,
  ...extra,
});

const patchCliente = (id: string, body: object) => request(app).patch(`/clientes/${id}`).send(body);

/** Los `data` con los que el service llamó a `update`. */
const dataEnviada = () => prismaMock.cliente.update.mock.calls[0]?.[0].data;

const detalleDeValidacion = (res: request.Response) =>
  (res.body as { error: { details: { campo: string }[] } }).error.details.map((d) => d.campo);

beforeEach(() => {
  prismaMock.cliente.findFirst.mockResolvedValue(
    guardado({ sector: 'PUBLICO', canalEntrega: 'CORREO' }),
  );
  prismaMock.cliente.update.mockImplementation(({ data }) =>
    Promise.resolve(filaActualizada(data)),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('PATCH /clientes/:id', () => {
  describe('edición exitosa', () => {
    it('modifica un solo campo y responde 200 con el cliente actualizado', async () => {
      const res = await patchCliente(ID, { razonSocial: 'Municipio Renombrado' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: ID,
        razonSocial: 'Municipio Renombrado',
        denominacion: 'Muni Ejemplo',
        sector: 'PUBLICO',
        subtipo: 'MUNICIPAL',
        estado: 'ACTIVO',
      });
      expect(ClienteSchema.safeParse(res.body).success).toBe(true);
      expect(prismaMock.cliente.findFirst).toHaveBeenCalledWith({
        where: { id: ID, isDeleted: false },
        select: { sector: true, canalEntrega: true, emailContacto: true, emailsAdicionales: true },
      });
      // Solo viaja lo enviado: no se pisa telefono, emailsAdicionales ni el canal.
      expect(prismaMock.cliente.update).toHaveBeenCalledWith({
        where: { id: ID, isDeleted: false },
        data: { razonSocial: 'Municipio Renombrado' },
      });
    });

    it('modifica varios campos y normaliza lo que normaliza shared', async () => {
      const res = await patchCliente(ID, {
        denominacion: 'Muni Nuevo',
        cuit: '20123456786',
        emailContacto: 'Nuevo@Municipio.Example',
        ivaCondicion: 'MONOTRIBUTO',
      });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        denominacion: 'Muni Nuevo',
        cuit: '20-12345678-6',
        emailContacto: 'nuevo@municipio.example',
        ivaCondicion: 'MONOTRIBUTO',
      });
      expect(res.body).toMatchObject({ telefono: '+54 11 4000-1234' });
      expect(res.body).toMatchObject({ emailsAdicionales: ['otro@municipio.example'] });
    });

    it('acepta el CUIT que el cliente ya tiene: no es un duplicado', async () => {
      const res = await patchCliente(ID, { cuit: '30-50001274-5', denominacion: 'Muni Nuevo' });

      expect(res.status).toBe(200);
      expect(prismaMock.cliente.findUnique).not.toHaveBeenCalled();
    });

    it('ignora el estado y los campos del servidor, y no los envía a la base', async () => {
      const res = await patchCliente(ID, {
        razonSocial: 'Municipio Renombrado',
        estado: 'INACTIVO',
        id: ID_OTRO,
        creadoEn: '2020-01-01T00:00:00.000Z',
        actualizadoEn: '2020-01-01T00:00:00.000Z',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ID, estado: 'ACTIVO' });
      expect(dataEnviada()).toEqual({ razonSocial: 'Municipio Renombrado' });
    });
  });

  describe('cambio de sector', () => {
    it('de PUBLICO a PRIVADO descarta el subtipo', async () => {
      const res = await patchCliente(ID, { sector: 'PRIVADO' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ sector: 'PRIVADO', subtipo: null });
      expect(res.body).toMatchObject({ sector: 'PRIVADO' });
      expect(res.body).not.toHaveProperty('subtipo');
    });

    it('de PRIVADO a PUBLICO guarda el subtipo del mismo pedido', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({ sector: 'PRIVADO', canalEntrega: 'CORREO' }),
      );
      prismaMock.cliente.update.mockImplementation(({ data }) =>
        Promise.resolve(
          filaActualizada(data, { ...filaGuardada, sector: 'PRIVADO', subtipo: null }),
        ),
      );

      const res = await patchCliente(ID, { sector: 'PUBLICO', subtipo: 'SINDICAL_OBRA_SOCIAL' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ sector: 'PUBLICO', subtipo: 'SINDICAL_OBRA_SOCIAL' });
      expect(res.body).toMatchObject({ sector: 'PUBLICO', subtipo: 'SINDICAL_OBRA_SOCIAL' });
    });

    it('cambia solo el subtipo de un cliente público', async () => {
      const res = await patchCliente(ID, { subtipo: 'PROVINCIAL_ORGANISMO' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ subtipo: 'PROVINCIAL_ORGANISMO' });
    });
  });

  describe('cambio de canal', () => {
    it('a PORTAL_WEB guarda la URL y limpia el número de WhatsApp', async () => {
      const res = await patchCliente(ID, {
        canalEntrega: 'PORTAL_WEB',
        portalUrl: 'https://portal.ejemplo.gob.ar',
      });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        canalEntrega: 'PORTAL_WEB',
        portalUrl: 'https://portal.ejemplo.gob.ar',
        whatsappNumero: null,
      });
    });

    it('a WHATSAPP guarda el número en E.164 y limpia la URL', async () => {
      const res = await patchCliente(ID, {
        canalEntrega: 'WHATSAPP',
        whatsappNumero: '+54 9 351 123 4567',
      });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        canalEntrega: 'WHATSAPP',
        portalUrl: null,
        whatsappNumero: '+5493511234567',
      });
    });

    it('a CORREO limpia la URL y el número de WhatsApp', async () => {
      const res = await patchCliente(ID, { canalEntrega: 'CORREO' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        canalEntrega: 'CORREO',
        portalUrl: null,
        whatsappNumero: null,
      });
    });

    it('permite cambiar solo la URL de un cliente que ya está en PORTAL_WEB', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({ sector: 'PUBLICO', canalEntrega: 'PORTAL_WEB' }),
      );

      const res = await patchCliente(ID, { portalUrl: 'https://nuevo.ejemplo.gob.ar' });

      expect(res.status).toBe(200);
      // Se guarda tal cual: no se toca el canal ni el otro dato.
      expect(dataEnviada()).toEqual({ portalUrl: 'https://nuevo.ejemplo.gob.ar' });
    });

    it('permite cambiar solo el número de un cliente que ya está en WHATSAPP', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({ sector: 'PUBLICO', canalEntrega: 'WHATSAPP' }),
      );

      const res = await patchCliente(ID, { whatsappNumero: '+54 9 351 765 4321' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ whatsappNumero: '+5493517654321' });
    });

    it('responde 400 si envía solo portalUrl y el canal guardado es CORREO', async () => {
      const res = await patchCliente(ID, { portalUrl: 'https://nuevo.ejemplo.gob.ar' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            {
              campo: 'portalUrl',
              mensaje: 'Para cargar la URL del portal, el canal tiene que ser Portal web.',
            },
          ],
        },
      });
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si envía solo whatsappNumero y el canal guardado es CORREO', async () => {
      const res = await patchCliente(ID, { whatsappNumero: '+54 9 351 765 4321' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: [
            {
              campo: 'whatsappNumero',
              mensaje: 'Para cargar el número, el canal tiene que ser WhatsApp.',
            },
          ],
        },
      });
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si envía solo portalUrl y el canal guardado es WHATSAPP', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({ sector: 'PUBLICO', canalEntrega: 'WHATSAPP' }),
      );

      const res = await patchCliente(ID, { portalUrl: 'https://nuevo.ejemplo.gob.ar' });

      expect(res.status).toBe(400);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });
  });

  describe('periodicidad', () => {
    const columnasVacias = {
      periodicidadTipo: null,
      periodicidadDiaLimite: null,
      periodicidadMesInicioCiclo: null,
    };
    const filaConBimestral: ClienteRow = {
      ...filaGuardada,
      periodicidadTipo: 'BIMESTRAL',
      periodicidadDiaLimite: 15,
      periodicidadMesInicioCiclo: 3,
    };

    it('como único cambio escribe las tres columnas y no toca nada más', async () => {
      const res = await patchCliente(ID, {
        periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
      });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        periodicidadTipo: 'MENSUAL',
        periodicidadDiaLimite: 10,
        periodicidadMesInicioCiclo: null,
      });
      expect(res.body).toMatchObject({
        periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
      });
      expect(ClienteSchema.safeParse(res.body).success).toBe(true);
    });

    it('al cambiar de BIMESTRAL a POR_CAMPANIA reemplaza las tres columnas', async () => {
      prismaMock.cliente.update.mockImplementation(({ data }) =>
        Promise.resolve(filaActualizada(data, filaConBimestral)),
      );

      const res = await patchCliente(ID, {
        periodicidad: { tipo: 'POR_CAMPANIA', diaLimite: 5, mesInicioCiclo: null },
      });

      expect(res.status).toBe(200);
      // El mes de inicio anterior viaja como null explícito: no queda un resto del bimestral.
      expect(dataEnviada()).toEqual({
        periodicidadTipo: 'POR_CAMPANIA',
        periodicidadDiaLimite: 5,
        periodicidadMesInicioCiclo: null,
      });
      expect(res.body).toMatchObject({
        periodicidad: { tipo: 'POR_CAMPANIA', diaLimite: 5, mesInicioCiclo: null },
      });
    });

    it('al cambiar de MENSUAL a BIMESTRAL escribe el mes de inicio', async () => {
      const res = await patchCliente(ID, {
        periodicidad: { tipo: 'BIMESTRAL', diaLimite: 20, mesInicioCiclo: 11 },
      });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        periodicidadTipo: 'BIMESTRAL',
        periodicidadDiaLimite: 20,
        periodicidadMesInicioCiclo: 11,
      });
    });

    it('periodicidad: null deja las tres columnas en null y responde periodicidad null', async () => {
      prismaMock.cliente.update.mockImplementation(({ data }) =>
        Promise.resolve(filaActualizada(data, filaConBimestral)),
      );

      const res = await patchCliente(ID, { periodicidad: null });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual(columnasVacias);
      expect(res.body).toHaveProperty('periodicidad', null);
    });

    it('ausente conserva la existente: no envía ninguna de las tres columnas', async () => {
      prismaMock.cliente.update.mockImplementation(({ data }) =>
        Promise.resolve(filaActualizada(data, filaConBimestral)),
      );

      const res = await patchCliente(ID, { razonSocial: 'Municipio Renombrado' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ razonSocial: 'Municipio Renombrado' });
      expect(res.body).toMatchObject({
        periodicidad: { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 },
      });
    });

    it('junto con otros campos, cada uno se persiste sin pisar al otro', async () => {
      const res = await patchCliente(ID, {
        denominacion: 'Muni Nuevo',
        periodicidad: { tipo: 'MENSUAL', diaLimite: 1, mesInicioCiclo: null },
      });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({
        denominacion: 'Muni Nuevo',
        periodicidadTipo: 'MENSUAL',
        periodicidadDiaLimite: 1,
        periodicidadMesInicioCiclo: null,
      });
    });

    it.each([
      [
        'un día límite fuera de rango',
        { tipo: 'MENSUAL', diaLimite: 0, mesInicioCiclo: null },
        'periodicidad.diaLimite',
      ],
      [
        'un bimestral sin mes de inicio',
        { tipo: 'BIMESTRAL', diaLimite: 10, mesInicioCiclo: null },
        'periodicidad.mesInicioCiclo',
      ],
      [
        'un tipo inexistente',
        { tipo: 'ANUAL', diaLimite: 10, mesInicioCiclo: null },
        'periodicidad.tipo',
      ],
    ])('responde 400 con %s y no actualiza', async (_caso, periodicidad, campo) => {
      const res = await patchCliente(ID, { periodicidad });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual([campo]);
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });
  });

  describe('datos inválidos', () => {
    it.each([
      ['un pedido vacío', {}],
      ['un pedido con solo campos que no se editan', { estado: 'INACTIVO' }],
    ])('responde 400 con %s, sin tocar la base', async (_caso, body) => {
      const res = await patchCliente(ID, body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si el CUIT tiene un dígito verificador incorrecto', async () => {
      const res = await patchCliente(ID, { cuit: '30-50001274-6' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['cuit']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si el id no es un uuid', async () => {
      const res = await patchCliente('no-es-un-uuid', { razonSocial: 'Otra S.A.' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['id']);
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
    });

    it('responde 400 si pasa a PUBLICO sin subtipo', async () => {
      const res = await patchCliente(ID, { sector: 'PUBLICO' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['subtipo']);
    });

    it('responde 400 si envía subtipo para un sector PRIVADO', async () => {
      const res = await patchCliente(ID, { sector: 'PRIVADO', subtipo: 'MUNICIPAL' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['subtipo']);
    });

    it('responde 400 si envía subtipo, sin sector, para un cliente privado guardado', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({ sector: 'PRIVADO', canalEntrega: 'CORREO' }),
      );

      const res = await patchCliente(ID, { subtipo: 'MUNICIPAL' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['subtipo']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si pasa a PORTAL_WEB sin portalUrl', async () => {
      const res = await patchCliente(ID, { canalEntrega: 'PORTAL_WEB' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['portalUrl']);
    });

    it('responde 400 si pasa a WHATSAPP sin número', async () => {
      const res = await patchCliente(ID, { canalEntrega: 'WHATSAPP' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['whatsappNumero']);
    });
  });

  // El schema solo ve el pedido; la regla de los emails se aplica sobre el estado resultante
  // (lo enviado más lo guardado: principal 'compras@…' y adicionales ['otro@…']).
  describe('emails en una edición parcial', () => {
    it('responde 400 si el nuevo emailContacto ya es un adicional guardado', async () => {
      const res = await patchCliente(ID, { emailContacto: ' OTRO@municipio.example ' });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['emailContacto']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 400 si los nuevos adicionales incluyen el emailContacto guardado', async () => {
      const res = await patchCliente(ID, {
        emailsAdicionales: ['nuevo@municipio.example', 'COMPRAS@municipio.example'],
      });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['emailsAdicionales.1']);
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('cambiar solo el emailContacto a un email libre es válido', async () => {
      const res = await patchCliente(ID, { emailContacto: 'nuevo@municipio.example' });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ emailContacto: 'nuevo@municipio.example' });
    });

    it('cambiar solo los adicionales a emails libres es válido', async () => {
      const res = await patchCliente(ID, { emailsAdicionales: ['uno@municipio.example'] });

      expect(res.status).toBe(200);
      expect(dataEnviada()).toEqual({ emailsAdicionales: ['uno@municipio.example'] });
    });

    it('reenviar el mismo emailContacto o vaciar los adicionales es válido', async () => {
      expect((await patchCliente(ID, { emailContacto: 'compras@municipio.example' })).status).toBe(
        200,
      );
      expect((await patchCliente(ID, { emailsAdicionales: [] })).status).toBe(200);
    });

    it('un PATCH que no toca los emails no los compara, aunque lo guardado ya repita', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({
          emailsAdicionales: ['compras@municipio.example', 'x@m.example', 'x@m.example'],
        }),
      );

      const res = await patchCliente(ID, { razonSocial: 'Otro Nombre' });

      expect(res.status).toBe(200);
    });

    it('cambiar el principal solo se compara con los adicionales guardados, no entre ellos', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(
        guardado({ emailsAdicionales: ['x@m.example', 'x@m.example'] }),
      );

      const libre = await patchCliente(ID, { emailContacto: 'nuevo@municipio.example' });
      expect(libre.status).toBe(200);

      const repetido = await patchCliente(ID, { emailContacto: 'X@m.example' });
      expect(repetido.status).toBe(400);
      expect(detalleDeValidacion(repetido)).toEqual(['emailContacto']);
    });

    it('un pedido con repetidos entre sí se rechaza antes de consultar la base', async () => {
      const res = await patchCliente(ID, { emailsAdicionales: ['a@m.example', 'A@m.example'] });

      expect(res.status).toBe(400);
      expect(detalleDeValidacion(res)).toEqual(['emailsAdicionales.0', 'emailsAdicionales.1']);
      expect(prismaMock.cliente.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('cliente inexistente', () => {
    it('responde 404 si no existe o está dado de baja', async () => {
      prismaMock.cliente.findFirst.mockResolvedValue(null);

      const res = await patchCliente(ID, { razonSocial: 'Otra S.A.' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(prismaMock.cliente.update).not.toHaveBeenCalled();
    });

    it('responde 404 si se da de baja entre la consulta y la actualización', async () => {
      prismaMock.cliente.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: Prisma.prismaVersion.client,
        }),
      );

      const res = await patchCliente(ID, { razonSocial: 'Otra S.A.' });

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    });
  });

  describe('CUIT de otro cliente', () => {
    it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'] as const)(
      'responde 409 con el cliente %s que ya tiene el CUIT',
      async (estado) => {
        prismaMock.cliente.update.mockRejectedValue(errorDeIndiceUnico(['cuit']));
        prismaMock.cliente.findUnique.mockResolvedValue({
          id: ID_OTRO,
          razonSocial: 'Cliente Existente S.A.',
          estado,
        });

        const res = await patchCliente(ID, { cuit: '20123456786' });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error: {
            code: 'CONFLICT',
            message: 'Ya existe un cliente con ese CUIT',
            details: {
              motivo: 'CUIT_DUPLICADO',
              clienteExistente: {
                id: ID_OTRO,
                razonSocial: 'Cliente Existente S.A.',
                estado,
              },
            },
          },
        });
        expect(prismaMock.cliente.findUnique).toHaveBeenCalledWith({
          where: { cuit: '20-12345678-6' },
          select: { id: true, razonSocial: true, estado: true },
        });
      },
    );
  });

  describe('errores inesperados', () => {
    it('responde 500 genérico ante un fallo de Prisma', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      prismaMock.cliente.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('boom', {
          code: 'P1001',
          clientVersion: Prisma.prismaVersion.client,
        }),
      );

      const res = await patchCliente(ID, { razonSocial: 'Otra S.A.' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
      });
    });
  });
});
