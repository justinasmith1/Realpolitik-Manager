import type { AplicacionConDocumento, RendicionDetalle } from '@realpolitik/shared';
import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { mensajeFalloDescarga } from '@/modules/documentos/components/erroresDeDocumentos';
import {
  fechaLegible,
  formatoLegible,
  tamanioLegible,
} from '@/modules/documentos/documentos.etiquetas';
import { useDescargas, useHistorialDeItem } from '@/modules/documentos/hooks/useDocumentos';
import { nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';

interface HistorialDeItemSheetProps {
  /** El ítem cuyo historial se muestra. `null` mantiene el panel cerrado. */
  itemId: string | null;
  rendicion: RendicionDetalle;
  onCerrar: () => void;
}

function FilaDelHistorial({
  aplicacion,
  descargando,
  onDescargar,
}: {
  aplicacion: AplicacionConDocumento;
  descargando: boolean;
  onDescargar: () => void;
}) {
  const { documento } = aplicacion;
  const vigente = aplicacion.estado === 'VIGENTE';
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium break-all text-foreground">
            {documento.nombreOriginal}
          </span>
          {vigente ? (
            <Badge className="border-success-border bg-success-soft text-success">Vigente</Badge>
          ) : (
            <Badge tone="muted">Reemplazado</Badge>
          )}
        </span>
        <span className="text-xs text-content-secondary">
          Asociado el {fechaLegible(aplicacion.aplicadaEn)}
          {aplicacion.reemplazadaEn !== null &&
            ` · reemplazado el ${fechaLegible(aplicacion.reemplazadaEn)}`}
        </span>
        <span className="text-xs text-content-secondary">
          {formatoLegible(documento.tipoContenido)} · {tamanioLegible(documento.tamanioBytes)}
        </span>
      </div>
      <LoadingButton
        type="button"
        variant="ghost"
        size="icon-sm"
        loading={descargando}
        onClick={onDescargar}
        aria-label={`Descargar ${documento.nombreOriginal}`}
        title="Descargar"
      >
        <DownloadIcon aria-hidden="true" />
      </LoadingButton>
    </li>
  );
}

/**
 * Los documentos que tuvo un ítem, del más reciente al más viejo, con cuál está vigente y las
 * fechas en que se asoció y se reemplazó cada uno. Todos se pueden descargar. También en una
 * rendición anulada: es historial.
 */
export function HistorialDeItemSheet({ itemId, rendicion, onCerrar }: HistorialDeItemSheetProps) {
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrado, setMostrado] = useState(itemId);
  const [errorDeDescarga, setErrorDeDescarga] = useState<string | null>(null);
  if (itemId !== null && itemId !== mostrado) {
    setMostrado(itemId);
    setErrorDeDescarga(null);
  }
  const item = rendicion.items.find((candidato) => candidato.id === mostrado);
  const consulta = useHistorialDeItem(
    mostrado === null
      ? null
      : { clienteId: rendicion.clienteId, rendicionId: rendicion.id, itemId: mostrado },
  );
  const { idsDescargando, descargar } = useDescargas((documento) =>
    setErrorDeDescarga(mensajeFalloDescarga(documento.nombreOriginal)),
  );
  const aplicaciones = consulta.data?.aplicaciones;

  return (
    <Sheet
      open={itemId !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) setMostrado(null);
      }}
    >
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8">
            Historial de {item === undefined ? 'documentos' : nombreDeItem(item)}
          </SheetTitle>
          <SheetDescription>
            Factura <span className="font-mono">{rendicion.numeroFactura}</span> · los documentos
            que tuvo este ítem
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {errorDeDescarga !== null && (
            <Alert onCerrar={() => setErrorDeDescarga(null)}>{errorDeDescarga}</Alert>
          )}
          {consulta.isError ? (
            <Alert>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>No pudimos cargar el historial.</span>
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
          ) : aplicaciones === undefined ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <span className="sr-only" role="status">
                Cargando el historial…
              </span>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : aplicaciones.length === 0 ? (
            <p className="text-sm text-content-secondary">
              Este ítem todavía no tuvo ningún documento.
            </p>
          ) : (
            <ul
              aria-label="Documentos del ítem"
              className="divide-y divide-border rounded-card border bg-card"
            >
              {aplicaciones.map((aplicacion) => (
                <FilaDelHistorial
                  key={aplicacion.id}
                  aplicacion={aplicacion}
                  descargando={idsDescargando.includes(aplicacion.documento.id)}
                  onDescargar={() => void descargar(aplicacion.documento)}
                />
              ))}
            </ul>
          )}
        </div>

        <SheetFooter className="flex flex-row justify-end border-t px-6 py-4">
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cerrar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
