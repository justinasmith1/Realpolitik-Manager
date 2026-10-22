import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EstadoTipoDocumentoBadgeProps {
  activo: boolean;
}

/**
 * Estado de un tipo de documento. La información la lleva el texto ("Activo" / "Desactivado");
 * el punto de color es decorativo. Activo usa los tokens de éxito; desactivado, el tono apagado
 * de los badges (el mismo de un cliente inactivo), sin bajar el contraste del texto.
 * Es solo lectura: el estado se cambia desde las acciones del tipo, no desde el badge.
 */
export function EstadoTipoDocumentoBadge({ activo }: EstadoTipoDocumentoBadgeProps) {
  return (
    <Badge
      layout="icon"
      tone={activo ? 'none' : 'muted'}
      className={cn(activo && 'border-success-border bg-success-soft text-success')}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', activo ? 'bg-success' : 'bg-muted-foreground')}
      />
      {activo ? 'Activo' : 'Desactivado'}
    </Badge>
  );
}
