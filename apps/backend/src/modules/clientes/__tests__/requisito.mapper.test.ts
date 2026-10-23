import { describe, expect, it } from 'vitest';

import { toRequisitoClienteDto, type RequisitoClienteConTipo } from '../requisito.mapper';

const creado = new Date('2026-10-20T12:00:00.000Z');
const actualizado = new Date('2026-10-20T13:00:00.000Z');

const fila: RequisitoClienteConTipo = {
  id: 'd1e2f3a4-b5c6-4789-8abc-def012345678',
  clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
  tipoDocumentoId: 'c1d2e3f4-a5b6-4789-8abc-def012345678',
  cantidad: 3,
  diasAproximados: [20, 1, 15],
  canalEntrega: null,
  nota: 'Prints de la pauta de radio',
  isDeleted: false,
  deletedAt: null,
  createdAt: creado,
  updatedAt: actualizado,
  tipoDocumento: {
    id: 'c1d2e3f4-a5b6-4789-8abc-def012345678',
    nombre: 'Print',
    nombreNormalizado: 'print',
    descripcion: 'No sale en el requisito',
    activo: true,
    createdAt: creado,
    updatedAt: actualizado,
  },
};

describe('toRequisitoClienteDto', () => {
  it('arma el requisito del contrato, con el tipo anidado y las fechas renombradas', () => {
    expect(toRequisitoClienteDto(fila)).toEqual({
      id: fila.id,
      clienteId: fila.clienteId,
      tipoDocumento: { id: fila.tipoDocumento.id, nombre: 'Print', activo: true },
      cantidad: 3,
      diasAproximados: [20, 1, 15],
      canalEntrega: null,
      nota: 'Prints de la pauta de radio',
      creadoEn: creado,
      actualizadoEn: actualizado,
    });
  });

  it('no reordena los días: la lectura no aplica la regla de escritura', () => {
    expect(toRequisitoClienteDto(fila).diasAproximados).toEqual([20, 1, 15]);
  });

  it('conserva un tipo que ya está desactivado', () => {
    const dto = toRequisitoClienteDto({
      ...fila,
      tipoDocumento: { ...fila.tipoDocumento, activo: false },
    });

    expect(dto.tipoDocumento).toEqual({
      id: fila.tipoDocumento.id,
      nombre: 'Print',
      activo: false,
    });
  });

  it('no expone la baja lógica, la clave del tipo ni los nombres de columna de Prisma', () => {
    const dto = toRequisitoClienteDto({
      ...fila,
      isDeleted: true,
      deletedAt: new Date('2026-10-21T00:00:00.000Z'),
    });

    for (const campo of ['isDeleted', 'deletedAt', 'createdAt', 'updatedAt', 'tipoDocumentoId']) {
      expect(dto).not.toHaveProperty(campo);
    }
    expect(dto.tipoDocumento).not.toHaveProperty('nombreNormalizado');
    expect(dto.tipoDocumento).not.toHaveProperty('descripcion');
  });
});
