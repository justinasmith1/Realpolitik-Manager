// El rol es un enum de PostgreSQL (Prisma) y un enum de Zod (shared): tienen que ser el mismo
// conjunto, con los tres roles aprobados (ADR-0006) y ninguno más.

import { $Enums } from '@prisma/client';
import { RolUsuario } from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

describe('RolUsuario', () => {
  it('son exactamente los tres roles aprobados', () => {
    expect(RolUsuario.options).toEqual(['ADMINISTRADOR', 'ADMINISTRATIVO', 'CONSULTA']);
  });

  it('Prisma y shared tienen los mismos valores', () => {
    expect(Object.values($Enums.RolUsuario).sort()).toEqual([...RolUsuario.options].sort());
  });

  it('shared rechaza un rol que no existe', () => {
    expect(RolUsuario.safeParse('SUPERUSUARIO').success).toBe(false);
    expect(RolUsuario.safeParse('administrador').success).toBe(false);
  });
});
