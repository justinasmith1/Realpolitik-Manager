import type { ClienteEstado } from '@realpolitik/shared';

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
  return (
    <span className="inline-flex items-center rounded-pill border border-dashed bg-muted px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-muted-foreground">
      {textoDeEstado[estado]}
    </span>
  );
}
