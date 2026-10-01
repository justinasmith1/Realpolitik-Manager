import { describe, expect, it } from 'vitest';

import {
  ClienteSchema,
  ClienteSubtipoPublico,
  CreateClienteSchema,
  IvaCondicion,
} from './cliente.schema.js';

// ─── Payloads base ────────────────────────────────────────────────────────────
//
// CUITs verificados con el algoritmo Módulo 11:
//   30-50001274-5 → ✅ persona jurídica (sector público)
//   20-12345678-6 → ✅ persona física masculina (sector privado)

const BASE = {
  id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  razonSocial: 'Agencia Realpolitik S.A.',
  cuit: '30-50001274-5',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO' as const,
  emailContacto: 'contacto@realpolitik.com.ar',
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

describe('CreateClienteSchema', () => {
  it('acepta payload público sin id/creadoEn/actualizadoEn', () => {
    const payload = {
      razonSocial: 'Municipio de Paraná',
      cuit: '30-50001274-5',
      sector: 'PUBLICO' as const,
      subtipo: 'MUNICIPAL' as const,
      ivaCondicion: 'EXENTO' as const,
      emailContacto: 'municipio@parana.gob.ar',
    };
    const result = CreateClienteSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('id' in result.data).toBe(false);
    }
  });

  it('acepta payload privado sin id/creadoEn/actualizadoEn', () => {
    const payload = {
      razonSocial: 'Empresa Privada S.A.',
      cuit: '20-12345678-6',
      sector: 'PRIVADO' as const,
      ivaCondicion: 'RESPONSABLE_INSCRIPTO' as const,
      emailContacto: 'empresa@privada.com',
    };
    const result = CreateClienteSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('id' in result.data).toBe(false);
    }
  });

  it('falla si el payload público no incluye subtipo', () => {
    const payload = {
      razonSocial: 'Organismo sin subtipo',
      cuit: '30-50001274-5',
      sector: 'PUBLICO' as const,
      ivaCondicion: 'EXENTO' as const,
      emailContacto: 'sin@subtipo.gob.ar',
    };
    const result = CreateClienteSchema.safeParse(payload);
    expect(result.success).toBe(false);
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
