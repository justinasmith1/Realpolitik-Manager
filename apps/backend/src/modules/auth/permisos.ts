// Catálogo de permisos y su asignación a roles (docs/security/matriz-permisos.md, ADR-0006 §5).
//
// La matriz es la fuente de verdad: estos 12 permisos y sus roles son los de su "Catálogo de
// permisos". Cambiar algo acá es cambiar la matriz en el mismo PR (y al revés): el test de
// inventario compara cada ruta montada con su fila de la matriz.
//
// Denegado por defecto: un permiso que no figura en el conjunto de un rol está denegado.

import type { RolUsuario } from '@prisma/client';

export const PERMISOS = [
  'cuenta:propia',
  'clientes:ver',
  'requisitos:ver',
  'tipos-documento:ver',
  'rendiciones:ver',
  'documentos:ver',
  'clientes:editar',
  'requisitos:editar',
  'tipos-documento:editar',
  'rendiciones:operar',
  'documentos:operar',
  'usuarios:administrar',
] as const;

export type Permiso = (typeof PERMISOS)[number];

/** Lectura completa, incluidos montos, órdenes de compra y la descarga de documentos. */
const DE_CONSULTA: readonly Permiso[] = [
  'cuenta:propia',
  'clientes:ver',
  'requisitos:ver',
  'tipos-documento:ver',
  'rendiciones:ver',
  'documentos:ver',
];

/** Lo de CONSULTA más todas las operaciones de negocio. Nunca la administración de usuarios. */
const DE_ADMINISTRATIVO: readonly Permiso[] = [
  ...DE_CONSULTA,
  'clientes:editar',
  'requisitos:editar',
  'tipos-documento:editar',
  'rendiciones:operar',
  'documentos:operar',
];

/** Los permisos se componen: CONSULTA ⊂ ADMINISTRATIVO ⊂ ADMINISTRADOR. */
export const PERMISOS_POR_ROL: Readonly<Record<RolUsuario, ReadonlySet<Permiso>>> = Object.freeze({
  CONSULTA: new Set(DE_CONSULTA),
  ADMINISTRATIVO: new Set(DE_ADMINISTRATIVO),
  ADMINISTRADOR: new Set<Permiso>([...DE_ADMINISTRATIVO, 'usuarios:administrar']),
});

/** `false` para cualquier combinación que no figure explícitamente (también un rol desconocido). */
export function tienePermiso(rol: RolUsuario, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol]?.has(permiso) ?? false;
}
