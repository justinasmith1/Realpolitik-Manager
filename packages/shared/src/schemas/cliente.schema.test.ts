import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ZodError } from 'zod';

import {
  ActualizarEstadoClienteSchema,
  ClienteSchema,
  ClienteSubtipoPublico,
  CreateClienteSchema,
  CuitSchema,
  IvaCondicion,
  PeriodicidadSchema,
  PeriodicidadTipo,
  UpdateClienteSchema,
  type Cliente,
  type CreateClienteDto,
  type Periodicidad,
  type UpdateClienteDto,
} from './cliente.schema.js';

// ─── Payloads base ────────────────────────────────────────────────────────────
//
// CUITs verificados con el algoritmo Módulo 11:
//   30-50001274-5 → ✅ persona jurídica (sector público)
//   20-12345678-6 → ✅ persona física masculina (sector privado)

const BASE = {
  id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  razonSocial: 'Agencia Realpolitik S.A.',
  denominacion: 'Realpolitik',
  cuit: '30-50001274-5',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO' as const,
  emailContacto: 'contacto@realpolitik.com.ar',
  periodicidad: null,
  estado: 'ACTIVO' as const,
  creadoEn: new Date('2024-01-15'),
  actualizadoEn: new Date('2024-06-30'),
};

/** Cliente del sector público (subtipo requerido) */
const clientePublico = {
  ...BASE,
  sector: 'PUBLICO' as const,
  subtipo: 'MUNICIPAL' as const,
};

/** Cliente del sector privado (subtipo no aplica) */
const clientePrivado = {
  ...BASE,
  cuit: '20-12345678-6',
  sector: 'PRIVADO' as const,
};

// ─── Tests del schema completo ────────────────────────────────────────────────

