import type { ItemChecklist } from '@realpolitik/shared';
import { cn } from 'cn';
import { PencilIcon } from 'lucide-react';
import { useId } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import { nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';

interface ItemChecklistFilaProps {
  item: ItemChecklist;
  /** Casilla para elegirlo para un envío. Sin ella (rendición anulada), la fila no se elige. */
  seleccion?: { marcado: boolean; onCambio: (marcado: boolean) => void };
  /** Abre la corrección del canal. Sin esto (rendición anulada), el canal no se cambia. */
  onCambiarCanal?: () => void;
}

/**
 * Un documento del checklist. No hay tilde manual de "reunido": los ítems se completan al
 * aplicarles un documento (HU2.8); la casilla solo lo elige para enviarlo. Los pendientes se
 * distinguen con el token de alerta y más peso; el estado también va como texto, así el color
 * nunca es el único canal.
 */
export function ItemChecklistFila({ item, seleccion, onCambiarCanal }: ItemChecklistFilaProps) {
  const idCasilla = useId();
  const pendiente = !item.completado;
  const claseDelNombre = cn('text-sm text-foreground', pendiente && 'font-semibold');
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
            checked={seleccion.marcado}
            onCheckedChange={(marcado) => seleccion.onCambio(marcado)}
            className="mt-0.5"
          />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          {seleccion !== undefined ? (
            <label htmlFor={idCasilla} className={cn(claseDelNombre, 'cursor-pointer')}>
              {nombreDeItem(item)}
            </label>
          ) : (
            <p className={claseDelNombre}>{nombreDeItem(item)}</p>
          )}
          {item.diaAproximado !== null && (
            <p className="text-xs text-muted-foreground">Día aprox. {item.diaAproximado}</p>
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
              aria-label={`Cambiar el canal de ${nombreDeItem(item)}`}
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
    </li>
  );
}
