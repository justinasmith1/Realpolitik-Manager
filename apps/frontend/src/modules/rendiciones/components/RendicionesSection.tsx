import {
  ETIQUETAS_ESTADO_RENDICION,
  EstadoRendicion,
  FiltroVigenciaRendiciones,
  type ClienteEstadoType,
  type EstadoRendicionType,
  type EmisorType,
  type RendicionDetalle,
  type RendicionResumen,
} from '@realpolitik/shared';
import { cn } from 'cn';
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
  cliente: {
    id: string;
    denominacion: string;
    estado: ClienteEstadoType;
    /** Precarga el emisor al abrir una rendición. */
    emisor?: EmisorType | undefined;
  };
  /** Avisa en la página el resultado de anular. */
  onAviso: (variante: Variante, texto: string) => void;
  /** Ir a configurar la matriz (cuando no tiene requisitos). Sin esto, no se ofrece. */
  onConfigurarMatriz?: (() => void) | undefined;
}

const describir = (rendicion: { anio: number; mes: number; numeroFactura: string }) =>
  `${etiquetaDePeriodo(rendicion)} (factura ${rendicion.numeroFactura})`;

const OPCION_TODOS: SelectOption = { value: '', label: 'Todos' };

/** Los chips del filtro por estado: "Todas" (sin filtro) y cada estado, en el orden del proceso. */
const OPCIONES_ESTADO: { valor: EstadoRendicionType | undefined; etiqueta: string }[] = [
  { valor: undefined, etiqueta: 'Todas' },
  ...EstadoRendicion.options.map((valor) => ({
    valor,
    etiqueta: ETIQUETAS_ESTADO_RENDICION[valor],
  })),
];

const OPCIONES_VIGENCIA: SelectOption[] = [
  { value: 'ACTIVA', label: 'Activas' },
  { value: 'ANULADA', label: 'Anuladas' },
  { value: 'TODAS', label: 'Todas' },
];

/** Cómo se nombran las rendiciones de cada vigencia en el aviso de "no hay" con un estado. */
const DE_LA_VIGENCIA: Record<FiltroVigenciaRendiciones, string> = {
  ACTIVA: 'activas ',
  ANULADA: 'anuladas ',
  TODAS: '',
};

/** Qué decir cuando no hay rendiciones, según la vigencia elegida y si hay filtro de período. */
const SIN_RENDICIONES: Record<FiltroVigenciaRendiciones, { siempre: string; enPeriodo: string }> = {
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
 * más vieja, con filtros de año, mes, vigencia y estado (HU3.1) guardados en la URL. Cada una
 * muestra su estado con un badge. Por defecto, solo las activas:
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
  const {
    filtros,
    vigencia,
    estado,
    hayFiltros,
    cambiarAnio,
    cambiarMes,
    cambiarVigencia,
    cambiarEstado,
  } = useFiltroRendiciones();
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

  // La existente puede ser de otro cliente: con la ruta del actual, su detalle daría 404.
  function verRendicion({ rendicionId, clienteId }: { rendicionId: string; clienteId: string }) {
    setAbriendo(false);
    void navigate(rutaDeRendicion(clienteId, rendicionId));
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
  } else if (consulta.data.length === 0 && estado !== undefined) {
    // Con un estado elegido, el aviso lo nombra y ofrece volver a todos.
    contenido = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          No hay rendiciones {DE_LA_VIGENCIA[vigencia]}en estado «
          {ETIQUETAS_ESTADO_RENDICION[estado]}»{hayFiltros ? ' en ese período' : ''}.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => cambiarEstado(undefined)}>
          Limpiar filtro
        </Button>
      </div>
    );
  } else if (consulta.data.length === 0) {
    contenido = (
      <p className="text-sm text-muted-foreground">
        {hayFiltros ? SIN_RENDICIONES[vigencia].enPeriodo : SIN_RENDICIONES[vigencia].siempre}
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
          <label htmlFor={`${id}-vigencia`} className="text-sm font-medium text-foreground">
            Vigencia
          </label>
          <Select
            id={`${id}-vigencia`}
            value={vigencia}
            onValueChange={(valor) => {
              const elegido = FiltroVigenciaRendiciones.safeParse(valor);
              if (elegido.success) cambiarVigencia(elegido.data);
            }}
            options={OPCIONES_VIGENCIA}
          />
        </div>
      </div>
      {/* Filtro por estado (HU3.1): botones de alternancia, como en Requisitos; `aria-pressed`
          anuncia el activo. Si no entran en una línea, pasan a la siguiente. */}
      <div
        role="group"
        aria-label="Estado"
        className="flex flex-wrap gap-1 self-start rounded-lg border border-border bg-card p-1 text-xs font-medium"
      >
        {OPCIONES_ESTADO.map(({ valor, etiqueta }) => {
          const activo = estado === valor;
          return (
            <button
              key={etiqueta}
              type="button"
              aria-pressed={activo}
              onClick={() => cambiarEstado(valor)}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30',
                activo
                  ? 'bg-primary font-semibold text-primary-foreground shadow-xs'
                  : 'text-content-secondary hover:text-foreground',
              )}
            >
              {etiqueta}
            </button>
          );
        })}
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
