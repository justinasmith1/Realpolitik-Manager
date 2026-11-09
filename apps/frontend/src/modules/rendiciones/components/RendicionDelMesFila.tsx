import { ETIQUETAS_ESTADO_RENDICION, type RendicionDelMes } from '@realpolitik/shared';
import { cn } from 'cn';
import { ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';

import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';
import {
  fondoDeEstado,
  rellenoDeEstado,
  textoDeEstado,
} from '@/modules/rendiciones/estadoRendicion.colores';
import {
  diaYMes,
  etiquetaDePeriodo,
  textoDePendientes,
  tipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import { rutaDeRendicion } from '@/modules/rendiciones/rendiciones.rutas';

interface RendicionDelMesFilaProps {
  rendicion: RendicionDelMes;
  /**
   * El período de la rendición, para mostrarlo junto a la marca de atrasada. Solo en la vista de
   * atrasadas (HU3.4), donde el listado junta meses distintos.
   */
  periodo?: { anio: number; mes: number } | undefined;
}

/**
 * Una rendición de la pantalla Rendiciones (HU3.2), como una fila de la tarjeta del listado:
 *
 * - a la izquierda, el monograma en el color del estado; en la primera línea, el cliente y la
 *   factura; en la segunda, el tipo de cliente, los pendientes y el estado (texto en su color);
 * - a la derecha, la barra de avance, el porcentaje, la fecha del último paso (si ya salió hacia el
 *   organismo) y una flecha, que es solo un indicador.
 *
 * Toda la fila es un único enlace al detalle, así que se abre tocando cualquier parte, flecha
 * incluida. Su nombre es el cliente y la factura (distingue dos del mismo cliente); el resto se
 * anuncia como descripción. Por debajo de `lg` (1024px) la parte derecha baja debajo del
 * cliente: con la barra lateral abierta, el contenido es bastante más angosto que la ventana.
 */
export function RendicionDelMesFila({ rendicion, periodo }: RendicionDelMesFilaProps) {
  const { cliente, avance, ultimoPaso, estado } = rendicion;
  // HU3.4: en el lugar de la fecha, "Atrasada" (o "Atrasada · Septiembre 2026" en su vista). Las
  // atrasadas están sin enviar, así que no tienen fecha de último paso.
  const marca = rendicion.atrasada
    ? `Atrasada${periodo === undefined ? '' : ` · ${etiquetaDePeriodo(periodo)}`}`
    : null;
  const fecha =
    ultimoPaso === null
      ? null
      : `${ETIQUETAS_ESTADO_RENDICION[ultimoPaso.estado]} ${diaYMes(ultimoPaso.fecha)}`;
  const porcentaje = avance.total === 0 ? 0 : Math.round((avance.reunidos / avance.total) * 100);
  const idDescripcion = useId();

  return (
    <article>
      <Link
        to={rutaDeRendicion(rendicion.clienteId, rendicion.id)}
        aria-label={`${cliente.denominacion}, factura ${rendicion.numeroFactura}`}
        aria-describedby={idDescripcion}
        className="group flex flex-col gap-x-5 gap-y-2.5 px-4 py-4 transition-colors outline-none hover:bg-panel-alt focus-visible:bg-panel-alt focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:ring-inset lg:flex-row lg:items-center lg:px-5"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <ClienteMonogram
            nombre={cliente.denominacion}
            className={cn(
              'size-10 rounded-full text-xs',
              fondoDeEstado[estado],
              textoDeEstado[estado],
            )}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <h3 className="text-[0.9375rem] font-semibold text-foreground">
                {cliente.denominacion}
              </h3>
              <span className="font-mono text-xs whitespace-nowrap text-content-secondary">
                {rendicion.numeroFactura}
              </span>
            </div>
            {/* Siempre en una línea: si no entra, se recorta solo el tipo de cliente (con el texto
                completo en el title); los pendientes y el estado se ven siempre completos. */}
            <p className="flex min-w-0 text-[0.8125rem] whitespace-nowrap text-content-secondary">
              <span className="min-w-0 truncate" title={tipoDeCliente(cliente)}>
                {tipoDeCliente(cliente)}
              </span>
              <span className="shrink-0">
                {/* Espacio duro: el común se pierde al principio de un hijo flex. */}
                {' · '}
                {textoDePendientes(avance.faltantes)}
                {' · '}
                <span className={cn('font-semibold', textoDeEstado[estado])}>
                  {ETIQUETAS_ESTADO_RENDICION[estado]}
                </span>
              </span>
            </p>
          </div>
        </div>

        {/* Apilada (debajo de `lg`), alineada con el texto del cliente (monograma de 2.5rem + gap). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-13.5 lg:shrink-0 lg:flex-nowrap lg:pl-0">
          <div
            role="progressbar"
            aria-label={`Avance de ${cliente.denominacion}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={porcentaje}
            // De ancho fijo desde `lg`; apilada, ocupa el espacio que queda.
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-muted lg:w-30 lg:flex-none"
          >
            <div
              className={cn('h-full rounded-pill', rellenoDeEstado[estado])}
              style={{ width: `${porcentaje}%` }}
            />
          </div>
          <span
            className={cn(
              'w-11 text-right text-[0.8125rem] font-semibold tabular-nums',
              textoDeEstado[estado],
            )}
          >
            {porcentaje}%
          </span>
          {/* Ancho mínimo en escritorio, a la derecha, para que las barras queden alineadas. Con el
              mes (vista de atrasadas), más ancho; y apilada, en su propia línea, debajo de la barra. */}
          <span
            className={cn(
              'text-[0.8125rem] whitespace-nowrap',
              periodo === undefined
                ? 'text-right lg:min-w-28'
                : 'order-last w-full lg:order-none lg:w-auto lg:min-w-44 lg:text-right',
              marca === null ? 'text-content-secondary' : 'font-semibold text-atrasada',
            )}
          >
            {marca ?? fecha}
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-content-secondary transition-transform group-hover:translate-x-0.5"
          />
        </div>
        {/* Solo para la descripción del enlace: la segunda línea, el avance y la fecha, como frase. */}
        <span id={idDescripcion} hidden>
          {`${tipoDeCliente(cliente)} · ${textoDePendientes(avance.faltantes)} · ${ETIQUETAS_ESTADO_RENDICION[estado]}. Avance ${porcentaje} %`}
          {(marca ?? fecha) !== null && `, ${marca ?? fecha}`}
        </span>
      </Link>
    </article>
  );
}
