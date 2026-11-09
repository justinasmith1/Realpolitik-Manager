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
  /**
   * HU3.4: cuántas atrasadas hay en total, de cualquier mes y sin mirar los filtros. `undefined`
   * mientras se cargan (o si no se pudieron cargar): la tarjeta muestra una raya.
   */
  atrasadas: number | undefined;
  /** La vista de atrasadas está activa: su tarjeta se ve seleccionada. */
  vistaAtrasadas: boolean;
  /** Tocar la tarjeta Atrasadas entra a su vista; tocarla de nuevo vuelve al mes. */
  onAtrasadas: () => void;
}

const TARJETA =
  'flex cursor-pointer flex-col items-start gap-1.5 rounded-card border bg-card px-4 py-3.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30';
const ATENUADA = 'opacity-60 hover:opacity-100 focus-visible:opacity-100';
const NUMERO = 'text-3xl leading-none font-semibold tabular-nums';

/**
 * Las tarjetas de resumen de la pantalla Rendiciones (HU3.3): una por estado, con la cantidad del
 * mes en grande y el punto en el color del estado, sin íconos. Son el filtro por estado: botones de
 * alternancia (`aria-pressed`); tocar una filtra y tocarla de nuevo lo quita. La activa lleva fondo
 * suave y borde en su color; las demás se atenúan.
 *
 * HU3.4: una sexta tarjeta, Atrasadas, con el total de atrasadas de cualquier mes, en rojo (el único
 * rojo de la pantalla; con 0, en un tono neutro). Tocarla entra a la vista de atrasadas, donde
 * ninguna tarjeta de estado queda activa. Seis en una fila; en pantallas angostas, dos o tres
 * columnas.
 */
export function ResumenPorEstado({
  conteo,
  activo,
  onElegir,
  atrasadas,
  vistaAtrasadas,
  onAtrasadas,
}: ResumenPorEstadoProps) {
  const hayAtrasadas = atrasadas !== undefined && atrasadas > 0;
  // Con una tarjeta activa (un estado o Atrasadas), las demás se atenúan.
  const hayActiva = activo !== undefined || vistaAtrasadas;
  return (
    <div
      role="group"
      aria-label="Resumen por estado"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
    >
      {ESTADOS_DE_RENDICION.map((estado) => {
        const seleccionada = estado === activo;
        // Atenuadas, siguen clickeables y con su cantidad.
        const atenuada = hayActiva && !seleccionada;
        return (
          <button
            key={estado}
            type="button"
            aria-pressed={seleccionada}
            onClick={() => onElegir(estado)}
            className={cn(
              TARJETA,
              seleccionada ? seleccionDeEstado[estado] : 'hover:bg-panel-alt',
              atenuada && ATENUADA,
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span
                aria-hidden="true"
                className={cn('size-2 rounded-full', rellenoDeEstado[estado])}
              />
              {TITULO_DE_TARJETA[estado]}
            </span>
            <span className={cn(NUMERO, textoDeEstado[estado])}>{conteo[estado]}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={vistaAtrasadas}
        onClick={onAtrasadas}
        className={cn(
          TARJETA,
          vistaAtrasadas
            ? 'border-atrasada bg-atrasada-soft ring-1 ring-atrasada'
            : 'hover:bg-panel-alt',
          hayActiva && !vistaAtrasadas && ATENUADA,
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span
            aria-hidden="true"
            className={cn(
              'size-2 rounded-full',
              hayAtrasadas ? 'bg-atrasada' : 'bg-muted-foreground',
            )}
          />
          Atrasadas
        </span>
        <span className={cn(NUMERO, hayAtrasadas ? 'text-atrasada' : 'text-content-secondary')}>
          {atrasadas ?? '–'}
        </span>
      </button>
    </div>
  );
}
