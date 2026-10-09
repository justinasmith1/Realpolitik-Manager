// Traduce un fallo del servidor (alta o edición) a los errores que muestra `ClienteForm`.

import type { FalloAltaCliente } from '@/modules/clientes/api/clientes.api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import type { ErroresDeEnvio } from '@/modules/clientes/components/ClienteForm';

const camposDelFormulario = new Set<string>([
  'razonSocial',
  'denominacion',
  'cuit',
  'sector',
  'subtipo',
  'ivaCondicion',
  'emailContacto',
  'periodicidadTipo',
  'periodicidadDiaLimite',
  'periodicidadMesInicioCiclo',
]);

// La API informa los datos anidados con notación de puntos; el formulario los tiene sueltos.
const campoDeLaApi: Partial<Record<string, string>> = {
  periodicidad: 'periodicidadTipo',
  'periodicidad.tipo': 'periodicidadTipo',
  'periodicidad.diaLimite': 'periodicidadDiaLimite',
  'periodicidad.mesInicioCiclo': 'periodicidadMesInicioCiclo',
};

/**
 * Texto para la interfaz de cada fallo. Nunca muestra detalles técnicos. `mensajeInesperado`
 * es lo que se dice cuando no se sabe qué pasó (cambia según la acción: alta o edición).
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
      const campos = Object.fromEntries(
        fallo.campos
          .map((campo) => campoDeLaApi[campo] ?? campo)
          .filter((campo) => camposDelFormulario.has(campo))
          .map((campo) => [campo, 'Revisá este dato.']),
      );
      return { campos, general: 'Algunos datos no son válidos. Revisá los campos marcados.' };
    }
    case 'inesperado':
      return { general: mensajeInesperado };
  }
}
