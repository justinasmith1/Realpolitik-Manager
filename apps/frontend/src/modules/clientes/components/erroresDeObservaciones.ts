// Traduce un fallo al guardar las observaciones (ya interpretado por `observaciones-cliente.api`)
// a texto de la interfaz. Nunca muestra detalles técnicos.

import { mensajeDelServidor } from '@/lib/errores-api';
import type { FalloObservaciones } from '@/modules/clientes/api/observaciones-cliente.api';

const MENSAJE_REVISAR_TEXTO = 'Revisá el texto de las observaciones.';
const MENSAJE_CLIENTE_AUSENTE = 'El cliente ya no existe.';

const MOTIVO_INESPERADO = 'Probá de nuevo en unos segundos.';

/**
 * Por qué no se guardaron las observaciones, en una frase que se puede sumar a otro mensaje
 * (el aviso de qué se guardó y qué no, cuando se envían varias cosas juntas).
 */
export function motivoFalloObservaciones(fallo: FalloObservaciones): string {
  switch (fallo.tipo) {
    case 'datos-invalidos':
      return (
        fallo.detalles
          .map(({ mensaje }) => mensajeDelServidor(mensaje))
          .find((mensaje) => mensaje !== null) ?? MENSAJE_REVISAR_TEXTO
      );
    case 'no-existe':
      return MENSAJE_CLIENTE_AUSENTE;
    case 'inesperado':
      return MOTIVO_INESPERADO;
  }
}
