import type { Cliente } from '@realpolitik/shared';
import { useId } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  nombreAccesibleEditarEnLaFicha,
  TEXTO_EDITAR_EN_LA_FICHA,
} from '@/modules/clientes/components/textosFichaCliente';
import { useIndicacionesArmado } from '@/modules/clientes/hooks/useIndicacionesArmado';

const CONTEXTO_DEL_BOTON = 'indicaciones de armado';

export interface MatrizIndicacionesArmadoProps {
  cliente: Pick<Cliente, 'id'>;
  /** Abre la edición en la ficha. Sin esto (p. ej. en el detalle de una rendición), solo lectura. */
  onEditarCliente?: (() => void) | undefined;
}

/**
 * Cuadro de Indicaciones de Armado al final de la Matriz de Requisitos (HU2.4).
 * Muestra el texto libre registrado para el cliente y un botón para abrir la edición en la ficha.
 * Si no se pudieron leer, lo dice y ofrece reintentar: "sin indicaciones" sería afirmar algo que
 * no se sabe.
 */
export function MatrizIndicacionesArmado({
  cliente,
  onEditarCliente,
}: MatrizIndicacionesArmadoProps) {
  const { data, isLoading, isError, isFetching, refetch } = useIndicacionesArmado(cliente.id);
  const contenido = data?.indicacionesArmado?.trim();
  const idTitulo = useId();

  return (
    <section
      aria-labelledby={idTitulo}
      className="flex flex-col gap-3 rounded-panel border bg-panel p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={idTitulo} className="text-base font-semibold text-foreground">
          Indicaciones de armado
        </h2>
        {onEditarCliente !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onEditarCliente}
            aria-label={nombreAccesibleEditarEnLaFicha(CONTEXTO_DEL_BOTON)}
            className="text-xs font-medium"
          >
            {TEXTO_EDITAR_EN_LA_FICHA}
          </Button>
        )}
      </div>

      {isError ? (
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>No pudimos cargar las indicaciones de armado.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : isLoading ? (
        <div className="flex flex-col gap-2 pt-1" data-testid="indicaciones-cargando">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : contenido ? (
        <div
          data-testid="texto-indicaciones-armado"
          className="text-sm leading-relaxed whitespace-pre-wrap text-foreground"
        >
          {contenido}
        </div>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          Sin indicaciones de armado registradas.
        </p>
      )}
    </section>
  );
}
