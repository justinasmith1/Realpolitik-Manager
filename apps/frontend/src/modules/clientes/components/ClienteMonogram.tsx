// Palabras que no aportan inicial ("Municipalidad de La Plata" → M + P).
const conectores = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);

const FALLBACK = '?';

// `Array.from` itera por caracteres Unicode, así que no parte un par subrogado.
const primerosCaracteres = (palabra: string, cantidad: number) =>
  Array.from(palabra).slice(0, cantidad).join('');

// Regla (la del handoff): se descartan las palabras que no empiezan con una letra y los
// conectores. Con dos o más palabras, la inicial de las dos primeras; con una sola, sus
// dos primeras letras. Sin ninguna palabra válida, un "?" neutro.
function iniciales(nombre: string): string {
  const [primera, segunda] = nombre
    .split(/\s+/)
    .filter((palabra) => /^\p{L}/u.test(palabra) && !conectores.has(palabra.toLowerCase()));

  if (primera === undefined) {
    return FALLBACK;
  }

  const resultado =
    segunda === undefined
      ? primerosCaracteres(primera, 2)
      : primerosCaracteres(primera, 1) + primerosCaracteres(segunda, 1);
  return resultado.toUpperCase();
}

interface ClienteMonogramProps {
  nombre: string;
}

/**
 * Monograma de un cliente, derivado de su nombre. Es decorativo: el nombre completo
 * siempre se muestra al lado, así que se oculta a las tecnologías de asistencia para no
 * duplicar la lectura. Es neutral (no cambia de color por cliente) y no es la marca de
 * Realpolitik Manager.
 */
export function ClienteMonogram({ nombre }: ClienteMonogramProps) {
  return (
    <span
      aria-hidden="true"
      // El fondo es el `mono` de la variante neutral del handoff (#E4E3DE, igual a --border).
      className="inline-flex size-7.5 flex-none items-center justify-center rounded-control bg-border text-[11px] font-semibold tracking-[0.02em] text-content-secondary"
    >
      {iniciales(nombre)}
    </span>
  );
}
