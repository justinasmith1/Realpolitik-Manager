import { Badge } from '@/components/ui/badge';

interface ItemReunidoBadgeProps {
  reunido: boolean;
  /**
   * Cómo se ve un pendiente: ámbar suave en el checklist del detalle, donde hay que resolverlo, o
   * beige cálido (token `seleccion`) en el panel de resumen (HU3.5), que es de solo lectura.
   */
  pendiente?: 'ambar' | 'calido';
}

/**
 * Si un ítem del checklist ya está reunido (verde suave) o sigue pendiente, siempre con el texto.
 * La usan el checklist del detalle y el panel de resumen (HU3.5).
 */
export function ItemReunidoBadge({ reunido, pendiente = 'ambar' }: ItemReunidoBadgeProps) {
  if (reunido) {
    return <Badge className="border-success-border bg-success-soft text-success">Reunido</Badge>;
  }
  return pendiente === 'ambar' ? (
    <Badge className="border-warning bg-warning-soft text-foreground">Pendiente</Badge>
  ) : (
    <Badge className="border-seleccion-riel bg-seleccion text-foreground">Pendiente</Badge>
  );
}
