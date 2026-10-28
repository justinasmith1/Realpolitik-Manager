// Qué se le dice a la operadora cuando alguna de las dos notas del cliente (indicaciones de armado,
// observaciones internas) no se pudo guardar. Se guardan en pedidos propios, después del PATCH del
// cliente, y son independientes: una puede salir bien aunque la otra falle. Nunca muestra
// detalles técnicos.

import type { FalloIndicaciones } from '@/modules/clientes/api/indicaciones-armado.api';
import type { FalloObservaciones } from '@/modules/clientes/api/observaciones-cliente.api';
import { motivoFalloIndicaciones } from '@/modules/clientes/components/erroresDeIndicaciones';
import { motivoFalloObservaciones } from '@/modules/clientes/components/erroresDeObservaciones';

const NOMBRES = {
  cliente: 'los datos del cliente',
  indicaciones: 'las indicaciones de armado',
  observaciones: 'las observaciones internas',
} as const;

/** El nombre de cada nota al comienzo de una frase ("Indicaciones de armado: …"). */
const TITULOS = {
  indicaciones: 'Indicaciones de armado',
  observaciones: 'Observaciones internas',
} as const;

export interface ResultadoDeNotas {
  /** El PATCH del cliente se hizo en este mismo envío y salió bien. */
  seGuardoElCliente: boolean;
  seGuardaronIndicaciones: boolean;
  seGuardaronObservaciones: boolean;
  falloIndicaciones?: FalloIndicaciones | undefined;
  falloObservaciones?: FalloObservaciones | undefined;
}

export interface ErroresDeNotas {
  /** Un texto que el servidor rechazó se marca en su campo. */
  indicaciones?: string;
  observaciones?: string;
  general: string;
}

function unir(frases: readonly string[], conector: 'y' | 'ni'): string {
  if (frases.length <= 1) return frases.join('');
  return `${frases.slice(0, -1).join(', ')} ${conector} ${frases.at(-1) ?? ''}`;
}

/**
 * Los errores del formulario cuando falla alguna nota. Dice qué se guardó (si algo) y qué no. Un
 * texto rechazado (400) va al campo; el resto, al aviso general: con un solo motivo se agrega tal
 * cual y con varios, cada uno con el nombre de su nota.
 */
export function erroresDeNotasParaElFormulario(resultado: ResultadoDeNotas): ErroresDeNotas {
  const guardados: string[] = [];
  if (resultado.seGuardoElCliente) guardados.push(NOMBRES.cliente);
  if (resultado.seGuardaronIndicaciones) guardados.push(NOMBRES.indicaciones);
  if (resultado.seGuardaronObservaciones) guardados.push(NOMBRES.observaciones);

  const fallidos: { clave: 'indicaciones' | 'observaciones'; motivo: string; enCampo: boolean }[] =
    [];
  if (resultado.falloIndicaciones !== undefined) {
    fallidos.push({
      clave: 'indicaciones',
      motivo: motivoFalloIndicaciones(resultado.falloIndicaciones),
      enCampo: resultado.falloIndicaciones.tipo === 'datos-invalidos',
    });
  }
  if (resultado.falloObservaciones !== undefined) {
    fallidos.push({
      clave: 'observaciones',
      motivo: motivoFalloObservaciones(resultado.falloObservaciones),
      enCampo: resultado.falloObservaciones.tipo === 'datos-invalidos',
    });
  }

  const noGuardados = unir(
    fallidos.map(({ clave }) => NOMBRES[clave]),
    'ni',
  );
  const encabezado =
    guardados.length > 0
      ? `Se guardaron ${unir(guardados, 'y')}, pero no ${noGuardados}.`
      : `No pudimos guardar ${noGuardados}.`;

  const delAviso = fallidos.filter(({ enCampo }) => !enCampo);
  const motivos =
    delAviso.length === 1
      ? ` ${delAviso[0]?.motivo ?? ''}`
      : delAviso.map(({ clave, motivo }) => ` ${TITULOS[clave]}: ${motivo}`).join('');

  const errores: ErroresDeNotas = { general: `${encabezado}${motivos}` };
  for (const { clave, motivo, enCampo } of fallidos) {
    if (enCampo) errores[clave] = motivo;
  }
  return errores;
}
