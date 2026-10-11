import type { Periodicidad } from '@realpolitik/shared';

import { etiquetaDeMes, etiquetasPeriodicidad } from '@/modules/clientes/clientes.etiquetas';

/**
 * Periodicidad en texto y no como badge: la fila ya tiene sector, subtipo y canal como
 * badges. El tipo va arriba y el detalle abajo, en texto secundario como el email.
 */
export function PeriodicidadTexto({ periodicidad }: { periodicidad: Periodicidad | null }) {
  if (periodicidad === null) {
    return <span className="text-content-secondary">Sin configurar</span>;
  }
  const detalle =
    periodicidad.tipo === 'BIMESTRAL'
      ? `Día ${periodicidad.diaLimite} · desde ${etiquetaDeMes(periodicidad.mesInicioCiclo)}`
      : `Día ${periodicidad.diaLimite}`;
  return (
    <div className="flex flex-col whitespace-nowrap">
      <span>{etiquetasPeriodicidad[periodicidad.tipo]}</span>
      <span className="text-xs text-content-secondary">{detalle}</span>
    </div>
  );
}
