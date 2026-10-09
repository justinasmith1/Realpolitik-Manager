import {
  ClienteSector,
  ClienteSubtipoPublico,
  subtiposPorSector,
  type ClienteSectorType,
  type ClienteSubtipoPublicoType,
} from '@realpolitik/shared';
import { RotateCcwIcon, SearchIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { etiquetasSector, etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';

interface ClientesFiltrosProps {
  textoBusqueda: string;
  sector: ClienteSectorType | undefined;
  subtipo: ClienteSubtipoPublicoType | undefined;
  hayFiltros: boolean;
  /** Cantidad de resultados, anunciada a lectores de pantalla. */
  total: number;
  onTextoChange: (texto: string) => void;
  onSectorChange: (sector: ClienteSectorType | undefined) => void;
  onSubtipoChange: (subtipo: ClienteSubtipoPublicoType | undefined) => void;
  onLimpiar: () => void;
}

/**
 * Búsqueda y filtros del listado. El subtipo solo aplica al sector público: con sector
 * Privado queda deshabilitado.
 */
export function ClientesFiltros({
  textoBusqueda,
  sector,
  subtipo,
  hayFiltros,
  total,
  onTextoChange,
  onSectorChange,
  onSubtipoChange,
  onLimpiar,
}: ClientesFiltrosProps) {
  const subtipoDeshabilitado = sector === 'PRIVADO';

  return (
    <div
      role="search"
      aria-label="Buscar y filtrar clientes"
      className="flex flex-wrap items-end gap-3 rounded-card border bg-card p-3.5"
    >
      <div className="flex min-w-60 flex-1 flex-col gap-1">
        <label htmlFor="filtro-busqueda" className="text-xs font-medium">
          Buscar cliente
        </label>
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="filtro-busqueda"
            type="search"
            placeholder="Razón social, denominación o CUIT"
            value={textoBusqueda}
            onChange={(e) => onTextoChange(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex w-44 flex-col gap-1">
        <label htmlFor="filtro-sector" className="text-xs font-medium">
          Sector
        </label>
        <NativeSelect
          id="filtro-sector"
          value={sector ?? ''}
          onChange={(e) => onSectorChange(ClienteSector.safeParse(e.target.value).data)}
        >
          <option value="">Todos</option>
          {ClienteSector.options.map((s) => (
            <option key={s} value={s}>
              {etiquetasSector[s]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex w-56 flex-col gap-1">
        <label htmlFor="filtro-subtipo" className="text-xs font-medium">
          Subtipo
        </label>
        <NativeSelect
          id="filtro-subtipo"
          value={subtipo ?? ''}
          disabled={subtipoDeshabilitado}
          onChange={(e) => onSubtipoChange(ClienteSubtipoPublico.safeParse(e.target.value).data)}
        >
          <option value="">{subtipoDeshabilitado ? 'No aplica a privados' : 'Todos'}</option>
          {!subtipoDeshabilitado &&
            subtiposPorSector.PUBLICO.map((st) => (
              <option key={st} value={st}>
                {etiquetasSubtipo[st]}
              </option>
            ))}
        </NativeSelect>
      </div>

      {hayFiltros && (
        <Button type="button" variant="ghost" onClick={onLimpiar}>
          <RotateCcwIcon aria-hidden="true" />
          Limpiar filtros
        </Button>
      )}

      <p aria-live="polite" className="ml-auto self-center text-xs text-muted-foreground">
        {total === 1 ? '1 cliente' : `${total} clientes`}
      </p>
    </div>
  );
}
