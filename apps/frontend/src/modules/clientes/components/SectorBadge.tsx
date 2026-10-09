import type { ClienteSector } from '@realpolitik/shared';

import { etiquetasSector } from '@/modules/clientes/clientes.etiquetas';

// Color de cada sector, con tokens propios del tema (`sector-*`): no se reutilizan los de
// estado ni el de error. `Record` obliga a cubrir cada sector.
const claseDeSector: Record<ClienteSector, string> = {
  PUBLICO: 'border-sector-publico-border bg-sector-publico-soft text-sector-publico',
  PRIVADO: 'border-sector-privado-border bg-sector-privado-soft text-sector-privado',
};

interface SectorBadgeProps {
  sector: ClienteSector;
}

/** Sector del cliente. El color ayuda a distinguirlo, pero la información la lleva el texto. */
export function SectorBadge({ sector }: SectorBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${claseDeSector[sector]}`}
    >
      {etiquetasSector[sector]}
    </span>
  );
}