describe('ClienteSchema', () => {
  // ─── Sector PÚBLICO ──────────────────────────────────────────────────────────
  describe('Sector PÚBLICO — validaciones exitosas', () => {
    it('parsea un cliente público con subtipo MUNICIPAL', () => {
      const result = ClienteSchema.safeParse(clientePublico);
      expect(result.success).toBe(true);
    });

    it('parsea un cliente público con subtipo PROVINCIAL_ORGANISMO', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        subtipo: 'PROVINCIAL_ORGANISMO',
      });
      expect(result.success).toBe(true);
    });

    it('parsea un cliente público con subtipo SINDICAL_OBRA_SOCIAL', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        subtipo: 'SINDICAL_OBRA_SOCIAL',
      });
      expect(result.success).toBe(true);
    });

    it('preserva el subtipo en el resultado parseado', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        subtipo: 'PROVINCIAL_ORGANISMO',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.subtipo).toBe('PROVINCIAL_ORGANISMO');
      }
    });
  });

  describe('Sector PÚBLICO — fallos de validación', () => {
    it('falla si sector es PÚBLICO y subtipo está ausente', () => {
      const { subtipo: _, ...sinSubtipo } = clientePublico;
      const result = ClienteSchema.safeParse(sinSubtipo);
      expect(result.success).toBe(false);
    });

    it('falla si sector es PÚBLICO y subtipo es un valor inválido', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        subtipo: 'NACIONAL', // no existe en el enum
      });
      expect(result.success).toBe(false);
    });

    it('falla si sector es PÚBLICO y subtipo es null', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        subtipo: null,
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Sector PRIVADO ──────────────────────────────────────────────────────────
  describe('Sector PRIVADO — validaciones exitosas', () => {
    it('parsea un cliente privado sin subtipo', () => {
      const result = ClienteSchema.safeParse(clientePrivado);
      expect(result.success).toBe(true);
    });

    it('parsea un cliente privado con subtipo explícitamente undefined', () => {
      const result = ClienteSchema.safeParse({
        ...clientePrivado,
        subtipo: undefined,
      });
      expect(result.success).toBe(true);
    });

    it('el subtipo no aparece en el resultado de un cliente privado', () => {
      const result = ClienteSchema.safeParse(clientePrivado);
      expect(result.success).toBe(true);
      if (result.success) {
        // Zod stripea campos no definidos en el schema de la rama PRIVADO
        expect(result.data.sector).toBe('PRIVADO');
      }
    });
  });

  describe('Sector PRIVADO — fallos de validación', () => {
    it('falla si sector es PRIVADO y subtipo tiene un valor definido', () => {
      const result = ClienteSchema.safeParse({
        ...clientePrivado,
        subtipo: 'MUNICIPAL', // PRIVADO no debe aceptar subtipos
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Discriminador de sector ─────────────────────────────────────────────────
  describe('Discriminador sector', () => {
    it('falla si sector está ausente', () => {
      const { sector: _, ...sinSector } = clientePublico;
      const result = ClienteSchema.safeParse(sinSector);
      expect(result.success).toBe(false);
    });

    it('falla si sector tiene un valor fuera del enum', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        sector: 'INTERNACIONAL', // valor inexistente
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Validaciones compartidas (aplican a ambos sectores) ─────────────────────
  describe('Validaciones compartidas', () => {
    it('normaliza el email a minúsculas automáticamente', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        emailContacto: 'UPPER@REALPOLITIK.COM.AR',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.emailContacto).toBe('upper@realpolitik.com.ar');
      }
    });

    it('asigna estado ACTIVO por defecto si no se provee', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { estado, ...sinEstado } = clientePublico;
      const result = ClienteSchema.safeParse(sinEstado);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.estado).toBe('ACTIVO');
      }
    });

    it('normaliza CUIT sin guiones al formato XX-XXXXXXXX-X', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, cuit: '30500012745' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cuit).toBe('30-50001274-5');
      }
    });

    it('normaliza CUIT con espacios al formato XX-XXXXXXXX-X', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, cuit: '30 50001274 5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cuit).toBe('30-50001274-5');
      }
    });

    it('devuelve el CUIT con guiones sin modificarlo si ya tiene el formato correcto', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, cuit: '30-50001274-5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cuit).toBe('30-50001274-5');
      }
    });

    it('acepta emailsAdicionales vacío por defecto', () => {
      const result = ClienteSchema.safeParse(clientePublico);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.emailsAdicionales).toEqual([]);
      }
    });

    it('acepta portalUrl como URL válida', () => {
      const result = ClienteSchema.safeParse({
        ...clientePrivado,
        portalUrl: 'https://proveedores.buenosaires.gob.ar',
      });
      expect(result.success).toBe(true);
    });

    it('parsea creadoEn desde string ISO (coerce.date)', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        creadoEn: '2024-01-15T00:00:00.000Z',
        actualizadoEn: '2024-06-30T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── Fallos por CUIT ────────────────────────────────────────────────────────
  describe('Fallos de validación — CUIT', () => {
    it('falla si el CUIT tiene dígito verificador incorrecto', () => {
      // 30-50001274-5 es válido → cambiar el verificador a 6 lo invalida
      const result = ClienteSchema.safeParse({ ...clientePublico, cuit: '30-50001274-6' });
      expect(result.success).toBe(false);
    });

    it('falla si el CUIT tiene formato inválido (letras)', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, cuit: '30-5000127A-5' });
      expect(result.success).toBe(false);
    });

    it('falla si el CUIT tiene prefijo no reconocido por AFIP', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, cuit: '99-50001274-5' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Fallos por razón social ────────────────────────────────────────────────
  describe('Fallos de validación — razonSocial', () => {
    it('falla si la razón social tiene menos de 2 caracteres', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, razonSocial: 'A' });
      expect(result.success).toBe(false);
    });

    it('falla si la razón social supera los 150 caracteres', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        razonSocial: 'A'.repeat(151),
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Fallos por denominación ────────────────────────────────────────────────
  describe('Fallos de validación — denominacion', () => {
    it('falla si la denominación está ausente', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { denominacion, ...sinDenominacion } = clientePublico;
      const result = ClienteSchema.safeParse(sinDenominacion);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('denominacion'))).toBe(true);
      }
    });

    it('falla si la denominación tiene menos de 2 caracteres', () => {
      const result = ClienteSchema.safeParse({ ...clientePublico, denominacion: 'A' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('denominacion'))).toBe(true);
      }
    });

    it('falla si la denominación supera los 60 caracteres', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        denominacion: 'A'.repeat(61),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes('denominacion'))).toBe(true);
      }
    });

    it('aplica trim a la denominación', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        denominacion: '  Muni Cba  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.denominacion).toBe('Muni Cba');
      }
    });
  });

  // ─── Fallos por email ───────────────────────────────────────────────────────
  describe('Fallos de validación — email', () => {
    it('falla si el email de contacto es inválido', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        emailContacto: 'no-es-email',
      });
      expect(result.success).toBe(false);
    });

    it('falla si un email adicional es inválido', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        emailsAdicionales: ['valido@ok.com', 'invalido'],
      });
      expect(result.success).toBe(false);
    });

    it('falla si se proveen más de 10 emails adicionales', () => {
      const result = ClienteSchema.safeParse({
        ...clientePublico,
        emailsAdicionales: Array.from({ length: 11 }, (_, i) => `email${i}@ok.com`),
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Fallos por portal URL ──────────────────────────────────────────────────
  describe('Fallos de validación — portalUrl', () => {
    it('falla si portalUrl no es una URL válida', () => {
      const result = ClienteSchema.safeParse({ ...clientePrivado, portalUrl: 'no-es-url' });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Tests de CreateClienteSchema ────────────────────────────────────────────

/** Alta de un cliente público: solo los campos que envía el front. */
const altaPublica = {
  razonSocial: 'Municipio de Paraná',
  denominacion: 'Muni Paraná',
  cuit: '30-50001274-5',
  sector: 'PUBLICO' as const,
  subtipo: 'MUNICIPAL' as const,
  ivaCondicion: 'EXENTO' as const,
  emailContacto: 'municipio@parana.gob.ar',
};

/** Alta de un cliente privado: solo los campos que envía el front. */
const altaPrivada = {
  razonSocial: 'Empresa Privada S.A.',
  denominacion: 'Empresa Privada',
  cuit: '20-12345678-6',
  sector: 'PRIVADO' as const,
  ivaCondicion: 'RESPONSABLE_INSCRIPTO' as const,
  emailContacto: 'empresa@privada.com',
};

/** Paths de los issues de un parse fallido, en notación de puntos. */
const pathsConError = (result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? [];

describe('CreateClienteSchema', () => {
  it.each([
    ['público', altaPublica],
    ['privado', altaPrivada],
  ])('acepta un alta %s sin campos del servidor y no los agrega', (_sector, payload) => {
    const result = CreateClienteSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('id');
      expect(result.data).not.toHaveProperty('estado');
      expect(result.data).not.toHaveProperty('creadoEn');
      expect(result.data).not.toHaveProperty('actualizadoEn');
    }
  });

  // El estado lo fija el servidor. Las claves desconocidas se descartan (no hay `.strict()`),
  // así que enviarlo no es un error: simplemente no llega al resultado.
  it.each(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'])(
    'descarta el estado %s enviado por el pedido',
    (estado) => {
      const result = CreateClienteSchema.safeParse({ ...altaPrivada, estado });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('estado');
      }
    },
  );

  it('descarta id, fechas y campos internos enviados por el pedido', () => {
    const result = CreateClienteSchema.safeParse({
      ...altaPublica,
      id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      creadoEn: '2024-01-15T00:00:00.000Z',
      actualizadoEn: '2024-06-30T00:00:00.000Z',
      isDeleted: true,
      deletedAt: '2024-06-30T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      for (const campo of ['id', 'creadoEn', 'actualizadoEn', 'isDeleted', 'deletedAt']) {
        expect(result.data).not.toHaveProperty(campo);
      }
    }
  });

  it('CreateClienteDto no expone estado (lo verifica el typecheck)', () => {
    expectTypeOf<CreateClienteDto>().not.toHaveProperty('estado');
    expectTypeOf<CreateClienteDto>().not.toHaveProperty('id');
  });

  it.each(['emailContacto', 'ivaCondicion', 'sector'] as const)('sigue exigiendo %s', (campo) => {
    const { [campo]: _omitido, ...sinCampo } = altaPublica;
    const result = CreateClienteSchema.safeParse(sinCampo);
    expect(result.success).toBe(false);
    expect(pathsConError(result)).toContain(campo);
  });

  it('rechaza un alta privada con subtipo', () => {
    const result = CreateClienteSchema.safeParse({ ...altaPrivada, subtipo: 'MUNICIPAL' });
    expect(result.success).toBe(false);
    expect(pathsConError(result)).toContain('subtipo');
  });

  it('falla si el payload no incluye denominacion', () => {
    const payload = {
      razonSocial: 'Municipio de Paraná',
      cuit: '30-50001274-5',
      sector: 'PUBLICO' as const,
      subtipo: 'MUNICIPAL' as const,
      ivaCondicion: 'EXENTO' as const,
      emailContacto: 'municipio@parana.gob.ar',
    };
    const result = CreateClienteSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('denominacion'))).toBe(true);
    }
  });

  it('falla si el payload público no incluye subtipo', () => {
    const payload = {
      razonSocial: 'Organismo sin subtipo',
      denominacion: 'Organismo',
      cuit: '30-50001274-5',
      sector: 'PUBLICO' as const,
      ivaCondicion: 'EXENTO' as const,
      emailContacto: 'sin@subtipo.gob.ar',
    };
    const result = CreateClienteSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  // ─── Trim antes de validar longitud ─────────────────────────────────────────
  // La longitud se mide sobre el valor ya normalizado: un texto de solo espacios no
  // cuenta como dato, y los espacios exteriores no consumen el máximo.
  describe.each([
    { campo: 'razonSocial', max: 150 },
    { campo: 'denominacion', max: 60 },
  ] as const)('trim de $campo', ({ campo, max }) => {
    it('rechaza un valor de solo espacios', () => {
      const result = CreateClienteSchema.safeParse({ ...altaPrivada, [campo]: '   ' });
      expect(result.success).toBe(false);
      expect(pathsConError(result)).toContain(campo);
    });

    it('aplica el mínimo de 2 después del trim', () => {
      const result = CreateClienteSchema.safeParse({ ...altaPrivada, [campo]: '  A  ' });
      expect(result.success).toBe(false);
      expect(pathsConError(result)).toContain(campo);
    });

    it('acepta un valor válido con espacios exteriores y lo devuelve normalizado', () => {
      const result = CreateClienteSchema.safeParse({ ...altaPrivada, [campo]: '  AB  ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[campo]).toBe('AB');
      }
    });

    it(`aplica el máximo de ${max} sobre el valor normalizado`, () => {
      const enElLimite = CreateClienteSchema.safeParse({
        ...altaPrivada,
        [campo]: `  ${'A'.repeat(max)}  `,
      });
      expect(enElLimite.success).toBe(true);

      const excedido = CreateClienteSchema.safeParse({
        ...altaPrivada,
        [campo]: `  ${'A'.repeat(max + 1)}  `,
      });
      expect(excedido.success).toBe(false);
      expect(pathsConError(excedido)).toContain(campo);
    });
  });
});

// ─── Tests de CuitSchema ──────────────────────────────────────────────────────

describe('CuitSchema', () => {
  // 20-12345678-6 es ficticio y válido por Módulo 11 (ver payloads base).
  it.each([
    ['canónico', '20-12345678-6'],
    ['de 11 dígitos', '20123456786'],
    ['con espacios', '20 12345678 6'],
  ])('acepta un CUIT %s y lo devuelve en formato canónico', (_formato, cuit) => {
    const result = CuitSchema.safeParse(cuit);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('20-12345678-6');
    }
  });

  it('rechaza un CUIT con dígito verificador incorrecto', () => {
    const result = CuitSchema.safeParse('20-12345678-5');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'El CUIT ingresado no es válido (dígito verificador incorrecto o prefijo inválido).',
      );
    }
  });

  it('rechaza un CUIT con formato no admitido', () => {
    expect(CuitSchema.safeParse('2012345678').success).toBe(false);
  });

  it('es la regla que aplica el alta de cliente', () => {
    const result = CreateClienteSchema.safeParse({ ...altaPrivada, cuit: '20123456786' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cuit).toBe('20-12345678-6');
    }
  });
});

// ─── Tests de UpdateClienteSchema ────────────────────────────────────────────

describe('UpdateClienteSchema', () => {
  /** Rutas de los campos que Zod marcó con error. */
  const camposConError = (resultado: { error?: ZodError }) =>
    resultado.error?.issues.map((issue) => issue.path.join('.')) ?? [];

  it('permite actualizar la denominacion sin enviar el sector', () => {
    const result = UpdateClienteSchema.safeParse({ denominacion: 'Nuevo Alias' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.denominacion).toBe('Nuevo Alias');
    }
  });

  it('permite omitir la denominacion en una actualizacion parcial', () => {
    const result = UpdateClienteSchema.safeParse({ telefono: '+54 11 4000-1234' });
    expect(result.success).toBe(true);
  });

  it('falla si la denominacion en actualizacion tiene menos de 2 caracteres', () => {
    const result = UpdateClienteSchema.safeParse({ denominacion: 'X' });
    expect(camposConError(result)).toEqual(['denominacion']);
  });

  it('falla si la denominacion en actualizacion supera los 60 caracteres', () => {
    const result = UpdateClienteSchema.safeParse({ denominacion: 'X'.repeat(61) });
    expect(camposConError(result)).toEqual(['denominacion']);
  });

  describe('al menos un campo', () => {
    it('rechaza un pedido vacío', () => {
      const result = UpdateClienteSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rechaza un pedido que solo trae campos que no se editan', () => {
      const result = UpdateClienteSchema.safeParse({ estado: 'INACTIVO', id: BASE.id });
      expect(result.success).toBe(false);
    });
  });

  describe('campos del servidor', () => {
    it('ignora estado, id y fechas sin error, y no los devuelve', () => {
      const result = UpdateClienteSchema.safeParse({
        razonSocial: 'Otra S.A.',
        estado: 'INACTIVO',
        id: BASE.id,
        creadoEn: '2020-01-01',
        actualizadoEn: '2020-01-01',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ razonSocial: 'Otra S.A.' });
    });
  });

  describe('sin defaults', () => {
    it('un campo ausente queda ausente: no pisa canalEntrega ni emailsAdicionales', () => {
      const result = UpdateClienteSchema.safeParse({ razonSocial: 'Otra S.A.' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('canalEntrega');
        expect(result.data).not.toHaveProperty('emailsAdicionales');
      }
    });
  });

  describe('sector y subtipo', () => {
    it('acepta pasar a PUBLICO con subtipo', () => {
      const result = UpdateClienteSchema.safeParse({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' });
      expect(result.success).toBe(true);
    });

    it('rechaza pasar a PUBLICO sin subtipo y marca subtipo', () => {
      const result = UpdateClienteSchema.safeParse({ sector: 'PUBLICO' });
      expect(camposConError(result)).toEqual(['subtipo']);
    });

    it('acepta pasar a PRIVADO sin subtipo', () => {
      const result = UpdateClienteSchema.safeParse({ sector: 'PRIVADO' });
      expect(result.success).toBe(true);
    });

    it('rechaza PRIVADO con subtipo y marca subtipo', () => {
      const result = UpdateClienteSchema.safeParse({ sector: 'PRIVADO', subtipo: 'MUNICIPAL' });
      expect(camposConError(result)).toEqual(['subtipo']);
    });

    it('acepta un subtipo solo: el sector guardado lo valida el backend', () => {
      const result = UpdateClienteSchema.safeParse({ subtipo: 'PROVINCIAL_ORGANISMO' });
      expect(result.success).toBe(true);
    });

    it('rechaza un subtipo que no existe', () => {
      const result = UpdateClienteSchema.safeParse({ sector: 'PUBLICO', subtipo: 'OTRO' });
      expect(camposConError(result)).toEqual(['subtipo']);
    });
  });

  describe('CUIT', () => {
    it('rechaza un CUIT con dígito verificador incorrecto', () => {
      const result = UpdateClienteSchema.safeParse({ cuit: '30-50001274-0' });
      expect(camposConError(result)).toEqual(['cuit']);
    });

    it('normaliza un CUIT válido al formato canónico', () => {
      const result = UpdateClienteSchema.safeParse({ cuit: '30500012745' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.cuit).toBe('30-50001274-5');
    });
  });

  describe('canal de entrega', () => {
    it('rechaza PORTAL_WEB sin portalUrl', () => {
      const result = UpdateClienteSchema.safeParse({ canalEntrega: 'PORTAL_WEB' });
      expect(camposConError(result)).toEqual(['portalUrl']);
    });

    it('rechaza WHATSAPP sin whatsappNumero', () => {
      const result = UpdateClienteSchema.safeParse({ canalEntrega: 'WHATSAPP' });
      expect(camposConError(result)).toEqual(['whatsappNumero']);
    });

    it('acepta PORTAL_WEB con portalUrl válida', () => {
      const result = UpdateClienteSchema.safeParse({
        canalEntrega: 'PORTAL_WEB',
        portalUrl: 'https://portal.ejemplo.gob.ar',
      });
      expect(result.success).toBe(true);
    });

    it('acepta WHATSAPP con número válido y lo normaliza a E.164', () => {
      const result = UpdateClienteSchema.safeParse({
        canalEntrega: 'WHATSAPP',
        whatsappNumero: '+54 9 (351) 123-4567',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.whatsappNumero).toBe('+5493511234567');
    });

    it('acepta cambiar solo la portalUrl, sin tocar el canal', () => {
      const result = UpdateClienteSchema.safeParse({ portalUrl: 'https://nuevo.ejemplo.gob.ar' });
      expect(result.success).toBe(true);
    });

    it('rechaza una portalUrl mal formada', () => {
      const result = UpdateClienteSchema.safeParse({ portalUrl: 'portal sin protocolo' });
      expect(camposConError(result)).toEqual(['portalUrl']);
    });
  });
});

// ─── Tests de enums ───────────────────────────────────────────────────────────

describe('IvaCondicion', () => {
  it('acepta todos los valores válidos del enum', () => {
    const valores = [
      'RESPONSABLE_INSCRIPTO',
      'MONOTRIBUTO',
      'EXENTO',
      'CONSUMIDOR_FINAL',
      'NO_CATEGORIZADO',
    ];
    valores.forEach((v) => {
      expect(IvaCondicion.safeParse(v).success).toBe(true);
    });
  });

  it('rechaza un valor fuera del enum', () => {
    expect(IvaCondicion.safeParse('OTRO').success).toBe(false);
  });
});

describe('ClienteSubtipoPublico', () => {
  it('acepta todos los subtipos válidos', () => {
    const valores = ['MUNICIPAL', 'PROVINCIAL_ORGANISMO', 'SINDICAL_OBRA_SOCIAL'];
    valores.forEach((v) => {
      expect(ClienteSubtipoPublico.safeParse(v).success).toBe(true);
    });
  });

  it('rechaza un subtipo que no existe en el enum', () => {
    expect(ClienteSubtipoPublico.safeParse('NACIONAL').success).toBe(false);
  });
});

// ─── Canal de entrega (HU1.4) ─────────────────────────────────────────────────────────

describe('Canal de entrega (HU1.4)', () => {
  /** Alta de un privado: sin los campos que fija el servidor. */
  const altaPrivado = {
    razonSocial: clientePrivado.razonSocial,
    denominacion: clientePrivado.denominacion,
    cuit: clientePrivado.cuit,
    ivaCondicion: clientePrivado.ivaCondicion,
    emailContacto: clientePrivado.emailContacto,
    sector: clientePrivado.sector,
  };

  /** Campos (en notación de puntos) que Zod marcó con error. */
  const camposConError = (resultado: { error?: ZodError }) =>
    resultado.error?.issues.map((issue) => issue.path.join('.')) ?? [];

  it('usa CORREO por defecto', () => {
    const resultado = CreateClienteSchema.safeParse(altaPrivado);
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.canalEntrega).toBe('CORREO');
  });

  it('acepta CORREO con email de contacto', () => {
    expect(CreateClienteSchema.safeParse({ ...altaPrivado, canalEntrega: 'CORREO' }).success).toBe(
      true,
    );
  });

  it('rechaza PORTAL_WEB sin URL y marca portalUrl', () => {
    const resultado = CreateClienteSchema.safeParse({ ...altaPrivado, canalEntrega: 'PORTAL_WEB' });
    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toEqual(['portalUrl']);
  });

  it('rechaza PORTAL_WEB con URL mal formada', () => {
    const resultado = CreateClienteSchema.safeParse({
      ...altaPrivado,
      canalEntrega: 'PORTAL_WEB',
      portalUrl: 'portal sin protocolo',
    });
    expect(camposConError(resultado)).toEqual(['portalUrl']);
  });

  it('acepta PORTAL_WEB con URL válida', () => {
    const resultado = CreateClienteSchema.safeParse({
      ...altaPrivado,
      canalEntrega: 'PORTAL_WEB',
      portalUrl: 'https://portal.ejemplo.gob.ar',
    });
    expect(resultado.success).toBe(true);
  });

  it('rechaza WHATSAPP sin número y marca whatsappNumero', () => {
    const resultado = CreateClienteSchema.safeParse({ ...altaPrivado, canalEntrega: 'WHATSAPP' });
    expect(resultado.success).toBe(false);
    expect(camposConError(resultado)).toEqual(['whatsappNumero']);
  });

  it('rechaza WHATSAPP con un número demasiado corto', () => {
    const resultado = CreateClienteSchema.safeParse({
      ...altaPrivado,
      canalEntrega: 'WHATSAPP',
      whatsappNumero: '351 1234',
    });
    expect(camposConError(resultado)).toEqual(['whatsappNumero']);
  });

  it('acepta WHATSAPP y normaliza el número a E.164', () => {
    const resultado = CreateClienteSchema.safeParse({
      ...altaPrivado,
      canalEntrega: 'WHATSAPP',
      whatsappNumero: '+54 9 (351) 123-4567',
    });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.whatsappNumero).toBe('+5493511234567');
  });

  it('rechaza un canal que no existe', () => {
    const resultado = CreateClienteSchema.safeParse({ ...altaPrivado, canalEntrega: 'FAX' });
    expect(camposConError(resultado)).toEqual(['canalEntrega']);
  });

  it('en la edición, no exige nada si el canal no cambia', () => {
    expect(
      UpdateClienteSchema.safeParse({ sector: 'PRIVADO', razonSocial: 'Otra S.A.' }).success,
    ).toBe(true);
  });

  it('en la edición, pasar a PORTAL_WEB exige la URL en el mismo pedido', () => {
    const resultado = UpdateClienteSchema.safeParse({
      sector: 'PRIVADO',
      canalEntrega: 'PORTAL_WEB',
    });
    expect(camposConError(resultado)).toEqual(['portalUrl']);
  });

  it('el cliente leído de la API también respeta la regla', () => {
    const resultado = ClienteSchema.safeParse({ ...clientePrivado, canalEntrega: 'WHATSAPP' });
    expect(camposConError(resultado)).toEqual(['whatsappNumero']);
  });
});

// ─── Periodicidad de rendición (HU1.5) ────────────────────────────────────────────────

describe('Periodicidad de rendición (HU1.5)', () => {
  const mensual = { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null } as const;
  const bimestral = { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 } as const;
  const porCampania = { tipo: 'POR_CAMPANIA', diaLimite: 5, mesInicioCiclo: null } as const;

  /** Campos (en notación de puntos) que Zod marcó con error. */
  const camposConError = (resultado: { error?: ZodError }) =>
    resultado.error?.issues.map((issue) => issue.path.join('.')) ?? [];

  describe('PeriodicidadTipo', () => {
    it('tiene exactamente MENSUAL, BIMESTRAL y POR_CAMPANIA', () => {
      expect(PeriodicidadTipo.options).toEqual(['MENSUAL', 'BIMESTRAL', 'POR_CAMPANIA']);
    });

    it('rechaza un tipo que no existe', () => {
      expect(PeriodicidadTipo.safeParse('TRIMESTRAL').success).toBe(false);
    });
  });

  describe('PeriodicidadSchema — tipo', () => {
    it.each([mensual, bimestral, porCampania])('acepta $tipo con datos válidos', (payload) => {
      const resultado = PeriodicidadSchema.safeParse(payload);
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data).toEqual(payload);
    });

    it('rechaza un tipo que no existe y marca tipo', () => {
      const resultado = PeriodicidadSchema.safeParse({ ...mensual, tipo: 'TRIMESTRAL' });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['tipo']);
    });

    it('rechaza un objeto sin tipo y marca tipo', () => {
      const resultado = PeriodicidadSchema.safeParse({ diaLimite: 10, mesInicioCiclo: null });
      expect(camposConError(resultado)).toEqual(['tipo']);
    });

    it.each([null, undefined, 'MENSUAL', 10, []])('rechaza %j como periodicidad', (valor) => {
      expect(PeriodicidadSchema.safeParse(valor).success).toBe(false);
    });

    it('descarta claves desconocidas', () => {
      const resultado = PeriodicidadSchema.safeParse({ ...mensual, extra: 'x' });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data).toEqual(mensual);
    });
  });

  describe('PeriodicidadSchema — diaLimite', () => {
    it.each([1, 28])('acepta MENSUAL con diaLimite %d', (diaLimite) => {
      expect(PeriodicidadSchema.safeParse({ ...mensual, diaLimite }).success).toBe(true);
    });

    it.each([1, 28])('acepta BIMESTRAL y POR_CAMPANIA con diaLimite %d', (diaLimite) => {
      expect(PeriodicidadSchema.safeParse({ ...bimestral, diaLimite }).success).toBe(true);
      expect(PeriodicidadSchema.safeParse({ ...porCampania, diaLimite }).success).toBe(true);
    });

    it.each([0, 29, -1, 100])('rechaza diaLimite %d y marca diaLimite', (diaLimite) => {
      const resultado = PeriodicidadSchema.safeParse({ ...mensual, diaLimite });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['diaLimite']);
    });

    // 28.5 incumple a la vez "entero" y "máximo": Zod informa dos issues sobre el mismo campo.
    it.each([1.5, 10.1, 28.5])('rechaza el decimal %d y marca diaLimite', (diaLimite) => {
      const resultado = PeriodicidadSchema.safeParse({ ...mensual, diaLimite });
      expect(resultado.success).toBe(false);
      expect([...new Set(camposConError(resultado))]).toEqual(['diaLimite']);
    });

    it.each(['10', 'diez', '', null, true, {}, [], Number.NaN])(
      'rechaza el valor no numérico %j y marca diaLimite',
      (diaLimite) => {
        const resultado = PeriodicidadSchema.safeParse({ ...mensual, diaLimite });
        expect(resultado.success).toBe(false);
        expect(camposConError(resultado)).toEqual(['diaLimite']);
      },
    );

    it.each([mensual, bimestral, porCampania])('exige diaLimite en $tipo', (payload) => {
      const { diaLimite: _omitido, ...sinDia } = payload;
      const resultado = PeriodicidadSchema.safeParse(sinDia);
      expect(camposConError(resultado)).toEqual(['diaLimite']);
    });

    it('no coacciona un string numérico a número', () => {
      expect(PeriodicidadSchema.safeParse({ ...mensual, diaLimite: '10' }).success).toBe(false);
    });
  });

  describe('PeriodicidadSchema — BIMESTRAL y mesInicioCiclo', () => {
    it.each([1, 12])('acepta mesInicioCiclo %d', (mesInicioCiclo) => {
      expect(PeriodicidadSchema.safeParse({ ...bimestral, mesInicioCiclo }).success).toBe(true);
    });

    it('rechaza BIMESTRAL sin mesInicioCiclo y marca mesInicioCiclo', () => {
      const { mesInicioCiclo: _omitido, ...sinMes } = bimestral;
      const resultado = PeriodicidadSchema.safeParse(sinMes);
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });

    it('rechaza BIMESTRAL con mesInicioCiclo null', () => {
      const resultado = PeriodicidadSchema.safeParse({ ...bimestral, mesInicioCiclo: null });
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });

    it.each([0, 13, -1])('rechaza mesInicioCiclo %d', (mesInicioCiclo) => {
      const resultado = PeriodicidadSchema.safeParse({ ...bimestral, mesInicioCiclo });
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });

    it.each([1.5, 6.9])('rechaza el decimal %d', (mesInicioCiclo) => {
      const resultado = PeriodicidadSchema.safeParse({ ...bimestral, mesInicioCiclo });
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });

    it.each(['3', 'marzo', true, {}, Number.NaN])(
      'rechaza el valor no numérico %j',
      (mesInicioCiclo) => {
        const resultado = PeriodicidadSchema.safeParse({ ...bimestral, mesInicioCiclo });
        expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
      },
    );
  });

  describe('PeriodicidadSchema — MENSUAL y POR_CAMPANIA exigen mesInicioCiclo null', () => {
    it.each([mensual, porCampania])('acepta $tipo con mesInicioCiclo null', (payload) => {
      const resultado = PeriodicidadSchema.safeParse(payload);
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.mesInicioCiclo).toBeNull();
    });

    it.each([mensual, porCampania])('rechaza $tipo con un mes de inicio numérico', (payload) => {
      const resultado = PeriodicidadSchema.safeParse({ ...payload, mesInicioCiclo: 3 });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });

    it.each([mensual, porCampania])('rechaza $tipo con mesInicioCiclo ausente', (payload) => {
      const { mesInicioCiclo: _omitido, ...sinMes } = payload;
      const resultado = PeriodicidadSchema.safeParse(sinMes);
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });

    it.each([0, '', '3'])('rechaza %j como mesInicioCiclo en MENSUAL', (mesInicioCiclo) => {
      const resultado = PeriodicidadSchema.safeParse({ ...mensual, mesInicioCiclo });
      expect(camposConError(resultado)).toEqual(['mesInicioCiclo']);
    });
  });

  it('Periodicidad es una unión: mesInicioCiclo es number solo en BIMESTRAL (typecheck)', () => {
    expectTypeOf<
      Extract<Periodicidad, { tipo: 'BIMESTRAL' }>['mesInicioCiclo']
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<Periodicidad, { tipo: 'MENSUAL' }>['mesInicioCiclo']
    >().toEqualTypeOf<null>();
    expectTypeOf<
      Extract<Periodicidad, { tipo: 'POR_CAMPANIA' }>['mesInicioCiclo']
    >().toEqualTypeOf<null>();
  });

  describe('ClienteSchema (representación pública)', () => {
    it('acepta periodicidad null', () => {
      const resultado = ClienteSchema.safeParse({ ...clientePrivado, periodicidad: null });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.periodicidad).toBeNull();
    });

    it.each([mensual, bimestral, porCampania])('acepta periodicidad $tipo', (periodicidad) => {
      const resultado = ClienteSchema.safeParse({ ...clientePublico, periodicidad });
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data.periodicidad).toEqual(periodicidad);
    });

    it('rechaza un cliente sin la clave periodicidad: no se completa con null', () => {
      const { periodicidad: _omitida, ...sinPeriodicidad } = clientePrivado;
      const resultado = ClienteSchema.safeParse(sinPeriodicidad);
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['periodicidad']);
    });

    it('rechaza periodicidad undefined explícito', () => {
      const resultado = ClienteSchema.safeParse({ ...clientePublico, periodicidad: undefined });
      expect(camposConError(resultado)).toEqual(['periodicidad']);
    });

    it('Cliente tiene periodicidad obligatoria: Periodicidad | null (typecheck)', () => {
      expectTypeOf<Cliente['periodicidad']>().toEqualTypeOf<Periodicidad | null>();
    });

    it('rechaza una periodicidad inválida y marca la ruta anidada', () => {
      const resultado = ClienteSchema.safeParse({
        ...clientePrivado,
        periodicidad: { ...mensual, diaLimite: 29 },
      });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['periodicidad.diaLimite']);
    });
  });

  describe('CreateClienteSchema', () => {
    it('acepta un alta sin periodicidad y no agrega la clave', () => {
      const resultado = CreateClienteSchema.safeParse(altaPrivada);
      expect(resultado.success).toBe(true);
      if (resultado.success) expect(resultado.data).not.toHaveProperty('periodicidad');
    });

    it.each([
      ['público', altaPublica],
      ['privado', altaPrivada],
    ])('acepta un alta %s con periodicidad válida y la conserva', (_sector, alta) => {
      for (const periodicidad of [mensual, bimestral, porCampania]) {
        const resultado = CreateClienteSchema.safeParse({ ...alta, periodicidad });
        expect(resultado.success).toBe(true);
        if (resultado.success) expect(resultado.data.periodicidad).toEqual(periodicidad);
      }
    });

    it('rechaza una periodicidad con diaLimite fuera de rango y marca periodicidad.diaLimite', () => {
      const resultado = CreateClienteSchema.safeParse({
        ...altaPrivada,
        periodicidad: { ...mensual, diaLimite: 0 },
      });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['periodicidad.diaLimite']);
    });

    it('rechaza una periodicidad bimestral sin mes y marca periodicidad.mesInicioCiclo', () => {
      const resultado = CreateClienteSchema.safeParse({
        ...altaPublica,
        periodicidad: { tipo: 'BIMESTRAL', diaLimite: 10, mesInicioCiclo: null },
      });
      expect(camposConError(resultado)).toEqual(['periodicidad.mesInicioCiclo']);
    });

    it('rechaza una periodicidad con tipo inexistente', () => {
      const resultado = CreateClienteSchema.safeParse({
        ...altaPrivada,
        periodicidad: { ...mensual, tipo: 'ANUAL' },
      });
      expect(camposConError(resultado)).toEqual(['periodicidad.tipo']);
    });

    it('rechaza periodicidad null: en el alta no hay nada que borrar', () => {
      const resultado = CreateClienteSchema.safeParse({ ...altaPrivada, periodicidad: null });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['periodicidad']);
    });

    it('no altera el resto de las reglas del alta (canal de entrega sigue validándose)', () => {
      const resultado = CreateClienteSchema.safeParse({
        ...altaPrivada,
        canalEntrega: 'PORTAL_WEB',
        periodicidad: mensual,
      });
      expect(camposConError(resultado)).toEqual(['portalUrl']);
    });

    it('CreateClienteDto tiene periodicidad opcional y sin null (typecheck)', () => {
      expectTypeOf<CreateClienteDto['periodicidad']>().toEqualTypeOf<Periodicidad | undefined>();
    });
  });

  describe('UpdateClienteSchema', () => {
    it.each([mensual, bimestral, porCampania])(
      'acepta periodicidad $tipo como único cambio',
      (periodicidad) => {
        const resultado = UpdateClienteSchema.safeParse({ periodicidad });
        expect(resultado.success).toBe(true);
        if (resultado.success) expect(resultado.data).toEqual({ periodicidad });
      },
    );

    it('acepta periodicidad: null como único cambio y lo conserva', () => {
      const resultado = UpdateClienteSchema.safeParse({ periodicidad: null });
      expect(resultado.success).toBe(true);
      if (resultado.success) {
        expect(resultado.data).toHaveProperty('periodicidad', null);
        expect(resultado.data).toEqual({ periodicidad: null });
      }
    });

    it('sin periodicidad no agrega ninguna: ausente significa no modificar', () => {
      const resultado = UpdateClienteSchema.safeParse({ razonSocial: 'Otra S.A.' });
      expect(resultado.success).toBe(true);
      if (resultado.success) {
        expect(resultado.data).not.toHaveProperty('periodicidad');
        expect(resultado.data.periodicidad).toBeUndefined();
      }
    });

    it('periodicidad undefined explícito cuenta como ausente (no alcanza como único campo)', () => {
      expect(UpdateClienteSchema.safeParse({ periodicidad: undefined }).success).toBe(false);
    });

    it('acepta periodicidad junto con otros campos', () => {
      const resultado = UpdateClienteSchema.safeParse({
        denominacion: 'Nuevo Alias',
        periodicidad: bimestral,
      });
      expect(resultado.success).toBe(true);
      if (resultado.success) {
        expect(resultado.data).toEqual({ denominacion: 'Nuevo Alias', periodicidad: bimestral });
      }
    });

    it('sigue rechazando un pedido vacío', () => {
      expect(UpdateClienteSchema.safeParse({}).success).toBe(false);
    });

    it('rechaza una periodicidad inválida y marca la ruta anidada', () => {
      const resultado = UpdateClienteSchema.safeParse({
        periodicidad: { tipo: 'BIMESTRAL', diaLimite: 10, mesInicioCiclo: 13 },
      });
      expect(resultado.success).toBe(false);
      expect(camposConError(resultado)).toEqual(['periodicidad.mesInicioCiclo']);
    });

    it('rechaza una periodicidad vacía {}', () => {
      expect(UpdateClienteSchema.safeParse({ periodicidad: {} }).success).toBe(false);
    });

    it('rechaza una periodicidad que no es objeto ni null', () => {
      expect(UpdateClienteSchema.safeParse({ periodicidad: 'MENSUAL' }).success).toBe(false);
    });

    it('no altera las reglas de sector/subtipo ni de canal al enviar periodicidad', () => {
      expect(
        camposConError(UpdateClienteSchema.safeParse({ sector: 'PUBLICO', periodicidad: mensual })),
      ).toEqual(['subtipo']);
      expect(
        camposConError(
          UpdateClienteSchema.safeParse({ canalEntrega: 'WHATSAPP', periodicidad: mensual }),
        ),
      ).toEqual(['whatsappNumero']);
    });

    it('UpdateClienteDto admite periodicidad objeto, null o ausente (typecheck)', () => {
      expectTypeOf<UpdateClienteDto['periodicidad']>().toEqualTypeOf<
        Periodicidad | null | undefined
      >();
    });
  });
});

