import type { ClienteSector } from '@realpolitik/shared';
import { Building2Icon, LandmarkIcon, type LucideIcon } from 'lucide-react';

import { etiquetasSector } from '@/modules/clientes/clientes.etiquetas';

// Color e ícono de cada sector. Los colores son tokens propios del tema (`sector-*`): no se
// reutilizan los de estado ni el de error. `Record` obliga a cubrir cada sector.
const variantes: Record<ClienteSector, { clase: string; Icono: LucideIcon }> = {
  PUBLICO: {
    clase: 'border-sector-publico-border bg-sector-publico-soft text-sector-publico',
    Icono: LandmarkIcon,
  },
  PRIVADO: {
    clase: 'border-sector-privado-border bg-sector-privado-soft text-sector-privado',
    Icono: Building2Icon,
  },
};

interface SectorBadgeProps {
  sector: ClienteSector;
}

/**
 * Sector del cliente. Color, ícono y texto: la información nunca depende solo del color.
 */
export function SectorBadge({ sector }: SectorBadgeProps) {
  const { clase, Icono } = variantes[sector];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${clase}`}
    >
      <Icono aria-hidden="true" className="size-3" />
      {etiquetasSector[sector]}
    </span>
  );
}
