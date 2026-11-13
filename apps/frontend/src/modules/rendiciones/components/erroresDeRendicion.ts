// Traduce un fallo de rendiciones (ya interpretado por `rendiciones.api`) a texto de la interfaz.
// Nunca muestra detalles técnicos.

import { MENSAJE_MOTIVO_OBLIGATORIO, type EstadoRendicionType } from '@realpolitik/shared';

import { mensajeDelServidor } from '@/lib/errores-api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import type {
  FalloAgregado,
  FalloAnulacion,
  FalloActualizacionOc,
  FalloApertura,
  FalloCambioDeEstado,
  FalloCobro,
  FalloCorreccionDeCanal,
  FalloPreparacionEnvio,
  FalloPropagacion,
} from '@/modules/rendiciones/api/rendiciones.api';
import type { CampoAbrirRendicion } from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import type { CampoOc } from '@/modules/rendiciones/components/editarOcForm.validation';
import type { CampoCobro } from '@/modules/rendiciones/components/registrarCobroForm.validation';
import {
  etiquetaDePeriodo,
  MENSAJE_COBRO_ESTADO_INVALIDO,
  MENSAJE_COBRO_REGISTRADO,
} from '@/modules/rendiciones/rendiciones.etiquetas';

/** Lo que se puede hacer a partir del error, además de leerlo. */
export type AccionSugerida =
  { tipo: 'ver-rendicion'; rendicionId: string; clienteId: string } | { tipo: 'configurar-matriz' };

/** La factura ya está para ese emisor: el número no se repite entre rendiciones activas. */
const MENSAJE_FACTURA_REPETIDA = 'Ese número de factura ya existe para este emisor.';

export interface ErroresDeApertura {
  campos?: Partial<Record<CampoAbrirRendicion, string>>;
  general?: string;
  accion?: AccionSugerida;
}

const MENSAJE_INESPERADO = 'No pudimos abrir la rendición. Probá de nuevo en unos segundos.';
const MENSAJE_DATO_INVALIDO = 'Revisá este dato.';

const esCampo = (campo: string): campo is CampoAbrirRendicion =>
  campo === 'mes' || campo === 'anio' || campo === 'emisor' || campo === 'numeroFactura';

