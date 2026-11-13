import { ETIQUETAS_ESTADO_RENDICION, type RendicionDelMes } from '@realpolitik/shared';
import { cn } from 'cn';
import { BadgeCheckIcon, ChevronRightIcon } from 'lucide-react';
import { useId } from 'react';
import { Link, type To } from 'react-router';

import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';
import {
  fondoDeEstado,
  rellenoDeEstado,
  textoDeEstado,
} from '@/modules/rendiciones/estadoRendicion.colores';
import {
  etiquetaDePeriodo,
  textoDeCobroCorto,
  textoDePendientes,
  textoDeUltimoPaso,
  tipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface RendicionDelMesFilaProps {
  rendicion: RendicionDelMes;
  /**
   * El período de la rendición, para mostrarlo junto a la marca de atrasada. Solo en la vista de
   * atrasadas (HU3.4), donde el listado junta meses distintos.
   */
  periodo?: { anio: number; mes: number } | undefined;
  /** Adónde lleva la fila: la misma pantalla con su panel de resumen abierto (HU3.5). */
  destino: To;
  /** Es la rendición abierta en el panel: la fila queda marcada. */
  abierta: boolean;
}

/** "✓ Cobrada 12/11": éxito con ícono y texto (el color nunca es el único canal). Sin fondo ni borde. */
function MarcaDeCobro({
  texto,
  className,
  ...resto
}: {
  texto: string;
  className: string;
  title?: string;
  'data-cobro': 'linea' | 'columna';
}) {
  return (
    <span
      {...resto}
      className={cn(
        'inline-flex items-center gap-1 font-semibold whitespace-nowrap text-success',
        className,
      )}
    >
      <BadgeCheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{texto}</span>
    </span>
  );
}

/**
 * Una rendición de la pantalla Rendiciones (HU3.2), como una fila de la tarjeta del listado:
 *
 * - a la izquierda, el monograma en el color del estado; en la primera línea, el cliente y la
 *   factura; en la segunda, el tipo de cliente, los pendientes y el estado (texto en su color);
 * - a la derecha, la barra de avance, el porcentaje, una columna de ancho fijo con la fecha del
 *   último paso (si ya salió hacia el organismo) y, debajo, "✓ Cobrada dd/mm" (HU3.10), y una
 *   flecha, que es solo un indicador. La alineación entre filas la da esa columna fija.
 *
 * Toda la fila es un único enlace que abre el panel de resumen de la rendición (HU3.5), así que se
 * abre tocando cualquier parte, flecha incluida; la abierta queda marcada (`aria-current`). Su
 * nombre es el cliente y la factura (distingue dos del mismo cliente); el resto se anuncia como
 * descripción.
 *
 * Si el listado tiene menos de 46rem de ancho, la parte derecha baja debajo del cliente y la marca de
 * cobrada vuelve a la segunda línea de la izquierda (donde, si no entra, se recorta). Se mide
 * el listado (container query), no la ventana: con la barra lateral abierta o con el panel de
 * resumen al costado, el listado es bastante más angosto que la ventana.
 */
export function RendicionDelMesFila({
  rendicion,
  periodo,
  destino,
  abierta,
}: RendicionDelMesFilaProps) {
  const { cliente, avance, ultimoPaso, estado, cobro } = rendicion;
  // HU3.10: el cliente informó el pago. Una marca aparte del estado, con el día del cobro.
  const cobrada = cobro === null ? null : textoDeCobroCorto(cobro.fecha);
  // HU3.4: en el lugar de la fecha, "Atrasada" (o "Atrasada · Septiembre 2026" en su vista). Las
  // atrasadas están sin enviar, así que no tienen fecha de último paso.
  const marca = rendicion.atrasada
    ? `Atrasada${periodo === undefined ? '' : ` · ${etiquetaDePeriodo(periodo)}`}`
    : null;
  const fecha = ultimoPaso === null ? null : textoDeUltimoPaso(ultimoPaso);
  const porcentaje = avance.total === 0 ? 0 : Math.round((avance.reunidos / avance.total) * 100);
  const idDescripcion = useId();

  return (
    <article>
      <Link
        to={destino}
        preventScrollReset
        aria-current={abierta ? 'true' : undefined}
        data-rendicion-id={rendicion.id}
        aria-label={`${cliente.denominacion}, factura ${rendicion.numeroFactura}`}
        aria-describedby={idDescripcion}
        className="group flex flex-col gap-x-5 gap-y-2.5 px-4 py-4 transition-colors outline-none hover:bg-panel-alt focus-visible:bg-panel-alt focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:ring-inset aria-[current]:bg-seleccion @min-[46rem]:flex-row @min-[46rem]:items-center @min-[46rem]:px-5"
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
              <span className="min-w-0 shrink-[5] truncate" title={tipoDeCliente(cliente)}>
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
              {/* Solo con el listado angosto: ancho, la marca va en la columna derecha, bajo la fecha.
                  Es lo primero que se recorta (con el texto completo en el title). */}
              {cobrada !== null && (
                <MarcaDeCobro
                  data-cobro="linea"
                  texto={cobrada}
                  title={cobrada}
                  className="ml-1 min-w-0 truncate align-top @min-[46rem]:hidden"
                />
              )}
            </p>
          </div>
        </div>

        {/* Apilada (listado angosto), alineada con el texto del cliente (monograma de 2.5rem + gap). */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-13.5 @min-[46rem]:shrink-0 @min-[46rem]:flex-nowrap @min-[46rem]:pl-0">
          <div
            role="progressbar"
            aria-label={`Avance de ${cliente.denominacion}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={porcentaje}
            // De ancho fijo con el listado ancho; apilada, ocupa el espacio que queda.
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-muted group-aria-[current]:bg-seleccion-riel @min-[46rem]:w-30 @min-[46rem]:flex-none"
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
          {/* Columna de ancho fijo (no mínimo), a la derecha, para que ninguna fila corra la barra ni el
              porcentaje: arriba, la fecha del último paso (o "Atrasada", más ancha con el mes en la vista
              de atrasadas) y, debajo, la marca de cobrada. Con el listado angosto va en su propia línea,
              debajo de la barra (así la barra no depende de cuánto mida la fecha), y la marca de cobrada
              vuelve a la segunda línea de la izquierda. */}
          <div
            data-columna="fecha"
            className={cn(
              'order-last flex w-full flex-col items-start gap-0.5 text-left @min-[46rem]:order-none @min-[46rem]:shrink-0 @min-[46rem]:items-end @min-[46rem]:text-right',
              periodo === undefined ? '@min-[46rem]:w-28' : '@min-[46rem]:w-44',
              // Sin nada que mostrar, apilada no deja una línea vacía; ancha conserva su ancho.
              marca === null && fecha === null && cobrada === null && '@max-[46rem]:hidden',
            )}
          >
            <span
              className={cn(
                'text-[0.8125rem] whitespace-nowrap',
                marca === null ? 'text-content-secondary' : 'font-semibold text-atrasada',
              )}
            >
              {marca ?? fecha}
            </span>
            {cobrada !== null && (
              <MarcaDeCobro
                data-cobro="columna"
                texto={cobrada}
                className="hidden text-xs @min-[46rem]:inline-flex"
              />
            )}
          </div>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-content-secondary transition-transform group-hover:translate-x-0.5"
          />
        </div>
        {/* Solo para la descripción del enlace: la segunda línea, el avance y la fecha, como frase. */}
        <span id={idDescripcion} hidden>
          {`${tipoDeCliente(cliente)} · ${textoDePendientes(avance.faltantes)} · ${ETIQUETAS_ESTADO_RENDICION[estado]}. Avance ${porcentaje} %`}
          {(marca ?? fecha) !== null && `, ${marca ?? fecha}`}
          {cobrada !== null && `. ${cobrada}`}
        </span>
      </Link>
    </article>
  );
}
