import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RolUsuario } from '@realpolitik/shared';

import { PERMISOS, PERMISOS_POR_ROL, rolHabilitado, tienePermiso } from '@/modules/auth/permisos';

// La matriz es la fuente de verdad (la misma que compara el backend): si cambia el catálogo, este
// test obliga a cambiar el espejo del frontend en el mismo PR.
// Vitest corre con `apps/frontend` como directorio de trabajo.
const MATRIZ = resolve(process.cwd(), '../../docs/security/matriz-permisos.md');

function catalogoDeLaMatriz() {
  const filas: { permiso: string; porRol: Record<string, boolean> }[] = [];
  for (const linea of readFileSync(MATRIZ, 'utf8').split(/\r?\n/)) {
    const celdas = linea.split('|').map((celda) => celda.trim());
    // | `permiso` | Tipo | Cubre | CONSULTA | ADMINISTRATIVO | ADMINISTRADOR |
    const permiso = /^`([a-z-]+:[a-z]+)`$/.exec(celdas[1] ?? '')?.[1];
    if (permiso !== undefined && celdas.length === 8) {
      filas.push({
        permiso,
        porRol: {
          CONSULTA: celdas[4] === 'Sí',
          ADMINISTRATIVO: celdas[5] === 'Sí',
          ADMINISTRADOR: celdas[6] === 'Sí',
        },
      });
    }
  }
  return filas;
}

describe('permisos por rol (espejo de la matriz)', () => {
  const catalogo = catalogoDeLaMatriz();

  it('tiene exactamente los permisos del catálogo de la matriz', () => {
    expect(catalogo).toHaveLength(12);
    expect([...PERMISOS].sort()).toEqual(catalogo.map((fila) => fila.permiso).sort());
  });

  it('cada rol tiene lo que dice la matriz, ni más ni menos', () => {
    for (const { permiso, porRol } of catalogo) {
      for (const rol of RolUsuario.options) {
        expect({ rol, permiso, tiene: tienePermiso(rol, permiso as never) }).toEqual({
          rol,
          permiso,
          tiene: porRol[rol],
        });
      }
    }
  });

  it('cubre todos los roles y deniega por defecto', () => {
    expect(Object.keys(PERMISOS_POR_ROL).sort()).toEqual([...RolUsuario.options].sort());
    expect(tienePermiso('INVENTADO' as never, 'clientes:ver')).toBe(false);
  });

  it('HU4.1: CONSULTA no entra al sistema; los otros roles sí; uno desconocido, tampoco', () => {
    expect(rolHabilitado('CONSULTA')).toBe(false);
    expect(rolHabilitado('ADMINISTRATIVO')).toBe(true);
    expect(rolHabilitado('ADMINISTRADOR')).toBe(true);
    expect(rolHabilitado('INVENTADO' as never)).toBe(false);
  });
});
