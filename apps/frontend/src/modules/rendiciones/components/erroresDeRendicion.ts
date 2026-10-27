// Traduce un fallo de rendiciones (ya interpretado por `rendiciones.api`) a texto de la interfaz.
// Nunca muestra detalles técnicos.

import { mensajeDelServidor } from '@/lib/errores-api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import type {
  FalloAgregado,
  FalloAnulacion,
  FalloApertura,
  FalloCorreccionDeCanal,
} from '@/modules/rendiciones/api/rendiciones.api';
import type { CampoAbrirRendicion } from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import { etiquetaDePeriodo } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Lo que se puede hacer a partir del error, además de leerlo. */
export type AccionSugerida =
  { tipo: 'ver-rendicion'; rendicionId: string } | { tipo: 'configurar-matriz' };

export interface ErroresDeApertura {
  campos?: Partial<Record<CampoAbrirRendicion, string>>;
  general?: string;
  accion?: AccionSugerida;
}

const MENSAJE_INESPERADO = 'No pudimos abrir la rendición. Probá de nuevo en unos segundos.';
const MENSAJE_DATO_INVALIDO = 'Revisá este dato.';

const esCampo = (campo: string): campo is CampoAbrirRendicion =>
  campo === 'mes' || campo === 'anio' || campo === 'numeroFactura';

/** Errores del formulario de apertura para cada fallo. */
export function erroresDeApertura(fallo: FalloApertura): ErroresDeApertura {
  switch (fallo.tipo) {
    case 'rendicion-duplicada': {
      const existente = fallo.rendicionExistente;
      if (existente === null) {
        return { campos: { numeroFactura: 'Esa factura ya está en otra rendición del cliente.' } };
      }
      return {
        campos: { numeroFactura: 'Esa factura ya está en otra rendición del cliente.' },
        general: `Ya hay una rendición abierta con la factura ${existente.numeroFactura} (${etiquetaDePeriodo(existente)}).`,
        accion: { tipo: 'ver-rendicion', rendicionId: existente.id },
      };
    }
    case 'matriz-vacia':
      return {
        general:
          'El cliente no tiene requisitos activos: agregá al menos uno antes de abrir una rendición.',
        accion: { tipo: 'configurar-matriz' },
      };
    case 'cliente-no-activo':
      return {
        general:
          fallo.estado === null
            ? 'El cliente no está activo: reactivalo para abrir rendiciones.'
            : `El cliente está ${etiquetasEstado[fallo.estado]}: reactivalo para abrir rendiciones.`,
      };
    case 'no-existe':
      return { general: 'Este cliente ya no existe.' };
    case 'datos-invalidos': {
      const campos: Partial<Record<CampoAbrirRendicion, string>> = {};
      for (const { campo, mensaje } of fallo.detalles) {
        if (esCampo(campo)) {
          campos[campo] ??= mensajeDelServidor(mensaje) ?? MENSAJE_DATO_INVALIDO;
        }
      }
      return Object.keys(campos).length > 0
        ? { campos, general: 'Algunos datos no son válidos. Revisá los campos marcados.' }
        : { general: MENSAJE_INESPERADO };
    }
    case 'inesperado':
      return { general: MENSAJE_INESPERADO };
  }
}

/** Mensaje si falla la anulación y el diálogo queda abierto para reintentar. */
export const MENSAJE_FALLO_ANULACION =
  'No pudimos anular la rendición. Probá de nuevo en unos segundos.';

/** Si la rendición ya no existe, no hay nada que reintentar: se cierra y se avisa. */
export function cierraTrasFallarAnulacion(fallo: FalloAnulacion): boolean {
  return fallo.tipo === 'no-existe';
}

/** Por qué no se sumó un requisito a una rendición, para completar "no se pudo sumar a X: …". */
export function motivoFalloAgregado(fallo: FalloAgregado): string {
  switch (fallo.tipo) {
    case 'ya-esta':
      return 'ya tenía ese documento';
    case 'rendicion-anulada':
      return 'la rendición está anulada';
    case 'cliente-no-activo':
      return fallo.estado === null
        ? 'el cliente no está activo'
        : `el cliente está ${etiquetasEstado[fallo.estado]}`;
    case 'no-existe':
      return 'la rendición o el requisito ya no existe';
    case 'inesperado':
      return 'no pudimos sumarlo, probá de nuevo';
  }
}

/** Por qué no se cambió el canal de un ítem: se muestra dentro del diálogo. */
export function mensajeFalloCorreccionDeCanal(fallo: FalloCorreccionDeCanal): string {
  switch (fallo.tipo) {
    case 'rendicion-anulada':
      return 'La rendición está anulada: ya no se puede modificar.';
    case 'no-existe':
      return 'Este documento ya no está en la rendición. Volvé a cargar la página.';
    case 'inesperado':
      return 'No pudimos cambiar el canal. Probá de nuevo en unos segundos.';
  }
}
