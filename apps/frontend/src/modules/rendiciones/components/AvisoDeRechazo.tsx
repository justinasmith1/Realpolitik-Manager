import { fechaDelPaso, ultimoRechazoPendiente, type RendicionDetalle } from '@realpolitik/shared';

import { Alert } from '@/components/ui/alert';
import { textoDeRechazo } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Los estados en los que el rechazo todavía se está resolviendo: Rechazada, reabierta o completa. */
const ESTADOS_CORRIGIENDO = new Set<RendicionDetalle['estado']>([
  'RECHAZADA',
  'EN_CURSO',
  'COMPLETA',
]);

/**
 * El rechazo que hay que mostrar destacado (HU3.9): el último, si todavía no se reenvió y la
 * rendición está Rechazada, o En curso o Completa mientras se corrige. Una anulada no lo muestra
 * (es historial). `null` si no hay ninguno. Al reenviarla deja de mostrarse: el motivo queda en el
 * historial.
 */
export function rechazoPendienteDe({
  estado,
  vigencia,
  historial,
}: Pick<RendicionDetalle, 'estado' | 'vigencia' | 'historial'>) {
  if (vigencia === 'ANULADA' || !ESTADOS_CORRIGIENDO.has(estado)) return null;
  return ultimoRechazoPendiente(historial);
}

/**
 * "Rechazada el 12/11/2026: <motivo>": lo que pidió corregir el cliente, destacado en el detalle y
 * en el panel de resumen mientras la rendición se corrige (HU3.9). No muestra nada si no hay un
 * rechazo pendiente.
 */
export function AvisoDeRechazo({
  rendicion,
}: {
  rendicion: Pick<RendicionDetalle, 'estado' | 'vigencia' | 'historial'>;
}) {
  const rechazo = rechazoPendienteDe(rendicion);
  if (rechazo === null) return null;
  return (
    <Alert variant="warning">
      <span className="font-medium break-words">
        {textoDeRechazo(fechaDelPaso(rechazo), rechazo.motivo)}
      </span>
    </Alert>
  );
}
