// Traduce un fallo al guardar las indicaciones de armado (ya interpretado por
// `indicaciones-armado.api`) a texto de la interfaz. Nunca muestra detalles técnicos.

import { mensajeDelServidor } from '@/lib/errores-api';
import type { FalloIndicaciones } from '@/modules/clientes/api/indicaciones-armado.api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';

/** Por qué no se guardaron las indicaciones, en una frase que se puede sumar a otro mensaje. */
export function motivoFalloIndicaciones(fallo: FalloIndicaciones): string {
  switch (fallo.tipo) {
    case 'datos-invalidos': {
      const delServidor = fallo.detalles
        .map(({ mensaje }) => mensajeDelServidor(mensaje))
        .find((mensaje) => mensaje !== null);
      return delServidor ?? 'Revisá el texto de las indicaciones.';
    }
    case 'cliente-no-activo':
      return fallo.estado === null
        ? 'El cliente no está activo: reactivalo para editar sus indicaciones.'
        : `El cliente está ${etiquetasEstado[fallo.estado]}: reactivalo para editar sus indicaciones.`;
    case 'no-existe':
      return 'El cliente ya no existe.';
    case 'inesperado':
      return 'Probá de nuevo en unos segundos.';
  }
}
