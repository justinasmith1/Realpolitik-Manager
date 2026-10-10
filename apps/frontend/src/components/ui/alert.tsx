import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';
import type * as React from 'react';

const alertVariants = cva(
  'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm leading-snug duration-200 ease-standard animate-in fade-in-0 slide-in-from-top-1',
  {
    variants: {
      variant: {
        destructive: 'border-destructive-border bg-destructive-soft text-destructive',
        success: 'border-success-border bg-success-soft text-success',
      },
    },
    defaultVariants: { variant: 'destructive' },
  },
);

const iconoDeVariante = {
  destructive: CircleAlertIcon,
  success: CircleCheckIcon,
} as const;

/**
 * Aviso en línea. El error se anuncia como `alert` (interrumpe) y el éxito como `status`
 * (espera su turno). El ícono acompaña al color: el mensaje no depende solo de él.
 */
function Alert({
  className,
  variant = 'destructive',
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  const tipo = variant ?? 'destructive';
  const Icono = iconoDeVariante[tipo];
  return (
    <div
      data-slot="alert"
      role={tipo === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icono aria-hidden="true" className="mt-px size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export { Alert };
