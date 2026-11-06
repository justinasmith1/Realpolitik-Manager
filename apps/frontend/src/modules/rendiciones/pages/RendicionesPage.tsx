import { mesActual } from '@realpolitik/shared';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FiltrosActivos } from '@/modules/rendiciones/components/FiltrosActivos';
import { FiltrosRendicionesDelMes } from '@/modules/rendiciones/components/FiltrosRendicionesDelMes';
import { RendicionDelMesFila } from '@/modules/rendiciones/components/RendicionDelMesFila';
import { ResumenPorEstado } from '@/modules/rendiciones/components/ResumenPorEstado';
import { useFiltrosRendicionesDelMes } from '@/modules/rendiciones/hooks/useFiltrosRendicionesDelMes';
import { useMesDeRendiciones } from '@/modules/rendiciones/hooks/useMesDeRendiciones';
import { useRendicionesDelMes } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  cantidadDeRendicionesEnElMes,
  etiquetaDePeriodo,
  textoDeHoy,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import {
  contarPorEstado,
  filtrarRendicionesDelMes,
  tiposPresentes,
} from '@/modules/rendiciones/rendicionesDelMes.filtros';

/**
 * Pantalla Rendiciones (`/rendiciones`, HU3.2): todas las rendiciones activas del mes elegido, de
 * todos los clientes, con su estado y su avance, para ver de un vistazo qué falta. Es la pantalla
 * de entrada del sistema. El mes queda en la URL; sin él, el mes actual. Cada fila abre el detalle
 * de su rendición.
 *
 * HU3.3: tarjetas con cuántas hay en cada estado (todas las del mes), y filtros por estado, tipo de
 * cliente y búsqueda, que se combinan y quedan en la URL. Se aplican acá, sobre el listado del mes.
 */
export function RendicionesPage() {
  const { periodo, anterior, siguiente, elegir } = useMesDeRendiciones();
  const consulta = useRendicionesDelMes(periodo);
  const {
    filtros,
    textoBusqueda,
    cambiarTexto,
    elegirEstado,
    elegirTipo,
    quitarBusqueda,
    limpiar,
  } = useFiltrosRendicionesDelMes();
  const nombreDelMes = etiquetaDePeriodo(periodo);
  const hoy = new Date();
  // La cantidad, cuando ya llegó el listado del mes.
  const resumen =
    consulta.data === undefined
      ? textoDeHoy(hoy)
      : `${textoDeHoy(hoy)} · ${cantidadDeRendicionesEnElMes(consulta.data.length, periodo, mesActual(hoy).anio)}`;

  let contenido: ReactNode;
  if (consulta.isError) {
    contenido = (
      <Alert>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>No pudimos cargar las rendiciones.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void consulta.refetch()}
            disabled={consulta.isFetching}
          >
            Reintentar
          </Button>
        </div>
      </Alert>
    );
  } else if (consulta.data === undefined) {
    contenido = (
      <div className="flex flex-col gap-2" data-testid="rendiciones-del-mes-cargando">
        <span className="sr-only" role="status">
          Cargando las rendiciones…
        </span>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  } else if (consulta.data.length === 0) {
    contenido = (
      <div className="flex flex-col items-start gap-3 rounded-card border bg-card p-6">
        <h2 className="text-base font-semibold">No hay rendiciones en {nombreDelMes}</h2>
        <p className="text-sm text-content-secondary">
          Las rendiciones se abren desde la ficha de cada cliente.
        </p>
        <Link to="/clientes" className={buttonVariants({ variant: 'outline' })}>
          Ir a Clientes
        </Link>
      </div>
    );
  } else {
    const delMes = consulta.data;
    const visibles = filtrarRendicionesDelMes(delMes, filtros);
    // El tipo filtrado conserva su chip aunque no esté en este mes, para verlo y poder quitarlo.
    const presentes = tiposPresentes(delMes);
    const tipos =
      filtros.tipo === undefined || presentes.includes(filtros.tipo)
        ? presentes
        : [...presentes, filtros.tipo];
    contenido = (
      <>
        <ResumenPorEstado
          conteo={contarPorEstado(delMes)}
          activo={filtros.estado}
          onElegir={elegirEstado}
        />
        <FiltrosRendicionesDelMes
          tipos={tipos}
          tipo={filtros.tipo}
          onTipo={elegirTipo}
          textoBusqueda={textoBusqueda}
          onTexto={cambiarTexto}
        />
        <FiltrosActivos
          filtros={filtros}
          mostradas={visibles.length}
          total={delMes.length}
          onQuitarEstado={() => elegirEstado(undefined)}
          onQuitarTipo={() => elegirTipo(undefined)}
          onQuitarBusqueda={quitarBusqueda}
          onLimpiar={limpiar}
        />
        {visibles.length === 0 ? (
          // Solo el aviso: para limpiar está "Limpiar todo", en la línea de filtros activos.
          <div className="rounded-card border bg-card p-6">
            <h2 className="text-base font-semibold">Ninguna rendición coincide con los filtros</h2>
          </div>
        ) : (
          // Una sola tarjeta, con las filas separadas por una línea fina.
          <ul
            aria-label={`Rendiciones de ${nombreDelMes}`}
            className="divide-y overflow-hidden rounded-card border bg-card"
          >
            {visibles.map((rendicion) => (
              <li key={rendicion.id}>
                <RendicionDelMesFila rendicion={rendicion} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Rendiciones</h1>
          <p className="mt-1 text-sm text-content-secondary">{resumen}</p>
        </div>
        {/* Selector de mes, en un recuadro: el nombre del mes en el medio y una flecha a cada lado. */}
        <div
          role="group"
          aria-label="Mes"
          className="flex items-center gap-2 rounded-panel border bg-card p-1.5"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mes anterior"
            disabled={anterior === null}
            onClick={() => anterior !== null && elegir(anterior)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <p
            aria-live="polite"
            className="min-w-40 text-center text-sm font-semibold text-foreground"
          >
            {nombreDelMes}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mes siguiente"
            disabled={siguiente === null}
            onClick={() => siguiente !== null && elegir(siguiente)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      {contenido}
    </div>
  );
}
