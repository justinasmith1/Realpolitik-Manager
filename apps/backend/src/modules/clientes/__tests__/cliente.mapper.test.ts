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
      canalEntrega: 'CORREO',
      periodicidad: null,
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

describe('toClienteDto — periodicidad', () => {
  it('devuelve periodicidad null, con la clave presente, si las tres columnas son null', () => {
    const dto = toClienteDto(filaPublica);

    expect(dto).toHaveProperty('periodicidad', null);
  });

  it.each([
    [
      'MENSUAL',
      { periodicidadTipo: 'MENSUAL', periodicidadDiaLimite: 10, periodicidadMesInicioCiclo: null },
      { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
    ],
    [
      'BIMESTRAL',
      { periodicidadTipo: 'BIMESTRAL', periodicidadDiaLimite: 15, periodicidadMesInicioCiclo: 3 },
      { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 },
    ],
    [
      'POR_CAMPANIA',
      {
        periodicidadTipo: 'POR_CAMPANIA',
        periodicidadDiaLimite: 28,
        periodicidadMesInicioCiclo: null,
      },
      { tipo: 'POR_CAMPANIA', diaLimite: 28, mesInicioCiclo: null },
    ],
  ] as const)(
    'reconstruye una periodicidad %s desde las tres columnas',
    (_tipo, columnas, esperada) => {
      const dto = toClienteDto({ ...filaPrivada, ...columnas });

      expect(dto.periodicidad).toEqual(esperada);
    },
  );

  // La base no tiene CHECK para estas reglas: si se rompen, el mapper no las disimula ni
  // las convierte en null (terminaría en un 500 en vez de un dato que contradice el contrato).
  it.each([
    [
      'un tipo sin día límite',
      {
        periodicidadTipo: 'MENSUAL',
        periodicidadDiaLimite: null,
        periodicidadMesInicioCiclo: null,
      },
    ],
    [
      'un bimestral sin mes de inicio',
      {
        periodicidadTipo: 'BIMESTRAL',
        periodicidadDiaLimite: 10,
        periodicidadMesInicioCiclo: null,
      },
    ],
    [
      'un mensual con mes de inicio',
      { periodicidadTipo: 'MENSUAL', periodicidadDiaLimite: 10, periodicidadMesInicioCiclo: 3 },
    ],
    [
      'un día límite fuera de rango',
      {
        periodicidadTipo: 'POR_CAMPANIA',
        periodicidadDiaLimite: 31,
        periodicidadMesInicioCiclo: null,
      },
    ],
    [
      'día límite sin tipo',
      { periodicidadTipo: null, periodicidadDiaLimite: 10, periodicidadMesInicioCiclo: null },
    ],
    [
      'mes de inicio sin tipo',
      { periodicidadTipo: null, periodicidadDiaLimite: null, periodicidadMesInicioCiclo: 3 },
    ],
  ] as const)('rechaza %s', (_caso, columnas) => {
    expect(() => toClienteDto({ ...filaPrivada, ...columnas })).toThrow(/periodicidad/);
  });
});
