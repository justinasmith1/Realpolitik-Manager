import { cn } from 'cn';
import { CheckIcon, Loader2Icon } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';

type LoadingButtonProps = React.ComponentProps<typeof Button> & {
  /** Operación en curso: bloquea el botón (sin doble envío) y muestra un spinner. */
  loading?: boolean;
  /** Texto mientras `loading`. Si no se pasa, se mantiene el de siempre. */
  loadingText?: string;
  /**
   * La operación salió bien: check y tinte verde, bloqueado. Es un estado breve, no una
   * variante: quien lo usa lo apaga (ver `useExitoBreve`). Si llega junto con `loading`, gana.
   */
  success?: boolean;
  /** Texto mientras `success`. Si no se pasa, se mantiene el de siempre. */
  successText?: string;
};

/**
 * Botón con estado de carga y de éxito breve. El texto cambia (p. ej. "Guardando…", "Guardado")
 * pero el ancho no debe saltar: quien lo usa le da un `min-w-*` que alcance para todos los textos.
 *
 * Mientras carga o confirma, el botón queda bloqueado pero enfocable (`aria-disabled`, sin
 * `disabled` nativo): no pierde el foco ni se atenúa como un botón deshabilitado. Un `disabled`
 * que llega de afuera (p. ej. "sin cambios") sigue siendo el nativo de siempre.
 */
function LoadingButton({
  loading = false,
  loadingText,
  success = false,
  successText,
  disabled,
  focusableWhenDisabled,
  className,
  children,
  ...props
}: LoadingButtonProps) {
  const ocupado = loading || success;
  const cargando = loading && !success;
  return (
    <Button
      disabled={disabled || ocupado}
      focusableWhenDisabled={focusableWhenDisabled || ocupado}
      aria-busy={cargando || undefined}
      data-success={success || undefined}
      className={cn(
        // Sin hover ni active mientras está ocupado, como un `disabled` nativo.
        ocupado && 'pointer-events-none',
        'data-success:border-success-border data-success:bg-success-soft data-success:text-success data-success:shadow-none',
        className,
      )}
      {...props}
    >
      {success ? (
        <>
          <CheckIcon aria-hidden="true" />
          {successText ?? children}
        </>
      ) : cargando ? (
        <>
          <Loader2Icon aria-hidden="true" className="animate-spin" />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export { LoadingButton };
