import type { CanalEntrega } from '@realpolitik/shared';
import { GlobeIcon, MailIcon, MessageCircleIcon, type LucideIcon } from 'lucide-react';

import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';

// Ícono de cada canal. `Record` obliga a cubrir cada canal: si shared agrega uno, esto deja
// de compilar hasta que tenga su ícono. Lucide no incluye logos de marcas, así que WhatsApp
// usa el globo de mensaje (el reconocible "burbuja de chat").
const iconoDeCanal: Record<CanalEntrega, LucideIcon> = {
  CORREO: MailIcon,
  PORTAL_WEB: GlobeIcon,
  WHATSAPP: MessageCircleIcon,
};

interface CanalEntregaBadgeProps {
  canal: CanalEntrega;
}

/**
 * Canal de entrega habitual del cliente. Estilo neutro a propósito: el color ya
 * distingue sector y subtipo en la misma fila. El ícono es decorativo; la información la
 * lleva el texto.
 */
export function CanalEntregaBadge({ canal }: CanalEntregaBadgeProps) {
  const Icono = iconoDeCanal[canal];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border bg-muted px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-foreground">
      <Icono aria-hidden="true" className="size-3.5" />
      {etiquetasCanalEntrega[canal]}
    </span>
  );
}
