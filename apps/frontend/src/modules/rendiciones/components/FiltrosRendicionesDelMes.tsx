import { cn } from 'cn';
import { SearchIcon } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { MAX_BUSQUEDA_RENDICIONES } from '@/modules/rendiciones/hooks/useFiltrosRendicionesDelMes';
import {
  etiquetaDeTipoDeCliente,
  esTipoDeCliente,
  type TipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface FiltrosRendicionesDelMesProps {
  /** Los tipos de cliente del desplegable: los presentes en el mes, más el filtrado si no lo está. */
  tipos: readonly TipoDeCliente[];
  tipo: TipoDeCliente | undefined;
  onTipo: (tipo: TipoDeCliente | undefined) => void;
  textoBusqueda: string;
  onTexto: (texto: string) => void;
}

/**
 * Los filtros de la pantalla Rendiciones (HU3.3), en una fila debajo de las tarjetas (que son el
 * filtro por estado): el desplegable de tipo de cliente, de ancho fijo, y el buscador por cliente o
 * factura ocupando el resto. Sin tipo elegido, el desplegable dice "Tipo de cliente: Todos"; con
 * uno, "Tipo: <tipo>" en negrita y con el borde más marcado. En pantallas angostas, apilados.
 */
export function FiltrosRendicionesDelMes({
  tipos,
  tipo,
  onTipo,
  textoBusqueda,
  onTexto,
}: FiltrosRendicionesDelMesProps) {
  // "Todos" es el valor vacío: sin parámetro `tipo` en la URL.
  const opciones: SelectOption[] = [
    { value: '', label: 'Todos' },
    ...tipos.map((valor) => ({ value: valor, label: etiquetaDeTipoDeCliente(valor) })),
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Select
        aria-label="Tipo de cliente"
        value={tipo ?? ''}
        onValueChange={(valor) => onTipo(esTipoDeCliente(valor) ? valor : undefined)}
        options={opciones}
        renderValue={(opcion) =>
          tipo === undefined || opcion === undefined ? (
            <span className="text-content-secondary">Tipo de cliente: Todos</span>
          ) : (
            <span>
              <span className="text-content-secondary">Tipo: </span>
              <span className="font-semibold text-foreground">{opcion.label}</span>
            </span>
          )
        }
        className={cn('sm:w-70 sm:shrink-0', tipo !== undefined && 'border-foreground')}
      />
      <div className="relative min-w-0 flex-1">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Buscar cliente o factura"
          placeholder="Buscar cliente o factura"
          maxLength={MAX_BUSQUEDA_RENDICIONES}
          value={textoBusqueda}
          onChange={(e) => onTexto(e.target.value)}
          // Blanco siempre, como el desplegable: el `Input` trae `dark:bg-input/30`, que con el modo
          // oscuro del sistema lo pintaba de gris (la app no tiene tema oscuro). `scheme-light`: las
          // partes nativas (la ✕ de borrar) también en claro. El foco lo marcan el borde y el anillo.
          className="pl-9 text-ellipsis scheme-light dark:bg-card"
        />
      </div>
    </div>
  );
}
