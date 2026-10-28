// El aviso de la página cuando el cliente se creó pero alguna de sus notas no se pudo guardar. Las
// notas se guardan después del alta, en pedidos propios: si fallan, el cliente ya existe y no se
// puede volver a registrar (sería un CUIT duplicado). El aviso lo dice, cuenta qué se guardó y qué
// no, y manda a "Editar". Nunca muestra detalles técnicos.

export type NotaDelAlta = 'indicaciones' | 'observaciones';

/** Lo que `NuevoClienteSheet` le cuenta a la página cuando alguna nota no se guardó. */
export interface FallosDelAlta {
  /** Por qué no se guardó cada nota que falló. */
  motivos: Partial<Record<NotaDelAlta, string>>;
  /** Las notas que sí se guardaron en este alta. */
  guardadas: readonly NotaDelAlta[];
}

const NOMBRES = {
  indicaciones: 'indicaciones de armado',
  observaciones: 'observaciones internas',
} as const;

/** Orden fijo, el mismo del formulario. */
const ORDEN: readonly NotaDelAlta[] = ['indicaciones', 'observaciones'];

const CIERRE = 'Podés cargarlas desde "Editar".';

function capitalizar(texto: string): string {
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
}

function unir(nombres: readonly string[], conector: 'y' | 'ni'): string {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} ${conector} ${nombres.at(-1) ?? ''}`;
}

/**
 * `registrado` es el comienzo del aviso del alta ("Se registró el cliente X (CUIT …)"), sin punto
 * final. Con un solo motivo se agrega tal cual; con varios, cada uno con el nombre de su nota.
 */
export function avisoDeAltaConFallos(registrado: string, fallos: FallosDelAlta): string {
  const fallidas = ORDEN.filter((nota) => fallos.motivos[nota] !== undefined);
  const guardadas = ORDEN.filter((nota) => fallos.guardadas.includes(nota));

  const sinGuardar = unir(
    fallidas.map((nota) => `sus ${NOMBRES[nota]}`),
    'ni',
  );
  const conGuardadas =
    guardadas.length > 0
      ? ` y se guardaron ${unir(
          guardadas.map((nota) => `sus ${NOMBRES[nota]}`),
          'y',
        )}`
      : '';

  const motivos =
    fallidas.length === 1
      ? ` ${fallos.motivos[fallidas[0] ?? 'indicaciones'] ?? ''}`
      : fallidas
          .map((nota) => ` ${capitalizar(NOMBRES[nota])}: ${fallos.motivos[nota] ?? ''}`)
          .join('');

  return `${registrado}${conGuardadas}, pero no pudimos guardar ${sinGuardar}.${motivos} ${CIERRE}`;
}
