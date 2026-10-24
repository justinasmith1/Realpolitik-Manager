import { CANTIDAD_MAX, parsearDiasEscritos, problemaDeDias } from '@realpolitik/shared';

export interface ClienteSeleccionadoForm {
  seleccionado: boolean;
  cantidad: number | string;
  diasAproximados: string;
}

export interface CargaMasivaFormValues {
  tipoDocumentoId: string;
  canalEntrega: '' | 'CORREO' | 'PORTAL_WEB' | 'WHATSAPP';
  nota: string;
  clientes: Record<string, ClienteSeleccionadoForm>;
}

export interface ValidacionClienteRow {
  valido: boolean;
  errorCantidad?: string;
  errorDias?: string;
  cantidadNum?: number;
  diasArray?: number[];
}

/**
 * Valida la fila de un cliente seleccionado según las reglas de negocio de @realpolitik/shared:
 * - `cantidad`: número entero entre 1 y CANTIDAD_MAX (100).
 * - `diasAproximados`: si se ingresa texto, se parsea con parsearDiasEscritos. Cada número debe ser
 *   un entero entre 1 y 31 (sin NaN) y la cantidad de días debe coincidir estrictamente con `cantidad`.
 */
export function validarFilaCliente(datos?: ClienteSeleccionadoForm): ValidacionClienteRow {
  if (!datos || !datos.seleccionado) {
    return { valido: true };
  }

  const rawCantidad = String(datos.cantidad ?? '').trim();
  if (rawCantidad === '') {
    return { valido: false, errorCantidad: 'Ingresá la cantidad.' };
  }

  const cantidadNum = Number(rawCantidad);
  if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > CANTIDAD_MAX) {
    return {
      valido: false,
      errorCantidad: `La cantidad debe ser un número entero entre 1 y ${CANTIDAD_MAX}.`,
    };
  }

  const diasTexto = (datos.diasAproximados ?? '').trim();
  if (diasTexto === '') {
    return { valido: true, cantidadNum, diasArray: [] };
  }

  const diasParsed = parsearDiasEscritos(diasTexto);
  // Verificar si hay NaN (letras, caracteres inválidos, etc.)
  if (diasParsed.some((d: number) => Number.isNaN(d))) {
    return {
      valido: false,
      cantidadNum,
      errorDias: 'Cada día aproximado debe ser un número entero entre 1 y 31.',
    };
  }

  // Verificar rango de días (1..31)
  if (diasParsed.some((d: number) => d < 1 || d > 31)) {
    return {
      valido: false,
      cantidadNum,
      errorDias: 'Cada día aproximado debe ser un número entero entre 1 y 31.',
    };
  }

  // Verificar coherencia entre cantidad y días usando problemaDeDias
  const problema = problemaDeDias(cantidadNum, diasParsed);
  if (problema !== null) {
    return {
      valido: false,
      cantidadNum,
      errorDias: problema,
    };
  }

  return {
    valido: true,
    cantidadNum,
    diasArray: diasParsed,
  };
}
