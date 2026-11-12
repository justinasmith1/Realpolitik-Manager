// Rol → permisos, del lado de la interfaz. Es un ESPEJO del catálogo de la matriz
// (docs/security/matriz-permisos.md), que es la fuente de verdad junto con el backend: un test
// compara este archivo con la matriz. Sirve solo para decidir qué se muestra; quien autoriza es
// siempre la API. La respuesta de sesión no trae `permisos`: se derivan del rol.

import type { RolUsuarioType } from '@realpolitik/shared';

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

const DE_CONSULTA: readonly Permiso[] = [
  'cuenta:propia',
  'clientes:ver',
  'requisitos:ver',
  'tipos-documento:ver',
  'rendiciones:ver',
  'documentos:ver',
];

const DE_ADMINISTRATIVO: readonly Permiso[] = [
  ...DE_CONSULTA,
  'clientes:editar',
  'requisitos:editar',
  'tipos-documento:editar',
  'rendiciones:operar',
  'documentos:operar',
];

export const PERMISOS_POR_ROL: Readonly<Record<RolUsuarioType, ReadonlySet<Permiso>>> = {
  CONSULTA: new Set(DE_CONSULTA),
  ADMINISTRATIVO: new Set(DE_ADMINISTRATIVO),
  ADMINISTRADOR: new Set<Permiso>([...DE_ADMINISTRATIVO, 'usuarios:administrar']),
};

/** Denegado por defecto: `false` para lo que no figure, también un rol desconocido. */
export function tienePermiso(rol: RolUsuarioType, permiso: Permiso): boolean {
  return (
    (PERMISOS_POR_ROL as Record<string, ReadonlySet<Permiso> | undefined>)[rol]?.has(permiso) ??
    false
  );
}

/**
 * TEMPORAL (HU4.1): roles con sesión pero sin acceso a las pantallas de negocio. Solo CONSULTA,
 * hasta HU4.3; es el espejo de `ROLES_NO_HABILITADOS_HASTA_HU4_3` del backend. Al habilitarlo se
 * borra esta lista y la pantalla "Rol no habilitado".
 */
const ROLES_NO_HABILITADOS: ReadonlySet<string> = new Set<RolUsuarioType>(['CONSULTA']);

/** Solo los roles conocidos y habilitados entran al shell. */
export function rolHabilitado(rol: RolUsuarioType): boolean {
  return rol in PERMISOS_POR_ROL && !ROLES_NO_HABILITADOS.has(rol);
}

export const ETIQUETA_DE_ROL: Readonly<Record<RolUsuarioType, string>> = {
  ADMINISTRADOR: 'Administrador',
  ADMINISTRATIVO: 'Administrativo',
  CONSULTA: 'Consulta',
};
