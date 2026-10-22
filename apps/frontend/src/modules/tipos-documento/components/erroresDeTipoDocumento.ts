// Traduce un fallo del servidor (ya interpretado por `tipos-documento.api`) a texto de la
// interfaz: los errores del formulario del alta y la edición, o el mensaje del cambio de estado.
// Nunca muestra detalles técnicos.

import { mensajeDelServidor } from '@/lib/errores-api';
import type {
  FalloCambioEstadoTipoDocumento,
  FalloEdicionTipoDocumento,
  TipoDocumentoExistente,
} from '@/modules/tipos-documento/api/tipos-documento.api';
import type { CampoTipoDocumentoForm } from '@/modules/tipos-documento/components/tipoDocumentoForm.validation';

/** Errores que informó el servidor al enviar: por campo y/o uno general. */
export interface ErroresDeEnvio {
  campos?: Partial<Record<CampoTipoDocumentoForm, string>>;
  general?: string;
}

export const MENSAJE_NO_EXISTE =
  'Este tipo de documento ya no existe. Actualizá el listado para continuar.';

const MENSAJE_DATO_INVALIDO = 'Revisá este dato.';
const MENSAJE_GENERAL_CON_CAMPOS = 'Algunos datos no son válidos. Revisá los campos marcados.';
const MENSAJE_GENERAL_SIN_CAMPOS = 'Algunos datos no son válidos. Revisá los datos ingresados.';

const esCampoDelFormulario = (campo: string): campo is CampoTipoDocumentoForm =>
  campo === 'nombre' || campo === 'descripcion';

/**
 * El nombre ya lo tiene otro tipo. Se dice cuál y si está desactivado (para que sepa dónde
 * buscarlo); si el servidor no informó el tipo con la forma del contrato, sin afirmar nada de él.
 */
export function mensajeNombreDuplicado(existente: TipoDocumentoExistente | null): string {
  if (existente === null) {
    return 'Ya existe un tipo de documento con ese nombre.';
  }
  return existente.activo
    ? `Ya existe «${existente.nombre}» en el catálogo.`
    : `Ya existe «${existente.nombre}» en el catálogo, pero está desactivado. Podés reactivarlo desde la lista activando «Incluir desactivados».`;
}

/**
 * Errores para el formulario de cada fallo del alta o la edición (el alta nunca da `no-existe`).
 * `mensajeInesperado` es lo que se dice cuando no se sabe qué pasó.
 *
 * Con datos inválidos, cada campo muestra el mensaje del servidor si es útil (los de shared) o un
 * aviso genérico; lo que no corresponde a un campo del formulario va al aviso general.
 */
export function erroresParaElFormulario(
  fallo: FalloEdicionTipoDocumento,
  mensajeInesperado: string,
): ErroresDeEnvio {
  switch (fallo.tipo) {
    case 'nombre-duplicado':
      return { campos: { nombre: mensajeNombreDuplicado(fallo.tipoDocumentoExistente) } };
    case 'datos-invalidos': {
      const campos: Partial<Record<CampoTipoDocumentoForm, string>> = {};
      const sueltos: string[] = [];
      for (const { campo, mensaje } of fallo.detalles) {
        const texto = mensajeDelServidor(mensaje);
        if (esCampoDelFormulario(campo)) {
          // Se conserva el primer mensaje de cada campo.
          campos[campo] ??= texto ?? MENSAJE_DATO_INVALIDO;
        } else if (texto !== null) {
          sueltos.push(texto);
        }
      }
      const hayCampos = Object.keys(campos).length > 0;
      const general = hayCampos
        ? MENSAJE_GENERAL_CON_CAMPOS
        : (sueltos[0] ?? MENSAJE_GENERAL_SIN_CAMPOS);
      return { campos, general };
    }
    case 'no-existe':
      return { general: MENSAJE_NO_EXISTE };
    case 'inesperado':
      return { general: mensajeInesperado };
  }
}

/**
 * Mensaje para cuando falla desactivar o reactivar. Si el tipo ya no existe se dice eso, sin
 * prometer que el listado ya se actualizó (ese pedido también podría fallar).
 */
export function mensajeFalloCambioEstado(
  fallo: FalloCambioEstadoTipoDocumento,
  accion: 'desactivar' | 'reactivar',
): string {
  switch (fallo.tipo) {
    case 'no-existe':
      return 'Este tipo de documento ya no existe.';
    case 'inesperado':
      return `No pudimos ${accion} el tipo de documento. Probá de nuevo en unos segundos.`;
  }
}
