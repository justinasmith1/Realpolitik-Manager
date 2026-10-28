import type { Cliente } from '@realpolitik/shared';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  nombreAccesibleEditarEnLaFicha,
  TEXTO_EDITAR_EN_LA_FICHA,
} from '@/modules/clientes/components/textosFichaCliente';
import { useObservacionesCliente } from '@/modules/clientes/hooks/useObservacionesCliente';

const TEXTOS = {
  titulo: 'Observaciones internas',
  contextoDelBoton: 'observaciones internas',
  sinObservaciones: 'Sin observaciones internas.',
  errorAlCargar: 'No pudimos cargar las observaciones.',
  reintentar: 'Reintentar',
} as const;

export interface ObservacionesClientePanelProps {
  cliente: Pick<Cliente, 'id'>;
  /** Abre la edición en la ficha. Sin esto, solo lectura. */
  onEditarCliente?: (() => void) | undefined;
}

/**
 * Panel "Observaciones internas" de la pantalla del cliente (HU2.10): la nota con hechos
 * puntuales de la cuenta, en solo lectura, y un botón para abrir la edición en la ficha (la hoja
 * "Editar cliente", la misma que usan las indicaciones de armado). Se puede editar con el cliente
 * en cualquier estado.
 *
 * Si no se pudieron leer, lo dice y ofrece reintentar: "sin observaciones" sería afirmar algo que
 * no se sabe.
 */
export function ObservacionesClientePanel({
  cliente,
  onEditarCliente,
}: ObservacionesClientePanelProps) {
  const { data, isLoading, isError, isFetching, refetch } = useObservacionesCliente(cliente.id);
  const contenido = data?.observaciones?.trim();

  return (
    <section
      aria-labelledby="titulo-observaciones-internas"
      className="flex flex-col gap-3 rounded-panel border bg-panel p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-observaciones-internas" className="text-base font-semibold text-foreground">
          {TEXTOS.titulo}
        </h2>
        {onEditarCliente !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEditarCliente}
            aria-label={nombreAccesibleEditarEnLaFicha(TEXTOS.contextoDelBoton)}
            className="text-xs font-medium"
          >
            {TEXTO_EDITAR_EN_LA_FICHA}
          </Button>
        )}
      </div>

      {isError ? (
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{TEXTOS.errorAlCargar}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {TEXTOS.reintentar}
            </Button>
          </div>
        </Alert>
      ) : isLoading ? (
        <div className="flex flex-col gap-2 pt-1" data-testid="observaciones-cargando">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : contenido ? (
        <div
          data-testid="texto-observaciones"
          className="text-sm leading-relaxed whitespace-pre-wrap text-foreground"
        >
          {contenido}
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">{TEXTOS.sinObservaciones}</p>
      )}
    </section>
  );
}