/** Errores del formulario de apertura para cada fallo. */
export function erroresDeApertura(fallo: FalloApertura): ErroresDeApertura {
  switch (fallo.tipo) {
    case 'rendicion-duplicada': {
      const existente = fallo.rendicionExistente;
      if (existente === null) {
        return { campos: { numeroFactura: MENSAJE_FACTURA_REPETIDA } };
      }
      return {
        campos: { numeroFactura: MENSAJE_FACTURA_REPETIDA },
        general: `Ya hay una rendición abierta con la factura ${existente.numeroFactura} (${etiquetaDePeriodo(existente)}) para este emisor.`,
        // El enlace usa el cliente de la existente: puede ser otro, y con el actual daría 404.
        accion: {
          tipo: 'ver-rendicion',
          rendicionId: existente.id,
          clienteId: existente.clienteId,
        },
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
    case 'rendicion-enviada':
      return 'la rendición ya no se puede modificar';
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
    case 'rendicion-enviada':
      return MENSAJE_RENDICION_ENVIADA;
    case 'no-existe':
      return 'Este documento ya no está en la rendición. Volvé a cargar la página.';
    case 'inesperado':
      return 'No pudimos cambiar el canal. Probá de nuevo en unos segundos.';
  }
}

/**
 * Por qué no se propagó el canal: se muestra dentro del diálogo. Es todo o nada, así que ninguna
 * rendición cambió; el requisito sí quedó guardado. `describir` nombra la rendición del conflicto
 * (período y factura) si está en la lista.
 */
export function mensajeFalloPropagacion(
  fallo: FalloPropagacion,
  describir: (rendicionId: string) => string | null,
): string {
  const quien = (rendicionId: string | null) =>
    (rendicionId === null ? null : describir(rendicionId)) ?? 'una de las rendiciones elegidas';
  const motivo = (() => {
    switch (fallo.tipo) {
      case 'rendicion-anulada':
        return `${quien(fallo.rendicionId)} está anulada. Destildala y probá de nuevo.`;
      case 'rendicion-enviada':
        return `${quien(fallo.rendicionId)} ya no se puede modificar. Destildala y probá de nuevo.`;
      case 'requisito-no-en-rendicion':
        return `${quien(fallo.rendicionId)} ya no tiene documentos de este requisito. Destildala y probá de nuevo.`;
      case 'no-existe':
        return 'alguna de las rendiciones o el requisito ya no existe. Volvé a cargar la página.';
      case 'inesperado':
        return 'probá de nuevo en unos segundos.';
    }
  })();
  return `El requisito quedó guardado, pero no se actualizó ninguna rendición: ${motivo}`;
}

/**
 * Por qué no se preparó el envío: se avisa en el checklist, que ya se volvió a pedir. `describir`
 * nombra el ítem del conflicto si sigue en la rendición.
 */
export function mensajeFalloPreparacionEnvio(
  fallo: FalloPreparacionEnvio,
  describir: (itemId: string) => string | null,
): string {
  switch (fallo.tipo) {
    case 'rendicion-anulada':
      return 'La rendición se anuló: ya no se puede enviar.';
    case 'item-no-enviable': {
      const item = fallo.itemId === null ? null : describir(fallo.itemId);
      const quien = item === null ? 'Un ítem elegido' : item;
      return fallo.motivo === 'ITEM_PENDIENTE'
        ? `${quien} ya no tiene documento: no se puede enviar. Actualizamos el checklist: revisá la selección.`
        : `${quien} no tiene un documento vigente: no se puede enviar. Actualizamos el checklist: revisá la selección.`;
    }
    case 'canales-distintos':
      return 'Los ítems elegidos se envían por canales distintos. Actualizamos el checklist: separalos en envíos distintos.';
    case 'no-existe':
      return 'La rendición o algún ítem ya no existe. Volvé a cargar la página.';
    case 'inesperado':
      return 'No pudimos preparar el envío. Probá de nuevo en unos segundos.';
  }
}

// ─── Estado de la rendición (HU3.6) ───────────────────────────────────────────────────────

/**
 * Una rendición Enviada o Aprobada no se modifica (HU3.7 y HU3.8): documentos, canales y requisitos.
 * El servidor responde `RENDICION_ENVIADA` en los dos casos, así que el texto no dice "enviada".
 */
export const MENSAJE_RENDICION_ENVIADA = 'La rendición ya no se puede modificar.';

/** Aprobar o rechazar una rendición que ya no está Enviada (otra persona respondió antes). */
export const MENSAJE_RENDICION_CAMBIO_DE_ESTADO =
  'La rendición ya cambió de estado. Volvé a cargar la página.';

const MENSAJE_TRANSICION_NO_PERMITIDA =
  'Ese cambio de estado no está permitido desde el estado actual.';

/** Lo que depende del estado pedido en los mensajes de un cambio de estado. */
interface TextosDeDestino {
  /** El comienzo del aviso de faltantes: "No se puede marcar como completa". */
  noSePuede: string;
  /** El aviso si la transición ya no está permitida (otra persona la cambió antes). */
  transicionInvalida: string;
}

/**
 * Los textos de cada estado de destino. Es un `Record` de todos los estados: si se agrega uno, no
 * compila hasta darle sus textos. Aprobar y rechazar (HU3.8) parten de una Enviada que pudo
 * responder otra persona: piden recargar.
 */
const TEXTOS_POR_DESTINO: Record<EstadoRendicionType, TextosDeDestino> = {
  EN_CURSO: {
    noSePuede: 'No se puede volver a En curso',
    transicionInvalida: MENSAJE_TRANSICION_NO_PERMITIDA,
  },
  COMPLETA: {
    noSePuede: 'No se puede marcar como completa',
    transicionInvalida: MENSAJE_TRANSICION_NO_PERMITIDA,
  },
  ENVIADA: {
    noSePuede: 'No se puede marcar como enviada',
    transicionInvalida: MENSAJE_TRANSICION_NO_PERMITIDA,
  },
  APROBADA: {
    noSePuede: 'No se puede registrar como aprobada',
    transicionInvalida: MENSAJE_RENDICION_CAMBIO_DE_ESTADO,
  },
  RECHAZADA: {
    noSePuede: 'No se puede registrar como rechazada',
    transicionInvalida: MENSAJE_RENDICION_CAMBIO_DE_ESTADO,
  },
};

/**
 * Por qué no se pudo cambiar el estado: se avisa en el checklist (o en el diálogo del envío), que
 * ya se volvió a pedir. `destino` es el estado pedido (`TEXTOS_POR_DESTINO`): el aviso de
 * faltantes dice si era para completarla o para marcarla como enviada.
 */
export function mensajeFalloCambioDeEstado(
  fallo: FalloCambioDeEstado,
  destino: EstadoRendicionType,
): string {
  const { noSePuede, transicionInvalida } = TEXTOS_POR_DESTINO[destino];
  switch (fallo.tipo) {
    case 'items-pendientes':
      if (fallo.faltantes === null) {
        return `${noSePuede}: faltan documentos.`;
      }
      if (fallo.faltantes === 0) {
        return `${noSePuede}: la rendición no tiene documentos.`;
      }
      return fallo.faltantes === 1
        ? `${noSePuede}: falta 1 documento.`
        : `${noSePuede}: faltan ${fallo.faltantes} documentos.`;
    case 'fecha-invalida':
      return mensajeDelServidor(fallo.mensaje) ?? 'Revisá la fecha de envío.';
    case 'motivo-invalido':
      return mensajeDelServidor(fallo.mensaje) ?? MENSAJE_MOTIVO_OBLIGATORIO;
    case 'rendicion-anulada':
      return 'La rendición está anulada: ya no se puede modificar.';
    case 'transicion-invalida':
      return transicionInvalida;
    case 'cobro-registrado':
      return MENSAJE_COBRO_REGISTRADO;
    case 'no-existe':
      return 'La rendición ya no existe. Volvé a cargar la página.';
    case 'inesperado':
      return 'No pudimos cambiar el estado de la rendición. Probá de nuevo en unos segundos.';
  }
}

// ─── Orden de compra (HU2.11) ─────────────────────────────────────────────────────────────

export interface ErroresDeActualizacionOc {
  campos?: Partial<Record<CampoOc, string>>;
  general?: string;
}

const MENSAJE_INESPERADO_OC =
  'No pudimos guardar la orden de compra. Probá de nuevo en unos segundos.';

const esCampoOc = (campo: string): campo is CampoOc =>
  campo === 'numeroOc' || campo === 'montoMensual' || campo === 'montoTotal';

/** Errores del formulario de la OC para cada fallo. */
export function mensajeFalloActualizacionOc(fallo: FalloActualizacionOc): ErroresDeActualizacionOc {
  switch (fallo.tipo) {
    case 'rendicion-anulada':
      return { general: 'La rendición está anulada: ya no se puede modificar.' };
    case 'no-existe':
      return { general: 'Esta rendición ya no existe.' };
    case 'datos-invalidos': {
      const campos: Partial<Record<CampoOc, string>> = {};
      for (const { campo, mensaje } of fallo.detalles) {
        if (esCampoOc(campo)) {
          campos[campo] ??= mensajeDelServidor(mensaje) ?? MENSAJE_DATO_INVALIDO;
        }
      }
      return Object.keys(campos).length > 0
        ? { campos, general: 'Algunos datos no son válidos. Revisá los campos marcados.' }
        : { general: MENSAJE_INESPERADO_OC };
    }
    case 'inesperado':
      return { general: MENSAJE_INESPERADO_OC };
  }
}

// ─── Cobro informado por el cliente (HU3.10) ──────────────────────────────────────────────

export interface ErroresDeCobro {
  campos?: Partial<Record<CampoCobro, string>>;
  general?: string;
}

const MENSAJE_INESPERADO_COBRO = 'No pudimos guardar el cobro. Probá de nuevo en unos segundos.';

const esCampoDeCobro = (campo: string): campo is CampoCobro =>
  campo === 'fecha' || campo === 'nota';

/** Errores de la hoja del cobro para cada fallo (al registrarlo, corregirlo o quitarlo). */
export function mensajeFalloCobro(fallo: FalloCobro): ErroresDeCobro {
  switch (fallo.tipo) {
    case 'rendicion-anulada':
      return { general: 'La rendición está anulada: ya no se puede modificar.' };
    case 'estado-invalido':
      return { general: MENSAJE_COBRO_ESTADO_INVALIDO };
    case 'no-existe':
      return { general: 'Esta rendición ya no existe. Volvé a cargar la página.' };
    case 'datos-invalidos': {
      const campos: Partial<Record<CampoCobro, string>> = {};
      for (const { campo, mensaje } of fallo.detalles) {
        if (esCampoDeCobro(campo)) {
          campos[campo] ??= mensajeDelServidor(mensaje) ?? MENSAJE_DATO_INVALIDO;
        }
      }
      return Object.keys(campos).length > 0
        ? { campos, general: 'Algunos datos no son válidos. Revisá los campos marcados.' }
        : { general: MENSAJE_INESPERADO_COBRO };
    }
    case 'inesperado':
      return { general: MENSAJE_INESPERADO_COBRO };
  }
}
