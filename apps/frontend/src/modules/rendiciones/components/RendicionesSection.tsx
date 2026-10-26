import {
  FiltroEstadoRendiciones,
  type ClienteEstadoType,
  type RendicionDetalle,
  type RendicionResumen,
} from '@realpolitik/shared';
import { PlusIcon } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { enfocarYMostrar } from '@/lib/focus';
import {
  opcionesDeAnio,
  opcionesDeMes,
} from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import { AbrirRendicionSheet } from '@/modules/rendiciones/components/AbrirRendicionSheet';
import { RendicionCard } from '@/modules/rendiciones/components/RendicionCard';
import { useFiltroRendiciones } from '@/modules/rendiciones/hooks/useFiltroRendiciones';
import { useRendiciones } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  cantidadDeDocumentos,
  etiquetaDePeriodo,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import { rutaDeRendicion, type EstadoDeDetalle } from '@/modules/rendiciones/rendiciones.rutas';

type Variante = 'success' | 'destructive';

interface RendicionesSectionProps {
  cliente: { id: string; denominacion: string; estado: ClienteEstadoType };
  /** Avisa en la página el resultado de anular. */
  onAviso: (variante: Variante, texto: string) => void;
  /** Ir a configurar la matriz (cuando no tiene requisitos). Sin esto, no se ofrece. */
  onConfigurarMatriz?: (() => void) | undefined;
}

const describir = (rendicion: { anio: number; mes: number; numeroFactura: string }) =>
  `${etiquetaDePeriodo(rendicion)} (factura ${rendicion.numeroFactura})`;

const OPCION_TODOS: SelectOption = { value: '', label: 'Todos' };

const OPCIONES_ESTADO: SelectOption[] = [
  { value: 'ACTIVA', label: 'Activas' },
  { value: 'ANULADA', label: 'Anuladas' },
  { value: 'TODAS', label: 'Todas' },
];

/** Qué decir cuando no hay rendiciones, según el estado elegido y si hay filtro de período. */
const SIN_RENDICIONES: Record<FiltroEstadoRendiciones, { siempre: string; enPeriodo: string }> = {
  ACTIVA: {
    siempre: 'No hay rendiciones activas para este cliente.',
    enPeriodo: 'No hay rendiciones activas en ese período.',
  },
  ANULADA: {
    siempre: 'No hay rendiciones anuladas para este cliente.',
    enPeriodo: 'No hay rendiciones anuladas en ese período.',
  },
  TODAS: {
    siempre: 'Todavía no hay rendiciones para este cliente.',
    enPeriodo: 'No hay rendiciones en ese período.',
  },
};

/**
 * Rendiciones de un cliente dentro de su página de matriz (HU2.5, HU2.6), de la más nueva a la
 * más vieja, con filtros de año, mes y estado guardados en la URL. Por defecto, solo las activas:
 * las anuladas se consultan con el filtro, sin mezclarse (con "Todas", van después de las
 * activas, como las ordena el backend). Cada tarjeta lleva a su detalle. Solo un cliente ACTIVO puede abrir rendiciones nuevas; anular se permite en cualquier
 * estado (contrato 4.6).
 */
