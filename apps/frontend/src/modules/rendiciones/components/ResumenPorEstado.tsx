import type { EstadoRendicionType } from '@realpolitik/shared';
import { cn } from 'cn';

import {
  rellenoDeEstado,
  seleccionDeEstado,
  textoDeEstado,
} from '@/modules/rendiciones/estadoRendicion.colores';
import { ESTADOS_DE_RENDICION } from '@/modules/rendiciones/rendicionesDelMes.filtros';

/** El título de cada tarjeta, en plural. */
const TITULO_DE_TARJETA: Record<EstadoRendicionType, string> = {
  EN_CURSO: 'En curso',
  COMPLETA: 'Completas',
  ENVIADA: 'Enviadas',
  APROBADA: 'Aprobadas',
  RECHAZADA: 'Rechazadas',
};

interface ResumenPorEstadoProps {
  /** Cuántas rendiciones del mes hay en cada estado: todas, sin mirar los filtros. */
  conteo: Record<EstadoRendicionType, number>;
  /** El estado filtrado, si hay uno: su tarjeta se ve seleccionada. */
  activo: EstadoRendicionType | undefined;
  /** Tocar una tarjeta aplica su estado; tocar la activa lo quita. */
  onElegir: (estado: EstadoRendicionType) => void;
}

/**
 * Las tarjetas de resumen de la pantalla Rendiciones (HU3.3): una por estado, con la cantidad del
 * mes en grande y el punto en el color del estado, sin íconos. Son el filtro por estado: botones de
 * alternancia (`aria-pressed`); tocar una filtra y tocarla de nuevo lo quita. La activa lleva fondo
 * suave y borde en su color; las demás se atenúan. Cinco en una fila; en pantallas angostas, en
 * dos o tres columnas.
 */
export function ResumenPorEstado({ conteo, activo, onElegir }: ResumenPorEstadoProps) {
  return (
    <div
      role="group"
      aria-label="Resumen por estado"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {ESTADOS_DE_RENDICION.map((estado) => {
        const seleccionada = estado === activo;
        // Con un estado activo, las demás se atenúan, pero siguen clickeables y con su cantidad.
        const atenuada = activo !== undefined && !seleccionada;
        return (
          <button
            key={estado}
            type="button"
            aria-pressed={seleccionada}
            onClick={() => onElegir(estado)}
            className={cn(
              'flex cursor-pointer flex-col items-start gap-1.5 rounded-card border bg-card px-4 py-3.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30',
              seleccionada ? seleccionDeEstado[estado] : 'hover:bg-panel-alt',
              atenuada && 'opacity-60 hover:opacity-100 focus-visible:opacity-100',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span
                aria-hidden="true"
                className={cn('size-2 rounded-full', rellenoDeEstado[estado])}
              />
              {TITULO_DE_TARJETA[estado]}
            </span>
            <span
              className={cn(
                'text-3xl leading-none font-semibold tabular-nums',
                textoDeEstado[estado],
              )}
            >
              {conteo[estado]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
