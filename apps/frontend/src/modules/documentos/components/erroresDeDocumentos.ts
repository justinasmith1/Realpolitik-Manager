import type {
  FalloDeAplicacion,
  FalloDeCarga,
  FalloDeReemplazo,
  MotivoDeRechazoDeAplicacion,
} from '@/modules/documentos/api/documentos.api';

// Textos de interfaz de los fallos de documentos. Los fallos los clasifica la capa de API.

export function mensajeFalloCarga(fallo: FalloDeCarga): string {
  switch (fallo.tipo) {
    case 'archivo':
      return (
        fallo.mensaje ??
        'El archivo no se pudo aceptar. Revisá que sea uno de los formatos admitidos.'
      );
    case 'demasiado-grande':
      return 'El archivo supera los 10 MB. Elegí uno más liviano.';
    case 'tipo-inexistente':
      return 'Ese tipo de documento ya no existe. Elegí otro.';
    case 'tipo-inactivo':
      return 'Ese tipo de documento está desactivado y no tiene ítems pendientes en el período.';
    case 'almacenamiento':
      return 'El almacenamiento de documentos no respondió. No se guardó nada: probá de nuevo en unos minutos.';
    case 'conexion':
      return 'No pudimos conectarnos con el servidor. No se guardó nada: revisá tu conexión y probá de nuevo.';
    case 'inesperado':
      return 'No se pudo cargar el documento. Probá de nuevo.';
  }
}

const porMotivo: Record<MotivoDeRechazoDeAplicacion, (item: string) => string> = {
  ITEM_NO_PENDIENTE: (item) => `${item} ya tiene un documento: lo aplicaron mientras tanto.`,
  RENDICION_ANULADA: (item) => `La rendición de ${item} se anuló.`,
  TIPO_DOCUMENTO_DISTINTO: (item) => `${item} pide otro tipo de documento.`,
  PERIODO_DISTINTO: (item) => `${item} es de otro período.`,
};

/**
 * El fallo de una aplicación. `describirItem` arma cómo se nombra el ítem que falló (cliente,
 * factura e ítem), si la API informó cuál fue.
 */
export function mensajeFalloAplicacion(
  fallo: FalloDeAplicacion,
  describirItem: (itemId: string) => string | null,
): string {
  switch (fallo.tipo) {
    case 'rechazado': {
      const item = fallo.itemId === null ? null : describirItem(fallo.itemId);
      return item === null
        ? 'Un ítem elegido dejó de estar disponible. No se aplicó a ninguno.'
        : `${porMotivo[fallo.motivo](item)} No se aplicó a ninguno.`;
    }
    case 'no-existe':
      return 'El documento o algún ítem elegido ya no existe. No se aplicó a ninguno.';
    case 'conexion':
      return 'No pudimos conectarnos con el servidor. No se aplicó a ninguno: probá de nuevo.';
    case 'inesperado':
      return 'No se pudo aplicar el documento. No se aplicó a ninguno: probá de nuevo.';
  }
}

export const mensajeFalloDescarga = (nombreOriginal: string): string =>
  `No se pudo descargar ${nombreOriginal}. Probá de nuevo.`;

// Desde el detalle de una rendición se trabaja con un solo ítem: los textos hablan de "este ítem".
const rechazoDeUnItem: Record<MotivoDeRechazoDeAplicacion, string> = {
  ITEM_NO_PENDIENTE:
    'Este ítem ya tiene un documento: lo asociaron mientras tanto. Actualizamos el checklist.',
  RENDICION_ANULADA: 'La rendición se anuló: ya no se puede modificar.',
  TIPO_DOCUMENTO_DISTINTO: 'Ese documento ya no corresponde a este ítem. Elegí otro.',
  PERIODO_DISTINTO: 'Ese documento ya no corresponde a este ítem. Elegí otro.',
};

/** El fallo de asociar un documento a un ítem desde el detalle de su rendición. */
export function mensajeFalloAsociacion(fallo: FalloDeAplicacion): string {
  switch (fallo.tipo) {
    case 'rechazado':
      return rechazoDeUnItem[fallo.motivo];
    case 'no-existe':
      return 'El documento o el ítem ya no existe. Actualizamos la información.';
    case 'conexion':
      return 'No pudimos conectarnos con el servidor. No se asoció: probá de nuevo.';
    case 'inesperado':
      return 'No se pudo asociar el documento. Probá de nuevo.';
  }
}

/** El fallo de reemplazar el documento de un ítem. */
export function mensajeFalloReemplazo(fallo: FalloDeReemplazo): string {
  switch (fallo.tipo) {
    case 'desactualizada':
      return 'El documento de este ítem cambió mientras tanto. Actualizamos la información: revisá cuál es el actual y volvé a elegir.';
    case 'ya-vigente':
      return 'Ese documento ya es el actual del ítem. Elegí otro.';
    case 'rechazado':
      return rechazoDeUnItem[fallo.motivo];
    case 'no-existe':
      return 'El documento o el ítem ya no existe. Actualizamos la información.';
    case 'conexion':
      return 'No pudimos conectarnos con el servidor. No se reemplazó: probá de nuevo.';
    case 'inesperado':
      return 'No se pudo reemplazar el documento. Probá de nuevo.';
  }
}
