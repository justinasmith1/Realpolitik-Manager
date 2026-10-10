// Traduce un fallo del servidor (alta, edición o cambio de estado) a texto de la interfaz:
// los errores por campo de `ClienteForm` o, para el cambio de estado, un mensaje suelto.

import type { FalloAltaCliente, FalloCambioEstado } from '@/modules/clientes/api/clientes.api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import type { ErroresDeEnvio } from '@/modules/clientes/components/ClienteForm';
import {
  valoresInicialesClienteForm,
  type CampoClienteForm,
} from '@/modules/clientes/components/clienteForm.validation';

// Los campos del formulario son las claves de sus valores: un campo nuevo del formulario queda
// mapeado sin tocar esta lista. Los que el servidor valida pero el formulario no tiene
// (`telefono`, `emailsAdicionales.N`) no están y se informan en el aviso general.
const camposDelFormulario = new Set<string>(Object.keys(valoresInicialesClienteForm));

// La API informa los datos anidados con notación de puntos; el formulario los tiene sueltos.
const campoDeLaApi: Partial<Record<string, CampoClienteForm>> = {
  periodicidad: 'periodicidadTipo',
  'periodicidad.tipo': 'periodicidadTipo',
  'periodicidad.diaLimite': 'periodicidadDiaLimite',
  'periodicidad.mesInicioCiclo': 'periodicidadMesInicioCiclo',
};

function campoDelFormulario(campoDeLaApiRecibido: string): CampoClienteForm | undefined {
  const campo = campoDeLaApi[campoDeLaApiRecibido] ?? campoDeLaApiRecibido;
  return camposDelFormulario.has(campo) ? (campo as CampoClienteForm) : undefined;
}

// Mensajes por defecto de Zod, en inglés ("Required", "Expected string, received number"...).
// El contrato avisa que pueden llegar cuando `shared` no define el texto: esos no se muestran.
const MENSAJE_POR_DEFECTO_DE_ZOD =
  /^(Required|Invalid |Expected |Unrecognized key|String must|Number must|Array must|Too (small|big))/;

/** El texto del servidor, solo si es un mensaje pensado para personas (en español). */
function mensajeUtil(mensaje: string | null): string | null {
  const texto = mensaje?.trim() ?? '';
  return texto === '' || MENSAJE_POR_DEFECTO_DE_ZOD.test(texto) ? null : texto;
}

const MENSAJE_DATO_INVALIDO = 'Revisá este dato.';
const MENSAJE_GENERAL_CON_CAMPOS = 'Algunos datos no son válidos. Revisá los campos marcados.';
const MENSAJE_GENERAL_SIN_CAMPOS = 'Algunos datos no son válidos. Revisá los datos ingresados.';

/**
 * Texto para la interfaz de cada fallo. Nunca muestra detalles técnicos. `mensajeInesperado`
 * es lo que se dice cuando no se sabe qué pasó (cambia según la acción: alta o edición).
 *
 * Con datos inválidos, cada campo del formulario muestra el mensaje del servidor (por ejemplo,
 * "Para cargar la URL del portal, el canal tiene que ser Portal web.") y, si no vino uno útil,
 * un aviso genérico. Lo que no corresponde a ningún campo del formulario va al aviso general,
 * con el mensaje del servidor.
 */
export function erroresParaElFormulario(
  fallo: FalloAltaCliente,
  mensajeInesperado: string,
): ErroresDeEnvio {
  switch (fallo.tipo) {
    case 'cuit-duplicado': {
      const existente = fallo.clienteExistente;
      return {
        campos: {
          cuit:
            existente === null
              ? 'Ya existe un cliente registrado con este CUIT.'
              : `Ya existe un cliente registrado con este CUIT: ${existente.razonSocial} (${etiquetasEstado[existente.estado]}).`,
        },
      };
    }
    case 'datos-invalidos': {
      const campos: Partial<Record<CampoClienteForm, string>> = {};
      const sueltos: string[] = [];
      for (const { campo, mensaje } of fallo.detalles) {
        const destino = campoDelFormulario(campo);
        const texto = mensajeUtil(mensaje);
        if (destino === undefined) {
          if (texto !== null) sueltos.push(texto);
          continue;
        }
        // Se conserva el primer mensaje de cada campo, como en el resto de los formularios.
        campos[destino] ??= texto ?? MENSAJE_DATO_INVALIDO;
      }
      const hayCampos = Object.keys(campos).length > 0;
      const general = [
        hayCampos ? MENSAJE_GENERAL_CON_CAMPOS : (sueltos[0] ?? MENSAJE_GENERAL_SIN_CAMPOS),
        ...(hayCampos && sueltos[0] !== undefined ? [sueltos[0]] : []),
      ].join(' ');
      return { campos, general };
    }
    case 'inesperado':
      return { general: mensajeInesperado };
  }
}

/**
 * Mensaje para cuando falla desactivar o reactivar un cliente. Si ya no existe se dice eso, y
 * nada más: el listado se vuelve a pedir, pero ese pedido también podría fallar, así que no se
 * promete que "se actualizó" (lo muestra el listado). Lo demás es genérico, sin detalles técnicos.
 */
export function mensajeFalloCambioEstado(
  fallo: FalloCambioEstado,
  accion: 'desactivar' | 'reactivar',
): string {
  switch (fallo.tipo) {
    case 'no-existe':
      return 'Este cliente ya no existe.';
    case 'inesperado':
      return `No pudimos ${accion} el cliente. Probá de nuevo en unos segundos.`;
  }
}
