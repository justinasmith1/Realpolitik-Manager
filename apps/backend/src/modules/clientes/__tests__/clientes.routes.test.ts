import { Prisma, type Cliente as ClienteRow } from '@prisma/client';
import { ClienteSchema } from '@realpolitik/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';

// Prisma se reemplaza por dobles: el CI no tiene base de datos. Así se recorre la cadena real
// route → validate → controller → service → mapper → errorHandler, y solo la base es simulada.
const prismaMock = vi.hoisted(() => ({
  cliente: {
    create: vi.fn<(args: { data: Prisma.ClienteCreateInput }) => Promise<ClienteRow>>(),
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

const ID_CREADO = 'c3d4e5f6-a7b8-4901-8def-012345678901';
const AHORA = new Date('2026-10-08T12:00:00.000Z');

/** Lo que devolvería la base al insertar `data`, incluidos sus defaults. */
function filaInsertada({ data }: { data: Prisma.ClienteCreateInput }): ClienteRow {
  return {
    id: ID_CREADO,
    razonSocial: data.razonSocial,
    denominacion: data.denominacion,
    cuit: data.cuit,
    ivaCondicion: data.ivaCondicion,
    emailContacto: data.emailContacto,
    emailsAdicionales: Array.isArray(data.emailsAdicionales) ? data.emailsAdicionales : [],
    telefono: data.telefono ?? null,
    portalUrl: data.portalUrl ?? null,
    canalEntrega: data.canalEntrega ?? 'CORREO',
    whatsappNumero: data.whatsappNumero ?? null,
    periodicidadTipo: data.periodicidadTipo ?? null,
    periodicidadDiaLimite: data.periodicidadDiaLimite ?? null,
    periodicidadMesInicioCiclo: data.periodicidadMesInicioCiclo ?? null,
    sector: data.sector,
    subtipo: data.subtipo ?? null,
    estado: data.estado ?? 'ACTIVO',
    isDeleted: false,
    deletedAt: null,
    createdAt: AHORA,
    updatedAt: AHORA,
  };
}

/** Error que lanza Prisma 5 (PostgreSQL) cuando se viola un índice único. */
function errorDeIndiceUnico(campos: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (${campos.map((c) => `\`${c}\``).join(',')})`,
    { code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { target: campos } },
  );
}

// Datos ficticios. El CUIT público llega sin guiones y el email en mayúsculas para
// comprobar que el backend persiste lo que normaliza shared.
const altaPublica = {
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30500012745',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'Compras@Municipio.Example',
};

const altaPrivada = {
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
};

const ERROR_INTERNO = {
  error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' },
};

const postClientes = (body: object) => request(app).post('/clientes').send(body);

/** Silencia el log del errorHandler en los casos 500 y permite revisar qué registró. */
const espiarConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  prismaMock.cliente.create.mockImplementation((args) => Promise.resolve(filaInsertada(args)));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('POST /clientes', () => {
  describe('alta exitosa', () => {
    it('crea un cliente público ACTIVO y responde 201 con el contrato', async () => {
      const res = await postClientes(altaPublica);

      expect(res.status).toBe(201);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({
        id: ID_CREADO,
        razonSocial: 'Municipio de Ejemplo',
        denominacion: 'Muni Ejemplo',
        cuit: '30-50001274-5',
        sector: 'PUBLICO',
        subtipo: 'MUNICIPAL',
        ivaCondicion: 'EXENTO',
        emailContacto: 'compras@municipio.example',
        emailsAdicionales: [],
        canalEntrega: 'CORREO',
        periodicidad: null,
        estado: 'ACTIVO',
        creadoEn: AHORA.toISOString(),
        actualizadoEn: AHORA.toISOString(),
      });
      expect(ClienteSchema.safeParse(res.body).success).toBe(true);

      expect(prismaMock.cliente.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.cliente.create).toHaveBeenCalledWith({
        data: {
          razonSocial: 'Municipio de Ejemplo',
          denominacion: 'Muni Ejemplo',
          cuit: '30-50001274-5',
          ivaCondicion: 'EXENTO',
          emailContacto: 'compras@municipio.example',
          emailsAdicionales: [],
          telefono: null,
          portalUrl: null,
          canalEntrega: 'CORREO',
          whatsappNumero: null,
          periodicidadTipo: null,
          periodicidadDiaLimite: null,
          periodicidadMesInicioCiclo: null,
          sector: 'PUBLICO',
          subtipo: 'MUNICIPAL',
          estado: 'ACTIVO',
        },
      });
    });

    it('crea un cliente privado con subtipo null en la base y sin subtipo en la respuesta', async () => {
      const res = await postClientes(altaPrivada);

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('subtipo');
      expect(res.body).toMatchObject({ sector: 'PRIVADO', estado: 'ACTIVO' });
      expect(prismaMock.cliente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sector: 'PRIVADO', subtipo: null }) as unknown,
      });
    });

    it('ignora el estado que envía el pedido: el cliente nace ACTIVO', async () => {
      const res = await postClientes({ ...altaPrivada, estado: 'INACTIVO' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ estado: 'ACTIVO' });
      expect(prismaMock.cliente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ estado: 'ACTIVO' }) as unknown,
      });
    });
  });

  describe('periodicidad', () => {
    it('sin periodicidad persiste null en las tres columnas y responde periodicidad null', async () => {
      const res = await postClientes(altaPrivada);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('periodicidad', null);
      expect(prismaMock.cliente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodicidadTipo: null,
          periodicidadDiaLimite: null,
          periodicidadMesInicioCiclo: null,
        }) as unknown,
      });
    });

    it.each([
      [
        'MENSUAL',
        { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
        {
          periodicidadTipo: 'MENSUAL',
          periodicidadDiaLimite: 10,
          periodicidadMesInicioCiclo: null,
        },
      ],
      [
        'BIMESTRAL',
        { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 },
        { periodicidadTipo: 'BIMESTRAL', periodicidadDiaLimite: 15, periodicidadMesInicioCiclo: 3 },
      ],
      [
        'POR_CAMPANIA',
        { tipo: 'POR_CAMPANIA', diaLimite: 28, mesInicioCiclo: null },
        {
          periodicidadTipo: 'POR_CAMPANIA',
          periodicidadDiaLimite: 28,
          periodicidadMesInicioCiclo: null,
        },
      ],
    ])(
      'persiste las tres columnas y devuelve la periodicidad %s',
      async (_tipo, periodicidad, columnas) => {
        const res = await postClientes({ ...altaPublica, periodicidad });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ periodicidad });
        expect(ClienteSchema.safeParse(res.body).success).toBe(true);
        expect(prismaMock.cliente.create).toHaveBeenCalledWith({
          data: expect.objectContaining(columnas) as unknown,
        });
      },
    );

    it('no guarda un objeto periodicidad en la base: solo las tres columnas', async () => {
      await postClientes({
        ...altaPrivada,
        periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
      });

      expect(prismaMock.cliente.create.mock.calls[0]?.[0].data).not.toHaveProperty('periodicidad');
    });

    it.each([
      [
        'un día límite fuera de rango',
        { tipo: 'MENSUAL', diaLimite: 29, mesInicioCiclo: null },
        'periodicidad.diaLimite',
      ],
      [
        'un bimestral sin mes de inicio',
        { tipo: 'BIMESTRAL', diaLimite: 10, mesInicioCiclo: null },
        'periodicidad.mesInicioCiclo',
      ],
      [
        'un mensual con mes de inicio',
        { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: 3 },
        'periodicidad.mesInicioCiclo',
      ],
    ])('responde 400 con %s, sin tocar la base', async (_caso, periodicidad, campo) => {
      const res = await postClientes({ ...altaPrivada, periodicidad });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: [expect.objectContaining({ campo })] },
      });
      expect(prismaMock.cliente.create).not.toHaveBeenCalled();
    });

    it('con periodicidad válida, un CUIT duplicado sigue siendo 409', async () => {
      prismaMock.cliente.create.mockRejectedValue(errorDeIndiceUnico(['cuit']));
      prismaMock.cliente.findUnique.mockResolvedValue({
        id: 'd4e5f6a7-b8c9-4012-9ef0-123456789012',
        razonSocial: 'Cliente Existente S.A.',
        estado: 'ACTIVO',
      });

      const res = await postClientes({
        ...altaPublica,
        periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
      });

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: { code: 'CONFLICT' } });
    });
  });

  describe('datos inválidos', () => {
    it('responde 400 si falta un campo obligatorio, sin tocar la base', async () => {
      const { razonSocial: _omitida, ...sinRazonSocial } = altaPublica;

      const res = await postClientes(sinRazonSocial);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [expect.objectContaining({ campo: 'razonSocial' })],
        },
      });
      expect(prismaMock.cliente.create).not.toHaveBeenCalled();
    });

    it('responde 400 si el CUIT tiene un dígito verificador incorrecto, sin tocar la base', async () => {
      const res = await postClientes({ ...altaPublica, cuit: '30-50001274-6' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [
            {
              campo: 'cuit',
              mensaje:
                'El CUIT ingresado no es válido (dígito verificador incorrecto o prefijo inválido).',
            },
          ],
        },
      });
      expect(prismaMock.cliente.create).not.toHaveBeenCalled();
    });
  });

  // Lo que la base no podría guardar (columna más corta, NUL) o que no es un dato válido se
  // rechaza con 400 antes de llegar a Prisma. Contra PostgreSQL real: `clientes.integration.test.ts`.
  describe('datos que la base no aceptaría', () => {
    const email = (largo: number) => `${'a'.repeat(largo - '@e.example'.length)}@e.example`;
    const conPortal = (portalUrl: string) => ({
      ...altaPrivada,
      canalEntrega: 'PORTAL_WEB',
      portalUrl,
    });

    it.each([
      ['razonSocial de 151 caracteres', { razonSocial: 'x'.repeat(151) }, 'razonSocial'],
      ['denominacion de 61 caracteres', { denominacion: 'x'.repeat(61) }, 'denominacion'],
      ['emailContacto de 255 caracteres', { emailContacto: email(255) }, 'emailContacto'],
      ['un email adicional de 255', { emailsAdicionales: [email(255)] }, 'emailsAdicionales.0'],
      ['razonSocial con NUL', { razonSocial: 'Empresa\u0000S.A.' }, 'razonSocial'],
      ['denominacion con salto de línea', { denominacion: 'Emp\nresa' }, 'denominacion'],
      [
        'emails adicionales repetidos',
        { emailsAdicionales: ['A@e.example', 'a@e.example'] },
        'emailsAdicionales.0',
      ],
      [
        'un adicional igual al principal',
        { emailsAdicionales: ['ADMIN@empresa.example'] },
        'emailsAdicionales.0',
      ],
      [
        'portalUrl de 501 caracteres',
        conPortal(`https://e.example/${'a'.repeat(483)}`),
        'portalUrl',
      ],
      ['portalUrl javascript:', conPortal('javascript:alert(1)'), 'portalUrl'],
      ['portalUrl data:', conPortal('data:text/html,<script>alert(1)</script>'), 'portalUrl'],
      ['portalUrl ftp:', conPortal('ftp://e.example/x'), 'portalUrl'],
      ['portalUrl con credenciales', conPortal('https://usuario:clave@e.example'), 'portalUrl'],
      [
        'whatsappNumero de 16 dígitos',
        { canalEntrega: 'WHATSAPP', whatsappNumero: '5493511234567890' },
        'whatsappNumero',
      ],
    ])('responde 400 con %s, sin tocar la base', async (_caso, cambios, campo) => {
      const res = await postClientes({ ...altaPrivada, ...cambios });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: expect.arrayContaining([expect.objectContaining({ campo })]) as unknown,
        },
      });
      expect(prismaMock.cliente.create).not.toHaveBeenCalled();
    });

    it('acepta los máximos exactos y los envía tal cual a la base', async () => {
      const portalUrl = `https://e.example/${'a'.repeat(482)}`;
      expect(portalUrl).toHaveLength(500);

      const res = await postClientes({
        ...altaPrivada,
        razonSocial: 'x'.repeat(150),
        denominacion: 'x'.repeat(60),
        emailContacto: email(254),
        canalEntrega: 'PORTAL_WEB',
        portalUrl,
      });

      expect(res.status).toBe(201);
      expect(prismaMock.cliente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          razonSocial: 'x'.repeat(150),
          denominacion: 'x'.repeat(60),
          emailContacto: email(254),
          portalUrl,
        }) as unknown,
      });
    });
  });

  describe('CUIT duplicado', () => {
    it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'] as const)(
      'responde 409 con el cliente %s que ya tiene el CUIT',
      async (estado) => {
        prismaMock.cliente.create.mockRejectedValue(errorDeIndiceUnico(['cuit']));
        prismaMock.cliente.findUnique.mockResolvedValue({
          id: 'd4e5f6a7-b8c9-4012-9ef0-123456789012',
          razonSocial: 'Cliente Existente S.A.',
          estado,
        });

        const res = await postClientes(altaPublica);

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error: {
            code: 'CONFLICT',
            message: 'Ya existe un cliente con ese CUIT',
            details: {
              motivo: 'CUIT_DUPLICADO',
              clienteExistente: {
                id: 'd4e5f6a7-b8c9-4012-9ef0-123456789012',
                razonSocial: 'Cliente Existente S.A.',
                estado,
              },
            },
          },
        });
        // Busca por el CUIT ya normalizado y sin filtrar por estado ni baja lógica.
        expect(prismaMock.cliente.findUnique).toHaveBeenCalledWith({
          where: { cuit: '30-50001274-5' },
          select: { id: true, razonSocial: true, estado: true },
        });
      },
    );
  });

  describe('errores inesperados', () => {
    it('no informa CUIT duplicado si el índice único violado es otro', async () => {
      espiarConsoleError();
      prismaMock.cliente.create.mockRejectedValue(errorDeIndiceUnico(['otroCampo']));

      const res = await postClientes(altaPublica);

      expect(res.status).toBe(500);
      expect(res.body).toEqual(ERROR_INTERNO);
      expect(prismaMock.cliente.findUnique).not.toHaveBeenCalled();
    });

    it('responde 500 si tras el P2002 no encuentra al cliente con ese CUIT', async () => {
      espiarConsoleError();
      prismaMock.cliente.create.mockRejectedValue(errorDeIndiceUnico(['cuit']));
      prismaMock.cliente.findUnique.mockResolvedValue(null);

      const res = await postClientes(altaPublica);

      expect(res.status).toBe(500);
      expect(res.body).toEqual(ERROR_INTERNO);
    });

    it('responde 500 genérico ante un fallo de Prisma, sin filtrar datos ni registrarlos', async () => {
      const logged = espiarConsoleError();
      prismaMock.cliente.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Invalid `prisma.cliente.create()` invocation: INSERT ... 30-50001274-5 compras@municipio.example',
          { code: 'P1001', clientVersion: Prisma.prismaVersion.client },
        ),
      );

      const res = await postClientes(altaPublica);

      expect(res.status).toBe(500);
      expect(res.body).toEqual(ERROR_INTERNO);
      // El errorHandler registra solo el nombre del error y el método: nunca el mensaje.
      const datosSensibles = /INSERT|invocation|30-50001274-5|compras@/i;
      expect(JSON.stringify(logged.mock.calls)).not.toMatch(datosSensibles);
    });
  });
});
