import type { Cliente as ClienteRow } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { toClienteDto } from '../cliente.mapper';

const creado = new Date('2026-10-02T15:30:00.000Z');
const actualizado = new Date('2026-10-03T09:00:00.000Z');

const filaPublica: ClienteRow = {
  id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: ['tesoreria@municipio.example'],
  telefono: '+54 221 400-0000',
  portalUrl: 'https://proveedores.municipio.example',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  estado: 'ACTIVO',
  isDeleted: false,
  deletedAt: null,
  createdAt: creado,
  updatedAt: actualizado,
};

const filaPrivada: ClienteRow = {
  ...filaPublica,
  id: 'b2c3d4e5-f6a7-4890-bcde-f01234567890',
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
  emailsAdicionales: [],
  telefono: null,
  portalUrl: null,
  sector: 'PRIVADO',
  subtipo: null,
};

describe('toClienteDto', () => {
  it('convierte un cliente público con los nombres del contrato', () => {
    expect(toClienteDto(filaPublica)).toEqual({
      id: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
      razonSocial: 'Municipio de Ejemplo',
      denominacion: 'Muni Ejemplo',
      cuit: '30-50001274-5',
      ivaCondicion: 'EXENTO',
      emailContacto: 'compras@municipio.example',
      emailsAdicionales: ['tesoreria@municipio.example'],
      telefono: '+54 221 400-0000',
      portalUrl: 'https://proveedores.municipio.example',
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
      estado: 'ACTIVO',
      creadoEn: creado,
      actualizadoEn: actualizado,
    });
  });

  it('omite en un privado el subtipo y los opcionales que la base guarda como null', () => {
    const dto = toClienteDto(filaPrivada);

    expect(dto).not.toHaveProperty('subtipo');
    expect(dto).not.toHaveProperty('telefono');
    expect(dto).not.toHaveProperty('portalUrl');
    expect(dto).toMatchObject({ sector: 'PRIVADO', emailsAdicionales: [] });
  });

  it('no expone la baja lógica ni los nombres de columna de Prisma', () => {
    const dto = toClienteDto({
      ...filaPublica,
      isDeleted: true,
      deletedAt: new Date('2026-10-05T00:00:00.000Z'),
    });

    for (const campo of ['isDeleted', 'deletedAt', 'createdAt', 'updatedAt']) {
      expect(dto).not.toHaveProperty(campo);
    }
  });

  // La base no tiene un CHECK para esta regla: si se rompe, el mapper no la disimula.
  it.each([
    ['un privado con subtipo', { ...filaPrivada, subtipo: 'MUNICIPAL' as const }],
    ['un público sin subtipo', { ...filaPublica, subtipo: null }],
  ])('rechaza %s', (_caso, fila) => {
    expect(() => toClienteDto(fila)).toThrow(/subtipo/);
  });
});
