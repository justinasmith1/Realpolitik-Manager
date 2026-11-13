import type { RendicionDetalle } from '@realpolitik/shared';
import { useState, type RefObject } from 'react';

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
import { interpretarFalloCobro } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloCobro } from '@/modules/rendiciones/components/erroresDeRendicion';
import { useQuitarCobro } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  AVISO_COBRO_QUITADO,
  DESCRIPCION_QUITAR_COBRO_DIALOG,
  TEXTO_QUITAR_MARCA,
  TITULO_QUITAR_COBRO_DIALOG,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface QuitarCobroDialogProps {
  /** La rendición cobrada. `null` mantiene el diálogo cerrado. */
  rendicion: RendicionDetalle | null;
  onCerrar: () => void;
  /** Se quitó la marca: avisa en la página con el texto del resultado. */
  onQuitado: (texto: string) => void;
  focoAlCerrar?: RefObject<HTMLElement | null>;
}

/**
 * Confirma que se quita la marca de cobrada (HU3.10). Se borran la fecha y la nota y no queda
 * historial, así que se pide una confirmación. Si el servidor lo rechaza (p. ej. se anuló mientras
 * tanto), el diálogo sigue abierto con el motivo.
 */
export function QuitarCobroDialog({
  rendicion,
  onCerrar,
  onQuitado,
  focoAlCerrar,
}: QuitarCobroDialogProps) {
  const quita = useQuitarCobro();
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrada, setMostrada] = useState(rendicion);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  if (rendicion !== null && rendicion !== mostrada) {
    // Se abre (o cambia la rendición): sin errores de un intento anterior.
    if (mostrada === null || mostrada.id !== rendicion.id) setErrorGeneral(null);
    setMostrada(rendicion);
  }

  async function confirmar() {
    if (mostrada === null || quita.isPending) return;
    setErrorGeneral(null);
    try {
      await quita.mutateAsync({ clienteId: mostrada.clienteId, rendicionId: mostrada.id });
    } catch (fallo) {
      setErrorGeneral(mensajeFalloCobro(interpretarFalloCobro(fallo)).general ?? null);
      return;
    }
    onQuitado(AVISO_COBRO_QUITADO);
  }

  return (
    <AlertDialog
      open={rendicion !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !quita.isPending) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setMostrada(null);
          setErrorGeneral(null);
        }
      }}
    >
      <AlertDialogContent
        {...(focoAlCerrar !== undefined && { finalFocus: focoAlCerrar })}
        className="data-[size=default]:sm:max-w-sm"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{TITULO_QUITAR_COBRO_DIALOG}</AlertDialogTitle>
          <AlertDialogDescription>{DESCRIPCION_QUITAR_COBRO_DIALOG}</AlertDialogDescription>
        </AlertDialogHeader>
        {errorGeneral !== null && <Alert>{errorGeneral}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={quita.isPending}>Cancelar</AlertDialogCancel>
          <LoadingButton
            loading={quita.isPending}
            loadingText="Quitando…"
            onClick={() => void confirmar()}
            className="min-w-32"
          >
            {TEXTO_QUITAR_MARCA}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
