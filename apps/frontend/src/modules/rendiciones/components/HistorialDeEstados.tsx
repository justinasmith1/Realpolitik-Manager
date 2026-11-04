import { ETIQUETAS_ESTADO_RENDICION, type HistorialEstadoRendicion } from '@realpolitik/shared';
import { useId } from 'react';

import { EstadoRendicionBadge } from '@/modules/rendiciones/components/EstadoRendicionBadge';
import { fechaCorta } from '@/modules/rendiciones/rendiciones.etiquetas';

interface HistorialDeEstadosProps {
  /** Del cambio más viejo al más nuevo, como lo devuelve la API. */
  historial: readonly HistorialEstadoRendicion[];
}

/**
 * Los cambios de estado de una rendición (HU3.1), con su fecha (dd/mm/aaaa, horario de Buenos
 * Aires): cada uno con el estado nuevo y, salvo el primero (el alta), el anterior. Es una lista
 * ordenada: se lee en el orden en que pasaron.
 */
export function HistorialDeEstados({ historial }: HistorialDeEstadosProps) {
  const idTitulo = useId();
  return (
    <section aria-labelledby={idTitulo} className="flex flex-col gap-1.5">
      <h2 id={idTitulo} className="text-sm font-semibold text-foreground">
        Historial
      </h2>
      <ol className="flex flex-col gap-1 text-sm">
        {historial.map(({ estadoAnterior, estadoNuevo, fecha }) => (
          // Las entradas no traen id: la fecha y el estado nuevo alcanzan para distinguirlas.
          <li
            key={`${fecha.toISOString()}-${estadoNuevo}`}
            className="flex flex-wrap items-center gap-2"
          >
            <time
              dateTime={fecha.toISOString()}
              className="font-mono text-xs text-content-secondary"
            >
              {fechaCorta(fecha)}
            </time>
            <span className="text-content-secondary">
              {estadoAnterior === null
                ? 'Se abrió en'
                : `De ${ETIQUETAS_ESTADO_RENDICION[estadoAnterior]} a`}
            </span>
            <EstadoRendicionBadge estado={estadoNuevo} />
          </li>
        ))}
      </ol>
    </section>
  );
}
