import { MOTIVO_RECHAZO_MAX, type RendicionDetalle } from '@realpolitik/shared';
import { useId, useState, type RefObject } from 'react';

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
import { Textarea } from '@/components/ui/textarea';
import { interpretarFalloCambioDeEstado } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloCambioDeEstado } from '@/modules/rendiciones/components/erroresDeRendicion';
import { useMarcarEstadoDeRendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  AVISO_RENDICION_RECHAZADA,
  etiquetaDePeriodo,
  DESCRIPCION_RECHAZADA_DIALOG,
  ETIQUETA_MOTIVO_RECHAZO,
  PLACEHOLDER_MOTIVO_RECHAZO,
  TEXTO_CONFIRMAR_RESPUESTA,
  TEXTO_GUARDANDO_ESTADO,
  TITULO_RECHAZADA_DIALOG,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface RechazarDialogProps {
  /** La rendición (Enviada) a rechazar. `null` mantiene el diálogo cerrado. */
  rendicion: RendicionDetalle | null;
  onCerrar: () => void;
  /** Se registró el rechazo: avisa en la página con el texto del resultado. */
  onRechazada: (texto: string) => void;
  focoAlCerrar?: RefObject<HTMLElement | null>;
}

/**
 * Registra que el cliente rechazó la rendición (HU3.8): el motivo (qué pidió corregir) es
 * obligatorio, hasta `MOTIVO_RECHAZO_MAX` caracteres. Se confirma solo con un motivo que no sea
 * vacío ni de solo espacios; se manda recortado. Si el servidor lo rechaza, el diálogo sigue abierto
 * con lo escrito y el mensaje debajo del campo.
 */
export function RechazarDialog({
  rendicion,
  onCerrar,
  onRechazada,
  focoAlCerrar,
}: RechazarDialogProps) {
  const id = useId();
  const idCampo = `${id}-motivo`;
  const idError = `${id}-error`;
  const cambio = useMarcarEstadoDeRendicion();
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrada, setMostrada] = useState(rendicion);
  const [motivo, setMotivo] = useState('');
  const [errorDeCampo, setErrorDeCampo] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  if (rendicion !== null && rendicion !== mostrada) {
    // Se abre (o cambia la rendición): campo vacío y sin errores de un intento anterior.
    if (mostrada === null || mostrada.id !== rendicion.id) {
      setMotivo('');
      setErrorDeCampo(null);
      setErrorGeneral(null);
    }
    setMostrada(rendicion);
  }
  const motivoListo = motivo.trim() !== '';

  async function confirmar() {
    if (mostrada === null || cambio.isPending || !motivoListo) return;
    setErrorDeCampo(null);
    setErrorGeneral(null);
    try {
      await cambio.mutateAsync({
        clienteId: mostrada.clienteId,
        rendicionId: mostrada.id,
        datos: { estado: 'RECHAZADA', motivo: motivo.trim() },
      });
    } catch (fallo) {
      const interpretado = interpretarFalloCambioDeEstado(fallo);
      const mensaje = mensajeFalloCambioDeEstado(interpretado, 'RECHAZADA');
      if (interpretado.tipo === 'motivo-invalido') setErrorDeCampo(mensaje);
      else setErrorGeneral(mensaje);
      return;
    }
    onRechazada(AVISO_RENDICION_RECHAZADA);
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
          setMotivo('');
          setErrorDeCampo(null);
          setErrorGeneral(null);
        }
      }}
    >
      <AlertDialogContent
        {...(focoAlCerrar !== undefined && { finalFocus: focoAlCerrar })}
        className="data-[size=default]:sm:max-w-md"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{TITULO_RECHAZADA_DIALOG}</AlertDialogTitle>
          <AlertDialogDescription>
            {mostrada === null ? '' : `Rendición ${etiquetaDePeriodo(mostrada)}. `}
            {DESCRIPCION_RECHAZADA_DIALOG}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idCampo} className="text-sm font-medium text-foreground">
            {ETIQUETA_MOTIVO_RECHAZO}
          </label>
          <Textarea
            id={idCampo}
            value={motivo}
            maxLength={MOTIVO_RECHAZO_MAX}
            required
            placeholder={PLACEHOLDER_MOTIVO_RECHAZO}
            className="min-h-24"
            onChange={(evento) => {
              setMotivo(evento.target.value);
              setErrorDeCampo(null);
            }}
            aria-invalid={errorDeCampo !== null}
            aria-describedby={errorDeCampo === null ? undefined : idError}
            disabled={cambio.isPending}
          />
          {errorDeCampo !== null && (
            <p id={idError} className="text-sm text-destructive">
              {errorDeCampo}
            </p>
          )}
        </div>
        {errorGeneral !== null && <Alert>{errorGeneral}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cambio.isPending}>Cancelar</AlertDialogCancel>
          <LoadingButton
            variant="rechazar-solido"
            loading={cambio.isPending}
            loadingText={TEXTO_GUARDANDO_ESTADO}
            onClick={() => void confirmar()}
            disabled={!motivoListo}
            className="min-w-40"
          >
            {TEXTO_CONFIRMAR_RESPUESTA}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
