import type { ClienteSubtipoPublico } from '@realpolitik/shared';
import { MapPinIcon, UniversityIcon, UsersIcon, type LucideIcon } from 'lucide-react';

import { etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';

// Los subtipos son todos del sector público: comparten su color (versión de contorno, más
// liviana que el badge de sector) y se distinguen por ícono y texto.
const iconos: Record<ClienteSubtipoPublico, LucideIcon> = {
  MUNICIPAL: MapPinIcon,
  PROVINCIAL_ORGANISMO: UniversityIcon,
  SINDICAL_OBRA_SOCIAL: UsersIcon,
};

interface SubtipoBadgeProps {
  subtipo: ClienteSubtipoPublico;
}

/** Subtipo de un cliente público. */
export function SubtipoBadge({ subtipo }: SubtipoBadgeProps) {
  const Icono = iconos[subtipo];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-sector-publico-border bg-card px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-sector-publico">
      <Icono aria-hidden="true" className="size-3" />
      {etiquetasSubtipo[subtipo]}
    </span>
  );
}
