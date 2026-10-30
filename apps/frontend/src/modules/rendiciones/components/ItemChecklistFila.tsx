import type { ItemChecklist } from '@realpolitik/shared';
import { cn } from 'cn';
import { DownloadIcon, FileTextIcon, PencilIcon } from 'lucide-react';
import { useId } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingButton } from '@/components/ui/loading-button';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import { nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Lo que se puede hacer con el documento del ítem. */
export interface AccionesDeDocumento {
  /** Ítem pendiente: asociarle un documento ya cargado. Sin esto (anulada), no se ofrece. */
  onAsociar?: () => void;
  /** Ítem con documento: cambiarlo por otro. Sin esto (anulada), no se ofrece. */
  onReemplazar?: () => void;
  onVerHistorial: () => void;
  onDescargar: () => void;
  descargando: boolean;
}

interface ItemChecklistFilaProps {
  item: ItemChecklist;
  /**
   * Casilla para elegirlo para un envío. Sin ella (rendición anulada), la fila no se elige. Con
   * `noEnviable` (el motivo, en texto), la casilla se ve deshabilitada y se explica por qué.
   */
  seleccion?: {
    marcado: boolean;
    onCambio: (marcado: boolean) => void;
    noEnviable?: string | null;
  };
  /** Abre la corrección del canal. Sin esto (rendición anulada), el canal no se cambia. */
  onCambiarCanal?: () => void;
  /** Sin esto (la API no informa el documento del ítem), la fila no muestra documentos. */
  documento?: AccionesDeDocumento;
}

/**
 * Un documento del checklist. No hay tilde manual de "reunido": los ítems se completan al
 * aplicarles un documento (HU2.8); la casilla solo lo elige para enviarlo, y solo se habilita si
 * está completado y con un documento vigente (`motivoNoEnviable`). Los pendientes se
 * distinguen con el token de alerta y más peso; el estado también va como texto, así el color
 * nunca es el único canal. Debajo va el archivo vigente, con sus acciones, o la de asociar uno.
 */
export function ItemChecklistFila({
  item,
  seleccion,
  onCambiarCanal,
  documento,
}: ItemChecklistFilaProps) {
  const idCasilla = useId();
  const idMotivo = useId();
  // Solo con casilla: en una anulada no se elige nada y no hace falta explicarlo ítem por ítem.
  const noEnviable = seleccion?.noEnviable ?? null;
  const pendiente = !item.completado;
  const nombre = nombreDeItem(item);
  const claseDelNombre = cn('text-sm text-foreground', pendiente && 'font-semibold');
  const vigente = item.documento ?? null;
  const conDocumento = documento !== undefined && vigente !== null;
  const paraAsociar = documento?.onAsociar !== undefined && pendiente && vigente === null;
  return (
    <li
      data-estado={pendiente ? 'pendiente' : 'reunido'}
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-card border p-3',
        pendiente ? 'border-warning bg-warning-soft' : 'bg-card',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {seleccion !== undefined && (
          <Checkbox
            id={idCasilla}
            checked={noEnviable === null && seleccion.marcado}
            onCheckedChange={(marcado) => seleccion.onCambio(marcado)}
            disabled={noEnviable !== null}
            aria-describedby={noEnviable === null ? undefined : idMotivo}
            className="mt-0.5"
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          {seleccion !== undefined ? (
            <label
              htmlFor={idCasilla}
              className={cn(claseDelNombre, noEnviable === null && 'cursor-pointer')}
            >
              {nombre}
            </label>
          ) : (
            <p className={claseDelNombre}>{nombre}</p>
          )}
          {item.diaAproximado !== null && (
            <p className="text-xs text-muted-foreground">Día aprox. {item.diaAproximado}</p>
          )}
          {noEnviable !== null && (
            <p id={idMotivo} className="text-xs text-content-secondary">
              {noEnviable}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-0.5">
          <Badge tone="neutral">{etiquetasCanalEntrega[item.canalEntrega]}</Badge>
          {onCambiarCanal !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={onCambiarCanal}
              aria-label={`Cambiar el canal de ${nombre}`}
              title="Cambiar el canal"
            >
              <PencilIcon aria-hidden="true" />
            </Button>
          )}
        </span>
        <Badge
          className={
            pendiente
              ? 'border-warning bg-warning-soft text-foreground'
              : 'border-success-border bg-success-soft text-success'
          }
        >
          {pendiente ? 'Pendiente' : 'Reunido'}
        </Badge>
      </div>

      {conDocumento && (
        <div
          className={cn(
            'flex basis-full flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2',
            seleccion !== undefined && 'pl-7',
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-foreground">
            <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-content-secondary" />
            <span className="sr-only">Documento: </span>
            <span className="break-all">{vigente.nombreOriginal}</span>
          </span>
          <LoadingButton
            type="button"
            variant="ghost"
            size="icon-xs"
            loading={documento.descargando}
            onClick={documento.onDescargar}
            aria-label={`Descargar ${vigente.nombreOriginal}`}
            title="Descargar"
          >
            <DownloadIcon aria-hidden="true" />
          </LoadingButton>
          <span className="ml-auto inline-flex flex-wrap items-center gap-1">
            {documento.onReemplazar !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={documento.onReemplazar}
                aria-label={`Reemplazar documento de ${nombre}`}
              >
                Reemplazar documento
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={documento.onVerHistorial}
              aria-label={`Ver historial de ${nombre}`}
            >
              Ver historial
            </Button>
          </span>
        </div>
      )}
      {paraAsociar && (
        <div
          className={cn(
            'flex basis-full flex-wrap items-center justify-between gap-2 border-t border-warning pt-2',
            seleccion !== undefined && 'pl-7',
          )}
        >
          <span className="text-[13px] text-content-secondary">Sin documento</span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={documento.onAsociar}
            aria-label={`Asociar documento existente a ${nombre}`}
          >
            Asociar documento existente
          </Button>
        </div>
      )}
    </li>
  );
}