export function RendicionesSection({
  cliente,
  onAviso,
  onConfigurarMatriz,
}: RendicionesSectionProps) {
  const navigate = useNavigate();
  const id = useId();
  const { filtros, estado, hayFiltros, cambiarAnio, cambiarMes, cambiarEstado } =
    useFiltroRendiciones();
  const consulta = useRendiciones(cliente.id, filtros);
  const [abriendo, setAbriendo] = useState(false);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const puedeAbrir = cliente.estado === 'ACTIVO';
  const opcionesAnio = useMemo(() => [OPCION_TODOS, ...opcionesDeAnio()], []);
  const opcionesMes = useMemo(() => [OPCION_TODOS, ...opcionesDeMes], []);

  // Al abrir, se va al detalle de la rendición nueva: ahí se ve su checklist. El aviso viaja con
  // la navegación porque esta página se deja.
  function alAbrir(rendicion: RendicionDetalle) {
    setAbriendo(false);
    const estado: EstadoDeDetalle = {
      aviso: `Se abrió la rendición de ${describir(rendicion)} con ${cantidadDeDocumentos(rendicion.items.length)}.`,
    };
    void navigate(rutaDeRendicion(cliente.id, rendicion.id), { state: estado });
  }

  function verRendicion(rendicionId: string) {
    setAbriendo(false);
    void navigate(rutaDeRendicion(cliente.id, rendicionId));
  }

  function configurarMatriz() {
    setAbriendo(false);
    onConfigurarMatriz?.();
  }

  // La tarjeta anulada sale del listado (o cambia de lugar con "Todas"): el foco vuelve al título
  // de la sección.
  function alAnular(rendicion: RendicionResumen) {
    onAviso('success', `Se anuló la rendición de ${describir(rendicion)}.`);
    enfocarYMostrar(tituloRef.current);
  }

  function alNoExistir(rendicion: RendicionResumen) {
    onAviso('destructive', `La rendición de ${describir(rendicion)} ya no existe.`);
    enfocarYMostrar(tituloRef.current);
  }

  const aNumero = (valor: string) => (valor === '' ? undefined : Number(valor));

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
      <div className="flex flex-col gap-2" data-testid="rendiciones-cargando">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  } else if (consulta.data.length === 0) {
    contenido = (
      <p className="text-sm text-muted-foreground">
        {hayFiltros ? SIN_RENDICIONES[estado].enPeriodo : SIN_RENDICIONES[estado].siempre}
      </p>
    );
  } else {
    contenido = (
      <ul className="flex flex-col gap-2">
        {consulta.data.map((rendicion) => (
          <li key={rendicion.id}>
            <RendicionCard rendicion={rendicion} onAnulada={alAnular} onYaNoExiste={alNoExistir} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby="titulo-rendiciones"
      className="flex flex-col gap-3 rounded-panel border bg-panel p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="titulo-rendiciones"
          ref={tituloRef}
          tabIndex={-1}
          className="text-base font-semibold text-foreground outline-none"
        >
          Rendiciones
        </h2>
        {puedeAbrir && (
          <Button type="button" size="sm" onClick={() => setAbriendo(true)}>
            <PlusIcon aria-hidden="true" />
            Abrir rendición
          </Button>
        )}
      </div>
      {!puedeAbrir && (
        <p className="text-sm text-muted-foreground">
          El cliente no está activo: no se pueden abrir rendiciones nuevas.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-36 flex-col gap-1.5">
          <label htmlFor={`${id}-anio`} className="text-sm font-medium text-foreground">
            Año
          </label>
          <Select
            id={`${id}-anio`}
            value={filtros.anio === undefined ? '' : String(filtros.anio)}
            onValueChange={(valor) => cambiarAnio(aNumero(valor))}
            options={opcionesAnio}
          />
        </div>
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor={`${id}-mes`} className="text-sm font-medium text-foreground">
            Mes
          </label>
          <Select
            id={`${id}-mes`}
            value={filtros.mes === undefined ? '' : String(filtros.mes)}
            onValueChange={(valor) => cambiarMes(aNumero(valor))}
            options={opcionesMes}
          />
        </div>
        <div className="flex min-w-36 flex-col gap-1.5">
          <label htmlFor={`${id}-estado`} className="text-sm font-medium text-foreground">
            Estado
          </label>
          <Select
            id={`${id}-estado`}
            value={estado}
            onValueChange={(valor) => {
              const elegido = FiltroEstadoRendiciones.safeParse(valor);
              if (elegido.success) cambiarEstado(elegido.data);
            }}
            options={OPCIONES_ESTADO}
          />
        </div>
      </div>
      {contenido}
      <AbrirRendicionSheet
        abierto={abriendo}
        onAbiertoChange={setAbriendo}
        cliente={cliente}
        onAbierta={alAbrir}
        onVerRendicion={verRendicion}
        onConfigurarMatriz={onConfigurarMatriz === undefined ? undefined : configurarMatriz}
      />
    </section>
  );
}
