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
import { interpretarFalloCambioDeEstado } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloCambioDeEstado } from '@/modules/rendiciones/components/erroresDeRendicion';
import { useMarcarEstadoDeRendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  AVISO_RENDICION_APROBADA,
  DESCRIPCION_CONFIRMAR_APROBACION,
  TEXTO_CONFIRMAR_RESPUESTA,
  TEXTO_GUARDANDO_ESTADO,
  TITULO_APROBADA_DIALOG,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface AprobarRendicionDialogProps {
  /** La rendición (Enviada) a aprobar. `null` mantiene el diálogo cerrado. */
  rendicion: RendicionDetalle | null;
  onCerrar: () => void;
  /** Se registró la aprobación: avisa en la página con el texto del resultado. */
  onAprobada: (texto: string) => void;
  focoAlCerrar?: RefObject<HTMLElement | null>;
}

/**
 * Confirma que el cliente aprobó la rendición (HU3.8). Es una confirmación simple, sin campos: la
 * aprobación cierra la rendición y no se deshace, así que se pide una confirmación antes de
 * mandarla. Si el servidor la rechaza (p. ej. otra persona ya respondió), el diálogo sigue abierto
 * con el motivo.
 */
export function AprobarRendicionDialog({
  rendicion,
  onCerrar,
  onAprobada,
  focoAlCerrar,
}: AprobarRendicionDialogProps) {
  const cambio = useMarcarEstadoDeRendicion();
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrada, setMostrada] = useState(rendicion);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  if (rendicion !== null && rendicion !== mostrada) {
    // Se abre (o cambia la rendición): sin errores de un intento anterior.
    if (mostrada === null || mostrada.id !== rendicion.id) setErrorGeneral(null);
    setMostrada(rendicion);
  }

  async function confirmar() {
    if (mostrada === null || cambio.isPending) return;
    setErrorGeneral(null);
    try {
      await cambio.mutateAsync({
        clienteId: mostrada.clienteId,
        rendicionId: mostrada.id,
        datos: { estado: 'APROBADA' },
      });
    } catch (fallo) {
      setErrorGeneral(
        mensajeFalloCambioDeEstado(interpretarFalloCambioDeEstado(fallo), 'APROBADA'),
      );
      return;
    }
    onAprobada(AVISO_RENDICION_APROBADA);
  }

  return (
    <AlertDialog
      open={rendicion !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !cambio.isPending) onCerrar();
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
          <AlertDialogTitle>{TITULO_APROBADA_DIALOG}</AlertDialogTitle>
          <AlertDialogDescription>{DESCRIPCION_CONFIRMAR_APROBACION}</AlertDialogDescription>
        </AlertDialogHeader>
        {errorGeneral !== null && <Alert>{errorGeneral}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cambio.isPending}>Cancelar</AlertDialogCancel>
          <LoadingButton
            variant="aprobar"
            loading={cambio.isPending}
            loadingText={TEXTO_GUARDANDO_ESTADO}
            onClick={() => void confirmar()}
            className="min-w-32"
          >
            {TEXTO_CONFIRMAR_RESPUESTA}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
