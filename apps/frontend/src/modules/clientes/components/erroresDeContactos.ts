// Traduce un fallo del guardado de contactos a lo que muestra el formulario: errores en línea
// por contacto y campo, y un mensaje general. Nunca muestra detalles técnicos.

import { ApiClientError } from '@/lib/http';

/** Campos de un contacto que el servidor puede marcar. */
export type CampoContacto = 'nombre' | 'area' | 'email';

/** Errores del servidor para el formulario: por contacto (índice en la lista) y/o uno general. */
export interface ErroresDeContactos {
  general?: string;
  contactos?: Record<number, Partial<Record<CampoContacto, string>>>;
}

const MENSAJE_INESPERADO = 'No pudimos guardar los contactos. Probá de nuevo en unos segundos.';

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/** `{ error: { code, message, details } }` del contrato, o `null` si el cuerpo no tiene esa forma. */
function leerError(payload: unknown) {
  if (!esObjeto(payload) || !esObjeto(payload.error)) return null;
  return {
    code: payload.error.code,
    message: payload.error.message,
    details: payload.error.details,
  };
}

/** `contactos.1.email` → `{ indice: 1, campo: 'email' }`. Otras rutas no corresponden a un campo. */
function leerCampo(ruta: string): { indice: number; campo: CampoContacto } | null {
  const partes = /^contactos\.(\d+)\.(nombre|area|email)$/.exec(ruta);
  return partes === null ? null : { indice: Number(partes[1]), campo: partes[2] as CampoContacto };
}

function erroresDeValidacion(details: unknown): ErroresDeContactos {
  const contactos: NonNullable<ErroresDeContactos['contactos']> = {};
  let sinCampo = false;
  for (const detalle of Array.isArray(details) ? details : []) {
    if (!esObjeto(detalle) || typeof detalle.campo !== 'string') continue;
    const destino = leerCampo(detalle.campo);
    if (destino === null || typeof detalle.mensaje !== 'string') {
      sinCampo = true;
      continue;
    }
    // Se conserva el primer mensaje de cada campo, como en el resto de los formularios.
    contactos[destino.indice] = {
      ...contactos[destino.indice],
      [destino.campo]: contactos[destino.indice]?.[destino.campo] ?? detalle.mensaje,
    };
  }
  const hayCampos = Object.keys(contactos).length > 0;
  return {
    ...(hayCampos ? { contactos } : {}),
    // Con campos marcados alcanza para orientar; sin ellos hace falta un aviso general.
    ...(!hayCampos || sinCampo
      ? { general: 'Algunos datos no son válidos. Revisá los contactos.' }
      : {}),
  };
}

export function erroresDeGuardadoDeContactos(error: unknown): ErroresDeContactos {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    return { general: MENSAJE_INESPERADO };
  }
  const cuerpo = leerError(error.payload);

  if (error.status === 400 && cuerpo?.code === 'VALIDATION_ERROR') {
    return erroresDeValidacion(cuerpo.details);
  }
  if (error.status === 404 && cuerpo?.code === 'NOT_FOUND') {
    return {
      general:
        cuerpo.message === 'Contacto no encontrado'
          ? 'Alguno de los contactos ya no existe. Cerrá este panel y volvé a abrirlo para ver la lista actual.'
          : 'Este cliente ya no existe. Cerrá este panel y actualizá el listado.',
    };
  }
  if (error.status === 409 && esObjeto(cuerpo?.details)) {
    if (cuerpo.details.motivo === 'EMAIL_DUPLICADO') {
      return {
        general:
          'Alguno de los emails ya lo tiene otro contacto de este cliente. Revisalos y probá de nuevo.',
      };
    }
    if (cuerpo.details.motivo === 'CONTACTOS_MODIFICADOS') {
      return {
        general:
          'Los contactos de este cliente cambiaron mientras los editabas. Probá guardar de nuevo.',
      };
    }
  }
  return { general: MENSAJE_INESPERADO };
}
