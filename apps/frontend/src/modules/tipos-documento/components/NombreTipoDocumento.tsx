import type { TipoDocumento } from '@realpolitik/shared';

import { cn } from '@/lib/utils';

interface NombreTipoDocumentoProps {
  tipo: TipoDocumento;
  onEditar: (tipo: TipoDocumento) => void;
  className?: string;
}

/**
 * El nombre de un tipo, como botón que abre su edición (en la tabla y en las tarjetas). Solo el
 * nombre es interactivo, no la fila entera: así no compite con el menú ⋯. Su nombre accesible es
 * el del tipo; `aria-haspopup` anuncia que abre un panel.
 */
export function NombreTipoDocumento({ tipo, onEditar, className }: NombreTipoDocumentoProps) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onEditar(tipo)}
      className={cn(
        'rounded-chip text-left leading-snug break-words underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30',
        className,
      )}
    >
      <span>{tipo.nombre}</span>
    </button>
  );
}
