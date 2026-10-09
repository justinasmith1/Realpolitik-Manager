import type {
  CanalEntregaType,
  ClienteEstadoType,
  ClienteSectorType,
  ClienteSubtipoPublicoType,
  IvaCondicionType,
  PeriodicidadTipoType,
} from '@realpolitik/shared';

// Textos visibles de los valores del dominio. `Record` obliga a cubrir cada valor del enum
// compartido: si shared agrega uno, esto deja de compilar hasta que tenga su etiqueta.

export const etiquetasSector: Record<ClienteSectorType, string> = {
  PUBLICO: 'Público',
  PRIVADO: 'Privado',
};

export const etiquetasSubtipo: Record<ClienteSubtipoPublicoType, string> = {
  MUNICIPAL: 'Municipio',
  PROVINCIAL_ORGANISMO: 'Provincial u organismo público',
  SINDICAL_OBRA_SOCIAL: 'Sindicato u obra social',
};

export const etiquetasIvaCondicion: Record<IvaCondicionType, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor final',
  NO_CATEGORIZADO: 'No categorizado',
};

export const etiquetasCanalEntrega: Record<CanalEntregaType, string> = {
  CORREO: 'Correo',
  PORTAL_WEB: 'Portal web',
  WHATSAPP: 'WhatsApp',
};

export const etiquetasPeriodicidad: Record<PeriodicidadTipoType, string> = {
  MENSUAL: 'Mensual',
  BIMESTRAL: 'Bimestral',
  POR_CAMPANIA: 'Por campaña',
};

/** Nombre de cada mes, en orden: el índice 0 es el mes 1 (Enero). */
export const nombresDeMes = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/** Nombre del mes `mes` (1 a 12). Shared ya garantiza el rango del dato que llega. */
export function etiquetaDeMes(mes: number): string {
  return nombresDeMes[mes - 1] ?? String(mes);
}

/** En minúscula: se usa dentro de oraciones ("…está inactivo"). */
export const etiquetasEstado: Record<ClienteEstadoType, string> = {
  ACTIVO: 'activo',
  INACTIVO: 'inactivo',
  SUSPENDIDO: 'suspendido',
};
