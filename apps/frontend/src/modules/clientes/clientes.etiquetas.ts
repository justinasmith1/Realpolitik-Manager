import type {
  CanalEntregaType,
  ClienteEstadoType,
  ClienteSectorType,
  ClienteSubtipoPublicoType,
  EmisorType,
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

// Lo que ve la persona es el nombre de cada emisor. Los códigos (`PERSONA_FISICA`, `SOCIEDAD`)
// son el tipo de emisor y no cambian: este es el único lugar donde viven los nombres.
export const etiquetasEmisor: Record<EmisorType, string> = {
  PERSONA_FISICA: 'Santiago Sautel',
  SOCIEDAD: 'Realpolitik',
};

/** Opción del selector de emisor que deja al cliente sin emisor asignado. */
export const TEXTO_EMISOR_SIN_ASIGNAR = 'Sin asignar';

/** Marcador de un cliente sin emisor: dato pendiente, no un error. */
export const TEXTO_EMISOR_PENDIENTE = 'Pendiente';

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

// Textos del enlace de vuelta de la matriz de un cliente, según desde dónde se abrió.
export const TEXTO_VOLVER_A_CLIENTES = 'Volver a clientes';
export const TEXTO_VOLVER_A_REQUISITOS = 'Volver a requisitos';
