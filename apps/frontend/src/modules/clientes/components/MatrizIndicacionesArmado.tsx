import type { Cliente } from '@realpolitik/shared';
import { QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIndicacionesArmado } from '@/modules/clientes/hooks/useIndicacionesArmado';

export interface MatrizIndicacionesArmadoProps {
  cliente: Pick<Cliente, 'id' | 'estado' | 'razonSocial' | 'denominacion'>;
  onEditarCliente: () => void;
  /** Valor alternativo cuando se renderiza sin React Query. */
  indicacionesFallback?: string | null | undefined;
}

function MatrizIndicacionesPresentacion({
  onEditarCliente,
  cargando = false,
  texto,
}: {
  onEditarCliente: () => void;
  cargando?: boolean;
  texto?: string | null | undefined;
}) {
  const contenido = texto?.trim();

  return (
    <section
      aria-labelledby="titulo-indicaciones-armado"
      className="flex flex-col gap-3 rounded-panel border bg-panel p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titulo-indicaciones-armado" className="text-base font-semibold text-foreground">
          Indicaciones de armado
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEditarCliente}
          className="text-xs font-medium"
        >
          Editar en la ficha del cliente
        </Button>
      </div>

      {cargando ? (
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

function MatrizIndicacionesConQuery({ cliente, onEditarCliente }: MatrizIndicacionesArmadoProps) {
  const { data, isLoading } = useIndicacionesArmado(cliente.id);

  return (
    <MatrizIndicacionesPresentacion
      onEditarCliente={onEditarCliente}
      cargando={isLoading}
      texto={data?.indicacionesArmado}
    />
  );
}

/**
 * Cuadro de Indicaciones de Armado al final de la Matriz de Requisitos (HU2.4).
 * Muestra el texto libre registrado para el cliente y un botón para abrir la edición en la ficha.
 */
export function MatrizIndicacionesArmado(props: MatrizIndicacionesArmadoProps) {
  const queryClient = useContext(QueryClientContext);

  if (queryClient && props.cliente?.id) {
    return <MatrizIndicacionesConQuery {...props} />;
  }

  return (
    <MatrizIndicacionesPresentacion
      onEditarCliente={props.onEditarCliente}
      texto={props.indicacionesFallback}
    />
  );
}
