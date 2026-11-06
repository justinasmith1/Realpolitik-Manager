import { ETIQUETAS_ESTADO_RENDICION, type EstadoRendicionType } from '@realpolitik/shared';
import { cn } from 'cn';
import { XIcon } from 'lucide-react';

import { fondoDeEstado, textoDeEstado } from '@/modules/rendiciones/estadoRendicion.colores';
import {
  etiquetaDeTipoDeCliente,
  type TipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import type { FiltrosDelMes } from '@/modules/rendiciones/rendicionesDelMes.filtros';

interface EtiquetaDeFiltroProps {
  /** Lo que se ve, y el nombre del filtro en el botón de quitar ("Quitar filtro <texto>"). */
  texto: string;
  onQuitar: () => void;
  className?: string;
}

/** Un filtro aplicado: etiqueta chica con una ✕ que quita solo ese filtro. */
function EtiquetaDeFiltro({ texto, onQuitar, className }: EtiquetaDeFiltroProps) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-pill pr-1 pl-2.5 text-xs font-medium',
        className,
      )}
    >
      {texto}
      <button
        type="button"
        aria-label={`Quitar filtro ${texto}`}
        onClick={onQuitar}
        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

interface FiltrosActivosProps {
  filtros: FiltrosDelMes;
  /** Las rendiciones que se muestran y el total del mes ("1 de 3"). */
  mostradas: number;
  total: number;
  onQuitarEstado: () => void;
  onQuitarTipo: () => void;
  onQuitarBusqueda: () => void;
  onLimpiar: () => void;
}

/**
 * La línea de filtros activos de la pantalla Rendiciones (HU3.3), entre los filtros y el listado:
 * "1 de 3 · Filtros: [Estado: En curso ✕] [Municipio ✕] [“solano” ✕]  Limpiar todo". Solo aparece
 * con algún filtro aplicado. La etiqueta del estado va en el color de su estado. En pantallas
 * angostas puede ocupar varias líneas.
 */
export function FiltrosActivos({
  filtros,
  mostradas,
  total,
  onQuitarEstado,
  onQuitarTipo,
  onQuitarBusqueda,
  onLimpiar,
}: FiltrosActivosProps) {
  const { estado, tipo, q } = filtros;
  if (estado === undefined && tipo === undefined && q === undefined) return null;

  return (
    <div
      role="group"
      aria-label="Filtros activos"
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-content-secondary"
    >
      <span>
        <span className="tabular-nums">
          {mostradas} de {total}
        </span>{' '}
        · Filtros:
      </span>
      {estado !== undefined && <EtiquetaDeEstado estado={estado} onQuitar={onQuitarEstado} />}
      {tipo !== undefined && <EtiquetaDeTipo tipo={tipo} onQuitar={onQuitarTipo} />}
      {q !== undefined && (
        <EtiquetaDeFiltro
          texto={`“${q}”`}
          onQuitar={onQuitarBusqueda}
          className="bg-muted text-foreground"
        />
      )}
      <button
        type="button"
        onClick={onLimpiar}
        className="ml-1 cursor-pointer rounded-sm text-sm font-medium text-foreground underline underline-offset-2 outline-none hover:text-brand-accent focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        Limpiar todo
      </button>
    </div>
  );
}

function EtiquetaDeEstado({
  estado,
  onQuitar,
}: {
  estado: EstadoRendicionType;
  onQuitar: () => void;
}) {
  return (
    <EtiquetaDeFiltro
      texto={`Estado: ${ETIQUETAS_ESTADO_RENDICION[estado]}`}
      onQuitar={onQuitar}
      className={cn(fondoDeEstado[estado], textoDeEstado[estado])}
    />
  );
}

function EtiquetaDeTipo({ tipo, onQuitar }: { tipo: TipoDeCliente; onQuitar: () => void }) {
  return (
    <EtiquetaDeFiltro
      texto={etiquetaDeTipoDeCliente(tipo)}
      onQuitar={onQuitar}
      className="bg-muted text-foreground"
    />
  );
}
