import type { ClienteEstado } from '@realpolitik/shared';

import { Badge } from '@/components/ui/badge';

// Texto de cada estado como badge (con mayúscula inicial; `etiquetasEstado` es para oraciones).
// `Record` obliga a cubrir cada estado del enum compartido.
const textoDeEstado: Record<ClienteEstado, string> = {
  ACTIVO: 'Activo',
  INACTIVO: 'Inactivo',
  SUSPENDIDO: 'Suspendido',
};

interface EstadoBadgeProps {
  estado: ClienteEstado;
}

/**
 * Estado del cliente. Estilo apagado y borde punteado: es el aviso de que la cuenta no está
 * operativa, sin competir en color con sector y subtipo. La información la lleva el texto.
 */
export function EstadoBadge({ estado }: EstadoBadgeProps) {
  return <Badge tone="muted">{textoDeEstado[estado]}</Badge>;
}
