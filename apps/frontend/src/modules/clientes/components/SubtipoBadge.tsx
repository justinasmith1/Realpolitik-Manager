import type { ClienteSubtipoPublico } from '@realpolitik/shared';

import { etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';

// Cada subtipo tiene su propia tonalidad (tokens `subtipo-*`), distinta de las de los
// sectores. `Record` obliga a cubrir cada subtipo.
const claseDeSubtipo: Record<ClienteSubtipoPublico, string> = {
  MUNICIPAL: 'border-subtipo-municipal-border bg-subtipo-municipal-soft text-subtipo-municipal',
  PROVINCIAL_ORGANISMO:
    'border-subtipo-provincial-border bg-subtipo-provincial-soft text-subtipo-provincial',
  SINDICAL_OBRA_SOCIAL:
    'border-subtipo-sindical-border bg-subtipo-sindical-soft text-subtipo-sindical',
};

interface SubtipoBadgeProps {
  subtipo: ClienteSubtipoPublico;
}

/** Subtipo de un cliente público. */
export function SubtipoBadge({ subtipo }: SubtipoBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${claseDeSubtipo[subtipo]}`}
    >
      {etiquetasSubtipo[subtipo]}
    </span>
  );
}
