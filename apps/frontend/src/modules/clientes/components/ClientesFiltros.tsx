import {
  ClienteSector,
  MAX_BUSQUEDA_CLIENTES,
  ClienteSubtipoPublico,
  subtiposPorSector,
  type ClienteSectorType,
  type ClienteSubtipoPublicoType,
} from '@realpolitik/shared';
import { RotateCcwIcon, SearchIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { etiquetasSector, etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';

/** Vistas del listado por estado. Las dos que la interfaz ofrece; SUSPENDIDO no se usa. */
export type VistaEstado = 'ACTIVO' | 'INACTIVO';

const opcionesDeEstado: SelectOption[] = [
  { value: 'ACTIVO', label: 'Activos' },
  { value: 'INACTIVO', label: 'Inactivos' },
];

const opcionesDeSector: SelectOption[] = [
  { value: '', label: 'Todos' },
  ...ClienteSector.options.map((valor) => ({ value: valor, label: etiquetasSector[valor] })),
];

const opcionesDeSubtipo: SelectOption[] = [
  { value: '', label: 'Todos' },
  ...subtiposPorSector.PUBLICO.map((valor) => ({ value: valor, label: etiquetasSubtipo[valor] })),
];

// Con sector Privado el subtipo no aplica: queda una única opción que lo explica.
const opcionesDeSubtipoNoAplica: SelectOption[] = [{ value: '', label: 'No aplica a privados' }];

interface ClientesFiltrosProps {
  textoBusqueda: string;
  estado: VistaEstado;
  sector: ClienteSectorType | undefined;
  subtipo: ClienteSubtipoPublicoType | undefined;
  hayFiltros: boolean;
  /** Cantidad de resultados, anunciada a lectores de pantalla. */
  total: number;
  onTextoChange: (texto: string) => void;
  onEstadoChange: (estado: VistaEstado) => void;
  onSectorChange: (sector: ClienteSectorType | undefined) => void;
  onSubtipoChange: (subtipo: ClienteSubtipoPublicoType | undefined) => void;
  onLimpiar: () => void;
}

function Filtro({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      <label htmlFor={id} className="text-xs font-medium text-content-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Búsqueda y filtros del listado. El subtipo solo aplica al sector público: con sector
 * Privado queda deshabilitado.
 *
 * Responsive: en escritorio ancho todo va en una fila de columnas fijas (la búsqueda crece
 * hasta 30rem, no domina el panel; "Limpiar filtros" aparece al final sin correr a los demás);
 * en pantallas medianas la búsqueda ocupa su propia fila y los selectores se ordenan debajo; en
 * mobile se apilan, con controles de tamaño táctil. El contador queda fuera del panel, como
 * dato secundario del listado.
 */
export function ClientesFiltros({
  textoBusqueda,
  estado,
  sector,
  subtipo,
  hayFiltros,
  total,
  onTextoChange,
  onEstadoChange,
  onSectorChange,
  onSubtipoChange,
  onLimpiar,
}: ClientesFiltrosProps) {
  const subtipoDeshabilitado = sector === 'PRIVADO';

  return (
    <div className="flex flex-col gap-2">
      <div
        role="search"
        aria-label="Buscar y filtrar clientes"
        className="grid grid-cols-1 items-end gap-3 rounded-card border bg-card p-3.5 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:grid-cols-[minmax(16rem,30rem)_9rem_10rem_13rem_auto]"
      >
        <Filtro
          id="filtro-busqueda"
          label="Buscar cliente"
          className="sm:col-span-2 lg:col-span-4 xl:col-span-1"
        >
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="filtro-busqueda"
              type="search"
              placeholder="Razón social, denominación o CUIT"
              maxLength={MAX_BUSQUEDA_CLIENTES}
              value={textoBusqueda}
              onChange={(e) => onTextoChange(e.target.value)}
              className="pl-9 text-ellipsis"
            />
          </div>
        </Filtro>

        <Filtro id="filtro-estado" label="Estado">
          <Select
            id="filtro-estado"
            value={estado}
            onValueChange={(valor) => onEstadoChange(valor === 'INACTIVO' ? 'INACTIVO' : 'ACTIVO')}
            options={opcionesDeEstado}
          />
        </Filtro>

        <Filtro id="filtro-sector" label="Sector">
          <Select
            id="filtro-sector"
            value={sector ?? ''}
            onValueChange={(valor) => onSectorChange(ClienteSector.safeParse(valor).data)}
            options={opcionesDeSector}
          />
        </Filtro>

        <Filtro id="filtro-subtipo" label="Subtipo">
          <Select
            id="filtro-subtipo"
            value={subtipo ?? ''}
            disabled={subtipoDeshabilitado}
            onValueChange={(valor) => onSubtipoChange(ClienteSubtipoPublico.safeParse(valor).data)}
            options={subtipoDeshabilitado ? opcionesDeSubtipoNoAplica : opcionesDeSubtipo}
          />
        </Filtro>

        {hayFiltros && (
          <Button type="button" variant="ghost" onClick={onLimpiar} className="max-sm:w-full">
            <RotateCcwIcon aria-hidden="true" />
            Limpiar filtros
          </Button>
        )}
      </div>

      <p aria-live="polite" className="self-end px-1 text-xs text-muted-foreground">
        {total === 1 ? '1 cliente' : `${total} clientes`}
      </p>
    </div>
  );
}
