import { Loader2Icon } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  /** Operación en curso: deshabilita el botón (sin doble envío) y muestra un spinner. */
  loading?: boolean;
  /** Texto mientras `loading`. Si no se pasa, se mantiene el de siempre. */
  loadingText?: string;
};

/**
 * Botón con estado de carga. El texto cambia (p. ej. "Guardando…") pero el ancho no debe
 * saltar: quien lo usa le da un `min-w-*` que alcance para ambos textos.
 */
function LoadingButton({
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}: LoadingButtonProps) {
  return (
    <Button disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2Icon aria-hidden="true" className="animate-spin" />}
      {loading && loadingText !== undefined ? loadingText : children}
    </Button>
  );
}

export { LoadingButton };
