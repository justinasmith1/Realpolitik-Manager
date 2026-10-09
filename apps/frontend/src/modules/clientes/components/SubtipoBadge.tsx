import type { ClienteSubtipoPublico } from '@realpolitik/shared';

import { etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';

interface SubtipoBadgeProps {
  subtipo: ClienteSubtipoPublico;
}

/** Subtipo de un cliente público. Presentación neutra: el texto lo distingue. */
export function SubtipoBadge({ subtipo }: SubtipoBadgeProps) {
  return (
    <span className="inline-flex items-center rounded-pill border border-border bg-panel-alt px-2.25 py-0.5 text-xs font-medium whitespace-nowrap text-content-secondary">
      {etiquetasSubtipo[subtipo]}
    </span>
  );
}
