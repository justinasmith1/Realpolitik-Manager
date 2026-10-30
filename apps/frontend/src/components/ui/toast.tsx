import { CheckCircle2Icon, XIcon } from 'lucide-react';
import { useEffect } from 'react';

/** Cuánto se ve el aviso antes de irse solo. */
export const DURACION_TOAST_MS = 4000;

interface ToastProps {
  /** El texto del aviso. `null` no muestra nada. */
  mensaje: string | null;
  onCerrar: () => void;
  duracionMs?: number;
}

/**
 * Aviso breve de éxito, abajo a la derecha. Se anuncia a los lectores de pantalla (`role="status"`),
 * se cierra solo y también se puede cerrar a mano. No bloquea ni quita el foco.
 */
export function Toast({ mensaje, onCerrar, duracionMs = DURACION_TOAST_MS }: ToastProps) {
  useEffect(() => {
    if (mensaje === null) return;
    const temporizador = setTimeout(onCerrar, duracionMs);
    return () => clearTimeout(temporizador);
  }, [mensaje, onCerrar, duracionMs]);

  if (mensaje === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-100 flex max-w-sm justify-end"
    >
      <div className="pointer-events-auto flex items-start gap-2 rounded-panel border bg-panel px-4 py-3 text-sm text-foreground shadow-md">
        <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{mensaje}</span>
        <button
          type="button"
          aria-label="Cerrar aviso"
          onClick={onCerrar}
          className="-m-1 ml-1 rounded-chip p-1 text-content-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
