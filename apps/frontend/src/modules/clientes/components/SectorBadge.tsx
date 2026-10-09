import type { ClienteSector } from '@realpolitik/shared';

import { etiquetasSector } from '@/modules/clientes/clientes.etiquetas';

// Color de cada sector con tokens del tema. Son colores de marca/neutros: no se reutilizan
// los de estado (éxito, alerta) ni el de error. `Record` obliga a cubrir cada sector.
const claseDeSector: Record<ClienteSector, string> = {
  PUBLICO: 'border-primary bg-primary text-primary-foreground',
  PRIVADO: 'border-border bg-secondary text-secondary-foreground',
};

interface SectorBadgeProps {
  sector: ClienteSector;
}

/**
 * Sector del cliente. El color ayuda a distinguirlo, pero la información la lleva el texto:
 * nunca se comunica solo por color.
 */
export function SectorBadge({ sector }: SectorBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2.25 py-0.5 text-xs font-medium whitespace-nowrap ${claseDeSector[sector]}`}
    >
      {etiquetasSector[sector]}
    </span>
  );
}