// ─── Cuerpo de PATCH /clientes/:id/estado (HU1.8) ─────────────────────────────

describe('ActualizarEstadoClienteSchema', () => {
  it.each(['ACTIVO', 'INACTIVO'] as const)('acepta el estado %s', (estado) => {
    const resultado = ActualizarEstadoClienteSchema.safeParse({ estado });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data).toEqual({ estado });
  });

  it('rechaza SUSPENDIDO: es un estado reservado que no se asigna por la API', () => {
    const resultado = ActualizarEstadoClienteSchema.safeParse({ estado: 'SUSPENDIDO' });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['estado']);
  });

  it.each([['BORRADO'], ['activo'], [''], [1], [null]])('rechaza el valor %j', (estado) => {
    const resultado = ActualizarEstadoClienteSchema.safeParse({ estado });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['estado']);
  });

  it('rechaza un cuerpo sin estado', () => {
    const resultado = ActualizarEstadoClienteSchema.safeParse({});
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['estado']);
  });

  it('ignora cualquier otro campo del cuerpo', () => {
    const resultado = ActualizarEstadoClienteSchema.safeParse({
      estado: 'INACTIVO',
      razonSocial: 'Otra S.A.',
    });
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data).toEqual({ estado: 'INACTIVO' });
  });
});
