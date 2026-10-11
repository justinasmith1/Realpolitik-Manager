import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type * as React from 'react';

/**
 * Base común de las etiquetas de estado/clasificación: misma altura, radio, tipografía y
 * relleno. Los colores se eligen con `tone` (neutro o apagado) o, para la clasificación del
 * dominio, con las clases de los tokens `sector-*` / `subtipo-*` vía `className`.
 *
 * Todas llevan texto: el color nunca es el único canal. `layout="text"` recorta con elipsis
 * si no entra; `layout="icon"` admite un ícono decorativo antes del texto.
 */
const badgeVariants = cva('h-6 max-w-full rounded-pill border px-2.5 text-xs font-semibold', {
  variants: {
    layout: {
      text: 'inline-block truncate align-middle leading-[22px]',
      icon: 'inline-flex items-center gap-1.5 whitespace-nowrap',
    },
    tone: {
      none: '',
      neutral: 'border-border bg-muted text-foreground',
      /** Cuenta no operativa: apagado y con borde punteado, sin el rojo del error. */
      muted: 'border-dashed bg-muted text-muted-foreground',
    },
  },
  defaultVariants: { layout: 'text', tone: 'none' },
});

function Badge({
  className,
  layout,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ layout, tone }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
