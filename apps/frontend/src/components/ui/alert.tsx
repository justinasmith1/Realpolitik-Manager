import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { CircleAlertIcon, CircleCheckIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import type * as React from 'react';

const alertVariants = cva(
  'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-snug duration-200 ease-standard',
  {
    variants: {
      variant: {
        destructive: 'border-destructive-border bg-destructive-soft text-destructive',
        success: 'border-success-border bg-success-soft text-success',
        warning: 'border-warning bg-warning-soft text-foreground',
      },
    },
    defaultVariants: { variant: 'destructive' },
  },
);

const iconoDeVariante = {
  destructive: CircleAlertIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
} as const;

/**
 * Aviso en línea. El error se anuncia como `alert` (interrumpe) y el éxito como `status`
 * (espera su turno). El ícono acompaña al color: el mensaje no depende solo de él.
 *
 * Con `onCerrar`, muestra un botón chico para descartarlo. Con `saliendo`, se retira con la
 * misma animación de la entrada, al revés (fundido y 4 px hacia arriba); quien lo usa lo quita
 * al terminar (`onAnimationEnd`). Con movimiento reducido, la animación es instantánea.
 */
function Alert({
  className,
  variant = 'destructive',
  children,
  onCerrar,
  saliendo = false,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    onCerrar?: (() => void) | undefined;
    saliendo?: boolean | undefined;
  }) {
  const tipo = variant ?? 'destructive';
  const Icono = iconoDeVariante[tipo];
  return (
    <div
      data-slot="alert"
      role={tipo === 'destructive' ? 'alert' : 'status'}
      data-saliendo={saliendo || undefined}
      className={cn(
        alertVariants({ variant }),
        // `forwards`: termina invisible y así sigue hasta que lo quitan, sin un cuadro de más.
        saliendo
          ? 'animate-out fade-out-0 slide-out-to-top-1 fill-mode-forwards'
          : 'animate-in fade-in-0 slide-in-from-top-1',
        className,
      )}
      {...props}
    >
      <Icono aria-hidden="true" className="mt-px size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onCerrar !== undefined && (
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar aviso"
          className="-my-0.5 -mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:bg-current/10 hover:opacity-100 focus-visible:opacity-100"
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export { Alert };
