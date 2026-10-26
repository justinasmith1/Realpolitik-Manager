// Traduce un fallo ya interpretado por `requisitos.api` al texto del formulario o de la baja.
// No muestra detalles técnicos.

import type { ClienteEstadoType } from '@realpolitik/shared';

import { mensajeDelServidor } from '@/lib/errores-api';
import type { FalloRequisito, RequisitoExistente } from '@/modules/clientes/api/requisitos.api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import type { CampoRequisito } from '@/modules/clientes/components/requisitoForm.validation';

/** Errores del envío: por campo, por posición de día, un aviso de estado y/o uno general. */
export interface ErroresDeEnvio {
  campos?: Partial<Record<CampoRequisito, string>>;
  diasPorIndice?: Record<number, string>;
  /** El cliente ya no se puede modificar. No es un error de validación. */
  aviso?: string;
  general?: string;
  bloqueaEnvio?: boolean;
}

export const MENSAJE_NO_EXISTE = 'Este recurso ya no está disponible.';

const MENSAJE_DATO_INVALIDO = 'Revisá este dato.';
const MENSAJE_GENERAL_CON_CAMPOS = 'Algunos datos no son válidos. Revisá los campos marcados.';
const MENSAJE_GENERAL_SIN_CAMPOS = 'Algunos datos no son válidos. Revisá los datos ingresados.';

const CAMPOS: readonly CampoRequisito[] = ['tipoDocumentoId', 'cantidad', 'dias', 'canal', 'nota'];

const campoDeLaApi: Partial<Record<string, CampoRequisito>> = {
  tipoDocumentoId: 'tipoDocumentoId',
  cantidad: 'cantidad',
  diasAproximados: 'dias',
  canalEntrega: 'canal',
  nota: 'nota',
};

export function mensajeClienteNoActivo(estado: ClienteEstadoType | null): string {
  if (estado === null || estado === 'ACTIVO') {
    return 'Este cliente ya no está activo. No se pueden modificar sus requisitos.';
  }
  return `Este cliente está ${etiquetasEstado[estado]}. Ya no se pueden modificar sus requisitos.`;
}

export function mensajeDuplicado(existente: RequisitoExistente | null): string {
  if (existente === null) {
    return 'Este cliente ya tiene un requisito activo para ese tipo de documento.';
  }
  return `Este cliente ya tiene un requisito activo para ese tipo (cantidad ${existente.cantidad}).`;
}

function esCampo(campo: string): campo is CampoRequisito {
  return (CAMPOS as readonly string[]).includes(campo);
}

/**
 * Errores para el formulario. `mensajeInesperado` es lo que se dice cuando no se sabe qué pasó.
 * Un 404 no nombra el recurso: el contrato no dice si falta el cliente, el tipo o el requisito.
 */
export function erroresParaElFormulario(
  fallo: FalloRequisito,
  mensajeInesperado: string,
): ErroresDeEnvio {
  switch (fallo.tipo) {
    case 'requisito-duplicado':
      return { campos: { tipoDocumentoId: mensajeDuplicado(fallo.requisitoExistente) } };
    case 'cliente-no-activo':
      return { aviso: mensajeClienteNoActivo(fallo.estado), bloqueaEnvio: true };
    case 'no-existe':
      return { general: MENSAJE_NO_EXISTE, bloqueaEnvio: true };
    case 'datos-invalidos': {
      const campos: Partial<Record<CampoRequisito, string>> = {};
      const diasPorIndice: Record<number, string> = {};
      const sueltos: string[] = [];
      for (const { campo, mensaje } of fallo.detalles) {
        const texto = mensajeDelServidor(mensaje);
        const dia = /^diasAproximados\.(\d+)$/.exec(campo);
        if (dia !== null) {
          const indice = Number(dia[1]);
          diasPorIndice[indice] ??= texto ?? MENSAJE_DATO_INVALIDO;
          continue;
        }
        const destino = campoDeLaApi[campo] ?? (esCampo(campo) ? campo : undefined);
        if (destino !== undefined) {
          campos[destino] ??= texto ?? MENSAJE_DATO_INVALIDO;
        } else if (texto !== null) {
          sueltos.push(texto);
        }
      }
      const hayCampos = Object.keys(campos).length > 0 || Object.keys(diasPorIndice).length > 0;
      return {
        campos,
        ...(Object.keys(diasPorIndice).length > 0 ? { diasPorIndice } : {}),
        general: hayCampos
          ? MENSAJE_GENERAL_CON_CAMPOS
          : (sueltos[0] ?? MENSAJE_GENERAL_SIN_CAMPOS),
      };
    }
    case 'inesperado':
      return { general: mensajeInesperado };
  }
}

/**
 * Texto de una baja que falló. `cierra` es falso cuando tiene sentido reintentar (red o servidor):
 * el diálogo sigue abierto. Un 404 o un cliente inactivo no se reintenta.
 */
export function mensajeFalloBaja(fallo: FalloRequisito): { texto: string; cierra: boolean } {
  switch (fallo.tipo) {
    case 'no-existe':
      return { texto: MENSAJE_NO_EXISTE, cierra: true };
    case 'cliente-no-activo':
      return { texto: mensajeClienteNoActivo(fallo.estado), cierra: true };
    default:
      return {
        texto: 'No pudimos quitar el requisito. Probá de nuevo en unos segundos.',
        cierra: false,
      };
  }
}
