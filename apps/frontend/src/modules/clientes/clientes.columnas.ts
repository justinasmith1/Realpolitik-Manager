// Columnas de la tabla de Clientes (solo escritorio) que cada uno puede mostrar, ocultar y
// reordenar. "Cliente" (siempre la primera) y "Acciones" (siempre la última) son fijas y por eso
// no están acá: no forman parte de la preferencia.

/** Id de la tabla en las preferencias: la misma para la vista de activos y la de inactivos. */
export const CLIENTES_TABLA_ID = 'clientes';

/** En el orden en que se ofrecen. El label es el encabezado de la columna. */
export const CLIENTES_COLUMNAS_CONFIGURABLES = [
  { id: 'cuit', label: 'CUIT' },
  { id: 'sector', label: 'Sector' },
  { id: 'subtipo', label: 'Subtipo' },
  { id: 'email', label: 'Email de contacto' },
  { id: 'canal', label: 'Canal' },
  { id: 'periodicidad', label: 'Periodicidad' },
] as const satisfies readonly { id: string; label: string }[];

export type ClienteColumnaConfigurableId = (typeof CLIENTES_COLUMNAS_CONFIGURABLES)[number]['id'];

export const CLIENTES_COLUMNAS_CONFIGURABLES_IDS: readonly ClienteColumnaConfigurableId[] =
  CLIENTES_COLUMNAS_CONFIGURABLES.map((columna) => columna.id);

/** Encabezado de cada columna, derivado de la lista de arriba (no es otra fuente). */
export const etiquetasColumnasClientes = Object.fromEntries(
  CLIENTES_COLUMNAS_CONFIGURABLES.map((columna) => [columna.id, columna.label]),
) as Record<ClienteColumnaConfigurableId, string>;

/** La tabla tal como se ve hoy: todas, en este orden. */
export const CLIENTES_COLUMNAS_DEFAULT = [
  'cuit',
  'sector',
  'subtipo',
  'email',
  'canal',
  'periodicidad',
] as const satisfies readonly ClienteColumnaConfigurableId[];
