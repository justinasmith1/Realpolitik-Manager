import {
  hoyEnBuenosAires,
  primerDiaDelPeriodo,
  problemaDeFechaEnvio,
  type RendicionDetalle,
} from '@realpolitik/shared';
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
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { interpretarFalloCambioDeEstado } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloCambioDeEstado } from '@/modules/rendiciones/components/erroresDeRendicion';
import { useMarcarEstadoDeRendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  avisoRendicionEnviada,
  ETIQUETA_FECHA_ENVIO,
  etiquetaDePeriodo,
  TEXTO_CONFIRMAR_ENVIO,
  TEXTO_GUARDANDO_ESTADO,
  TITULO_MARCAR_ENVIADA,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface MarcarEnviadaDialogProps {
  /** La rendición (Completa) a marcar como enviada. `null` mantiene el diálogo cerrado. */
  rendicion: RendicionDetalle | null;
  onCerrar: () => void;
  /** Se registró el envío: avisa en la página con el texto del resultado. */
  onEnviada: (texto: string) => void;
  focoAlCerrar?: RefObject<HTMLElement | null>;
}

/**
 * Registra que la operadora mandó la rendición (HU3.7): el sistema no envía nada, solo guarda el
 * paso a Enviada con la fecha del envío. Por defecto hoy; no se aceptan fechas futuras ni
 * anteriores al primer día del período (`problemaDeFechaEnvio`, la misma regla del servidor, que
 * vuelve a comprobarla). Lo abren "Marcar como enviada" del detalle y "Ya la envié" del diálogo
 * de envío.
 */
export function MarcarEnviadaDialog({
  rendicion,
  onCerrar,
  onEnviada,
  focoAlCerrar,
}: MarcarEnviadaDialogProps) {
  const id = useId();
  const idCampo = `${id}-fecha`;
  const idError = `${id}-error`;
  const cambio = useMarcarEstadoDeRendicion();
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrada, setMostrada] = useState(rendicion);
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires());
  const [errorDeCampo, setErrorDeCampo] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  if (rendicion !== null && rendicion !== mostrada) {
    // Se abre (o cambia la rendición): vuelve a hoy, sin errores de un intento anterior.
    if (mostrada === null || mostrada.id !== rendicion.id) {
      setFecha(hoyEnBuenosAires());
      setErrorDeCampo(null);
      setErrorGeneral(null);
    }
    setMostrada(rendicion);
  }

  async function confirmar() {
    if (mostrada === null || cambio.isPending) return;
    setErrorGeneral(null);
    const problema = problemaDeFechaEnvio(fecha, mostrada);
    setErrorDeCampo(problema);
    if (problema !== null) return;
    try {
      await cambio.mutateAsync({
        clienteId: mostrada.clienteId,
        rendicionId: mostrada.id,
        datos: { estado: 'ENVIADA', fechaEnvio: fecha },
      });
    } catch (fallo) {
      const interpretado = interpretarFalloCambioDeEstado(fallo);
      const mensaje = mensajeFalloCambioDeEstado(interpretado, 'ENVIADA');
      if (interpretado.tipo === 'fecha-invalida') setErrorDeCampo(mensaje);
      else setErrorGeneral(mensaje);
      return;
    }
    onEnviada(avisoRendicionEnviada(fecha));
  }

  return (
    <AlertDialog
      open={rendicion !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !cambio.isPending) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) setMostrada(null);
      }}
    >
      <AlertDialogContent
        {...(focoAlCerrar !== undefined && { finalFocus: focoAlCerrar })}
        className="data-[size=default]:sm:max-w-sm"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{TITULO_MARCAR_ENVIADA}</AlertDialogTitle>
          <AlertDialogDescription>
            {mostrada === null ? '' : `Rendición ${etiquetaDePeriodo(mostrada)}. `}
            El sistema no envía nada: registrá el día en que la mandaste.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          noValidate
          className="flex flex-col gap-1.5"
          onSubmit={(evento) => {
            evento.preventDefault();
            void confirmar();
          }}
        >
          <label htmlFor={idCampo} className="text-sm font-medium text-foreground">
            {ETIQUETA_FECHA_ENVIO}
          </label>
          <Input
            id={idCampo}
            type="date"
            value={fecha}
            max={hoyEnBuenosAires()}
            {...(mostrada !== null && { min: primerDiaDelPeriodo(mostrada) })}
            onChange={(evento) => {
              setFecha(evento.target.value);
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
          {/* Enter en el campo confirma, como el botón del pie. */}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
        {errorGeneral !== null && <Alert>{errorGeneral}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cambio.isPending}>Cancelar</AlertDialogCancel>
          <LoadingButton
            loading={cambio.isPending}
            loadingText={TEXTO_GUARDANDO_ESTADO}
            onClick={() => void confirmar()}
            className="min-w-32"
          >
            {TEXTO_CONFIRMAR_ENVIO}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
