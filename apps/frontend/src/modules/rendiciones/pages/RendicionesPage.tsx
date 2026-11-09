import {
  mesActual,
  type EstadoRendicionType,
  type RendicionAtrasada,
  type RendicionDelMes,
} from '@realpolitik/shared';
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
import {
  useRendicionesAtrasadas,
  useRendicionesDelMes,
} from '@/modules/rendiciones/hooks/useRendiciones';
import {
  cantidadDeRendicionesEnElMes,
  etiquetaDePeriodo,
  textoDeHoy,
  type TipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import {
  contarPorEstado,
  filtrarRendicionesDelMes,
  tiposPresentes,
  type FiltrosDelMes,
} from '@/modules/rendiciones/rendicionesDelMes.filtros';

/**
 * Pantalla Rendiciones (`/rendiciones`, HU3.2): todas las rendiciones activas del mes elegido, de
 * todos los clientes, con su estado y su avance, para ver de un vistazo qué falta. Es la pantalla
 * de entrada del sistema. El mes queda en la URL; sin él, el mes actual. Cada fila abre el detalle
 * de su rendición.
 *
 * HU3.3: tarjetas con cuántas hay en cada estado (todas las del mes), y filtros por estado, tipo de
 * cliente y búsqueda, que se combinan y quedan en la URL. Se aplican acá, sobre el listado del mes.
 *
 * HU3.4: la tarjeta Atrasadas cuenta las atrasadas de cualquier mes y abre su vista
 * (`vista=atrasadas`): el listado pasa a ser el de todas las atrasadas, de la más vieja a la más
 * nueva, y el tipo y la búsqueda se aplican sobre él.
 */
export function RendicionesPage() {
  const { periodo, anterior, siguiente, elegir } = useMesDeRendiciones();
  const consulta = useRendicionesDelMes(periodo);
  const consultaAtrasadas = useRendicionesAtrasadas();
  const {
    filtros,
    textoBusqueda,
    cambiarTexto,
    elegirEstado,
    elegirTipo,
    quitarBusqueda,
    limpiar,
    vistaAtrasadas,
    alternarAtrasadas,
    quitarAtrasadas,
  } = useFiltrosRendicionesDelMes();
  const atrasadas = consultaAtrasadas.data;
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
  } else {
    const delMes = consulta.data;
    const mesVacio = (
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
    const tarjetas = (
      <ResumenPorEstado
        conteo={contarPorEstado(delMes)}
        activo={filtros.estado}
        onElegir={elegirEstado}
        atrasadas={atrasadas?.length}
        vistaAtrasadas={vistaAtrasadas}
        onAtrasadas={alternarAtrasadas}
      />
    );
    const comunes = {
      filtros,
      textoBusqueda,
      cambiarTexto,
      elegirEstado,
      elegirTipo,
      quitarBusqueda,
      quitarAtrasadas,
      limpiar,
    };
    if (!vistaAtrasadas && delMes.length === 0) {
      // Mes vacío: el aviso. Si hay atrasadas de otros meses, también las tarjetas, para poder
      // abrirlas desde la de Atrasadas.
      contenido =
        (atrasadas?.length ?? 0) > 0 ? (
          <>
            {tarjetas}
            {mesVacio}
          </>
        ) : (
          mesVacio
        );
    } else {
      contenido = (
        <>
          {tarjetas}
          {vistaAtrasadas ? (
            <ListadoFiltrado
              {...comunes}
              base={atrasadas}
              error={consultaAtrasadas.isError}
              onReintentar={() => void consultaAtrasadas.refetch()}
              vistaAtrasadas
              nombre="Rendiciones atrasadas"
            />
          ) : (
            <ListadoFiltrado
              {...comunes}
              base={delMes}
              error={false}
              onReintentar={() => undefined}
              vistaAtrasadas={false}
              nombre={`Rendiciones de ${nombreDelMes}`}
            />
          )}
        </>
      );
    }
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

/** La fila trae su período: es del listado de atrasadas. */
const conPeriodo = (
  rendicion: RendicionDelMes | RendicionAtrasada,
): rendicion is RendicionAtrasada => 'anio' in rendicion;

interface ListadoFiltradoProps {
  /** El listado sobre el que se filtra: el del mes o, en su vista, el de atrasadas. */
  base: readonly (RendicionDelMes | RendicionAtrasada)[] | undefined;
  error: boolean;
  onReintentar: () => void;
  vistaAtrasadas: boolean;
  /** El nombre accesible de la lista. */
  nombre: string;
  filtros: FiltrosDelMes;
  textoBusqueda: string;
  cambiarTexto: (texto: string) => void;
  elegirEstado: (estado: EstadoRendicionType | undefined) => void;
  elegirTipo: (tipo: TipoDeCliente | undefined) => void;
  quitarBusqueda: () => void;
  quitarAtrasadas: () => void;
  limpiar: () => void;
}

/**
 * Los filtros, la línea de filtros activos y el listado filtrado: sobre el listado del mes o, en la
 * vista de atrasadas (HU3.4), sobre el de atrasadas, con el mes de cada una junto a su marca.
 */
function ListadoFiltrado({
  base,
  error,
  onReintentar,
  vistaAtrasadas,
  nombre,
  filtros,
  textoBusqueda,
  cambiarTexto,
  elegirEstado,
  elegirTipo,
  quitarBusqueda,
  quitarAtrasadas,
  limpiar,
}: ListadoFiltradoProps) {
  if (error) {
    return (
      <Alert>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>No pudimos cargar las rendiciones atrasadas.</span>
          <Button type="button" variant="outline" size="sm" onClick={onReintentar}>
            Reintentar
          </Button>
        </div>
      </Alert>
    );
  }
  if (base === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <span className="sr-only" role="status">
          Cargando las rendiciones…
        </span>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const visibles = filtrarRendicionesDelMes(base, filtros);
  // El tipo filtrado conserva su opción aunque no esté en el listado, para verlo y poder quitarlo.
  const presentes = tiposPresentes(base);
  const tipos =
    filtros.tipo === undefined || presentes.includes(filtros.tipo)
      ? presentes
      : [...presentes, filtros.tipo];
  let aviso: string | undefined;
  if (visibles.length === 0) {
    aviso =
      vistaAtrasadas && base.length === 0
        ? 'No hay rendiciones atrasadas'
        : 'Ninguna rendición coincide con los filtros';
  }

  return (
    <>
      <FiltrosRendicionesDelMes
        tipos={tipos}
        tipo={filtros.tipo}
        onTipo={elegirTipo}
        textoBusqueda={textoBusqueda}
        onTexto={cambiarTexto}
      />
      <FiltrosActivos
        filtros={filtros}
        vistaAtrasadas={vistaAtrasadas}
        mostradas={visibles.length}
        total={base.length}
        onQuitarEstado={() => elegirEstado(undefined)}
        onQuitarTipo={() => elegirTipo(undefined)}
        onQuitarBusqueda={quitarBusqueda}
        onQuitarAtrasadas={quitarAtrasadas}
        onLimpiar={limpiar}
      />
      {aviso === undefined ? (
        // Una sola tarjeta, con las filas separadas por una línea fina.
        <ul aria-label={nombre} className="divide-y overflow-hidden rounded-card border bg-card">
          {visibles.map((rendicion) => (
            <li key={rendicion.id}>
              <RendicionDelMesFila
                rendicion={rendicion}
                periodo={vistaAtrasadas && conPeriodo(rendicion) ? rendicion : undefined}
              />
            </li>
          ))}
        </ul>
      ) : (
        // Solo el aviso: para limpiar está "Limpiar todo", en la línea de filtros activos.
        <div className="rounded-card border bg-card p-6">
          <h2 className="text-base font-semibold">{aviso}</h2>
        </div>
      )}
    </>
  );
}
