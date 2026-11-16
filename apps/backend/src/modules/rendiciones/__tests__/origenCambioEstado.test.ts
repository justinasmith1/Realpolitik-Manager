// El origen de un cambio de estado (HU4.6) es un enum de PostgreSQL (Prisma) y un enum de Zod
// (shared): tienen que ser el mismo conjunto, con los dos valores aprobados y ninguno más.

import { $Enums } from '@prisma/client';
import { OrigenCambioEstado } from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

describe('OrigenCambioEstado', () => {
  it('son exactamente MANUAL y AUTOMATICO', () => {
    expect(OrigenCambioEstado.options).toEqual(['MANUAL', 'AUTOMATICO']);
  });

  it('Prisma y shared tienen los mismos valores', () => {
    expect(Object.values($Enums.OrigenCambioEstado).sort()).toEqual(
      [...OrigenCambioEstado.options].sort(),
    );
  });
});
