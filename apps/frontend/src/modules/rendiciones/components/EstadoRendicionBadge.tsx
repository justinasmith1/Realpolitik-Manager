import { ETIQUETAS_ESTADO_RENDICION, type EstadoRendicionType } from '@realpolitik/shared';

import { Badge } from '@/components/ui/badge';

// Color de cada estado, con tokens propios del tema (`estado-*`), los mismos en todo el sistema.
// No reutilizan los de error ni los de clasificación, y ninguno es rojo: queda para la marca de
// Atrasada (HU3.4). `Record` obliga a cubrir cada estado.
const claseDeEstado: Record<EstadoRendicionType, string> = {
  EN_CURSO: 'border-estado-en-curso-border bg-estado-en-curso-soft text-estado-en-curso',
  COMPLETA: 'border-estado-completa-border bg-estado-completa-soft text-estado-completa',
  ENVIADA: 'border-estado-enviada-border bg-estado-enviada-soft text-estado-enviada',
  APROBADA: 'border-estado-aprobada-border bg-estado-aprobada-soft text-estado-aprobada',
  RECHAZADA: 'border-estado-rechazada-border bg-estado-rechazada-soft text-estado-rechazada',
};

interface EstadoRendicionBadgeProps {
  estado: EstadoRendicionType;
}

/**
 * En qué paso está una rendición (HU3.1). Solo color y texto, sin íconos: el color ayuda a
 * distinguirlo, pero la información la lleva el texto.
 */
export function EstadoRendicionBadge({ estado }: EstadoRendicionBadgeProps) {
  return <Badge className={claseDeEstado[estado]}>{ETIQUETAS_ESTADO_RENDICION[estado]}</Badge>;
}
