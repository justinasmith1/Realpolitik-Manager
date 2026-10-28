import { CanalEntrega, type CanalEntregaType, type ItemChecklist } from '@realpolitik/shared';
import { useId, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LoadingButton } from '@/components/ui/loading-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import { interpretarFalloCorreccionDeCanal } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloCorreccionDeCanal } from '@/modules/rendiciones/components/erroresDeRendicion';
import { useCorregirCanalDeItem } from '@/modules/rendiciones/hooks/useRendiciones';
import { nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';

const OPCIONES_CANAL: SelectOption[] = CanalEntrega.options.map((canal) => ({
  value: canal,
  label: etiquetasCanalEntrega[canal],
}));

interface CambiarCanalDialogProps {
  /** El ítem a corregir. `null` mantiene el diálogo cerrado. */
  item: ItemChecklist | null;
  clienteId: string;
  rendicionId: string;
  onCerrar: () => void;
  /** Se guardó: avisa en la página con el texto del resultado. */
  onCambiado: (texto: string) => void;
}

/**
 * Corrige el canal de un ítem de una rendición activa (ADR-0003): si el requisito tenía un canal
 * equivocado al abrirla, el ítem quedó con ese canal. Cambia solo este documento en esta
 * rendición; el requisito del cliente y las otras rendiciones no cambian. Con el mismo canal no hay
 * nada que guardar.
 */
export function CambiarCanalDialog({
  item,
  clienteId,
  rendicionId,
  onCerrar,
  onCambiado,
}: CambiarCanalDialogProps) {
  const id = useId();
  const correccion = useCorregirCanalDeItem();
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrado, setMostrado] = useState(item);
  const [canal, setCanal] = useState<CanalEntregaType | null>(item?.canalEntrega ?? null);
  const [error, setError] = useState<string | null>(null);
  if (item !== null && item !== mostrado) {
    setMostrado(item);
    setCanal(item.canalEntrega);
    setError(null);
  }
  const nombre = mostrado === null ? '' : nombreDeItem(mostrado);
  const sinCambios = mostrado === null || canal === mostrado.canalEntrega;

  async function guardar() {
    if (mostrado === null || canal === null || sinCambios || correccion.isPending) return;
    setError(null);
    try {
      await correccion.mutateAsync({
        clienteId,
        rendicionId,
        itemId: mostrado.id,
        canalEntrega: canal,
      });
    } catch (fallo) {
      setError(mensajeFalloCorreccionDeCanal(interpretarFalloCorreccionDeCanal(fallo)));
      return;
    }
    onCambiado(`${nombre} ahora se envía por ${etiquetasCanalEntrega[canal]}.`);
  }

  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !correccion.isPending) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setMostrado(null);
          setError(null);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cambiar el canal de «{nombre}»</AlertDialogTitle>
          <AlertDialogDescription>
            Corrige solo este documento en esta rendición. El requisito del cliente y las otras
            rendiciones no cambian.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-canal`} className="text-sm font-medium text-foreground">
            Canal
          </label>
          <Select
            id={`${id}-canal`}
            value={canal ?? ''}
            onValueChange={(valor) => {
              const elegido = CanalEntrega.safeParse(valor);
              if (elegido.success) setCanal(elegido.data);
            }}
            options={OPCIONES_CANAL}
          />
        </div>
        {error !== null && <Alert>{error}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={correccion.isPending}>Cancelar</AlertDialogCancel>
          <LoadingButton
            loading={correccion.isPending}
            loadingText="Guardando…"
            onClick={() => void guardar()}
            disabled={sinCambios}
            className="min-w-36"
          >
            Guardar canal
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
