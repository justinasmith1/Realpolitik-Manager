import type { ClienteSector } from '@realpolitik/shared';

// Texto visible de cada sector. `Record` obliga a cubrir todos los valores de ClienteSector:
// si shared agrega uno, esto deja de compilar hasta que tenga etiqueta.
const etiquetas: Record<ClienteSector, string> = {
  PUBLICO: 'Público',
  PRIVADO: 'Privado',
};

interface SectorBadgeProps {
  sector: ClienteSector;
}

/**
 * Sector del cliente. Se distingue por el texto, no por el color: el sector no es un
 * estado (éxito/alerta/error), así que ambos valores usan la presentación neutral del
 * handoff (la de "sin tipología"). El handoff colorea por tipología (municipio, organismo
 * provincial), que son subtipos públicos que este componente todavía no representa.
 */
export function SectorBadge({ sector }: SectorBadgeProps) {
  return (
    <span className="inline-flex items-center rounded-pill border border-border bg-panel-alt px-2.25 py-0.5 text-xs font-medium whitespace-nowrap text-content-secondary">
      {etiquetas[sector]}
    </span>
  );
}
