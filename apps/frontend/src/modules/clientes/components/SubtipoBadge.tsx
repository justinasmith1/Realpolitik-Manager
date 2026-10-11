import type { ClienteSubtipoPublico } from '@realpolitik/shared';

import { Badge } from '@/components/ui/badge';
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
    // `title`: con el espacio justo el texto se recorta, y el nombre completo sigue a mano.
    <Badge className={claseDeSubtipo[subtipo]} title={etiquetasSubtipo[subtipo]}>
      {etiquetasSubtipo[subtipo]}
    </Badge>
  );
}
