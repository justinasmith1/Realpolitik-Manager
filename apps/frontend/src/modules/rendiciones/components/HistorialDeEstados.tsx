import { fechaDelPaso, type HistorialEstadoRendicion } from '@realpolitik/shared';
import { ChevronRightIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';
import { EstadoRendicionBadge } from '@/modules/rendiciones/components/EstadoRendicionBadge';
import { fechaCorta, verboDelPaso } from '@/modules/rendiciones/rendiciones.etiquetas';

interface HistorialDeEstadosProps {
  /** Del cambio más viejo al más nuevo, como lo devuelve la API. */
  historial: readonly HistorialEstadoRendicion[];
}

/**
 * Los cambios de estado de una rendición (HU3.1): cada uno con su fecha (dd/mm/aaaa, Buenos Aires;
 * en el envío, la fecha de envío elegida, HU3.7) y un verbo según el estado nuevo ("Pasó a
 * Completa"), sin repetir el anterior. Es un toggle: cerrado solo dice "Historial (N)" (el estado
 * actual ya está en la línea de Estado); toda la fila abre y cierra la lista. No se recuerda entre
 * visitas.
 */
export function HistorialDeEstados({ historial }: HistorialDeEstadosProps) {
  const idTitulo = useId();
  const idLista = useId();
  const [abierto, setAbierto] = useState(false);

  return (
    <section aria-labelledby={idTitulo} className="flex flex-col gap-1.5">
      <h2 className="text-sm">
        <button
          type="button"
          aria-expanded={abierto}
          aria-controls={idLista}
          onClick={() => setAbierto((actual) => !actual)}
          className="-mx-1 flex min-h-11 items-center gap-1 rounded-md px-1 font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 md:min-h-7"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              'size-4 text-content-secondary transition-transform duration-150 motion-reduce:transition-none',
              abierto && 'rotate-90',
            )}
          />
          <span id={idTitulo}>Historial</span>{' '}
          <span className="font-normal text-content-secondary">({historial.length})</span>
        </button>
      </h2>
      <ol id={idLista} hidden={!abierto} className="flex flex-col gap-1 pl-5 text-sm">
        {historial.map((paso) => (
          // Las entradas no traen id: la fecha y el estado nuevo alcanzan para distinguirlas.
          <li
            key={`${paso.fecha.toISOString()}-${paso.estadoNuevo}`}
            className="flex flex-wrap items-center gap-2"
          >
            <time
              dateTime={paso.fechaEfectiva ?? paso.fecha.toISOString()}
              className="font-mono text-xs text-content-secondary"
            >
              {fechaCorta(fechaDelPaso(paso))}
            </time>
            <span className="text-content-secondary">{verboDelPaso(paso)}</span>
            <EstadoRendicionBadge estado={paso.estadoNuevo} />
            {/* Lo que pidió corregir el cliente (HU3.8), debajo del paso. */}
            {paso.motivo !== undefined && paso.motivo !== null && paso.motivo.trim() !== '' && (
              <p className="basis-full pl-1 text-sm text-content-secondary">{paso.motivo}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
