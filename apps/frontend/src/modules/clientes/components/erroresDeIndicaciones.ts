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

/**
 * Lo que va en el formulario cuando fallan las indicaciones: un texto inválido se marca en el
 * campo; el resto va al aviso general. `seGuardoElCliente` = el PATCH del mismo envío salió bien,
 * y hay que decirlo para que no se piense que se perdió todo.
 */
export function erroresDeIndicacionesParaElFormulario(
  fallo: FalloIndicaciones,
  seGuardoElCliente: boolean,
): { indicaciones?: string; general: string } {
  const encabezado = seGuardoElCliente
    ? 'Se guardaron los datos del cliente, pero no las indicaciones de armado.'
    : 'No pudimos guardar las indicaciones de armado.';
  if (fallo.tipo === 'datos-invalidos') {
    return { indicaciones: motivoFalloIndicaciones(fallo), general: encabezado };
  }
  return { general: `${encabezado} ${motivoFalloIndicaciones(fallo)}` };
}
