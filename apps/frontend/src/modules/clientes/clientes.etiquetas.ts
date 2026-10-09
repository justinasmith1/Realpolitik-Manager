import type {
  CanalEntregaType,
  ClienteEstadoType,
  ClienteSectorType,
  ClienteSubtipoPublicoType,
  IvaCondicionType,
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

/** En minúscula: se usa dentro de oraciones ("…está inactivo"). */
export const etiquetasEstado: Record<ClienteEstadoType, string> = {
  ACTIVO: 'activo',
  INACTIVO: 'inactivo',
  SUSPENDIDO: 'suspendido',
};
