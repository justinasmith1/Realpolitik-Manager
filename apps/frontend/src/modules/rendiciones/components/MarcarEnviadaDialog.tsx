import {
  diaDelUltimoRechazo,
  hoyEnBuenosAires,
  primerDiaDeEnvio,
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
  /** La rendición (Completa) a marcar como enviada. */
  rendicion: RendicionDetalle;
  /**
   * Si se ve. Quien lo abre le pone una `key` que cambia en cada apertura (`useAperturaDeDialogo`):
   * así arranca limpio, sin la fecha ni los errores de un intento anterior. Al cerrar, la rendición sigue ahí
   * y el contenido no desaparece durante la animación.
   */
  abierto: boolean;
  onCerrar: () => void;
  /** Se registró el envío: avisa en la página con el texto del resultado. */
  onEnviada: (texto: string) => void;
  focoAlCerrar?: RefObject<HTMLElement | null>;
}

/**
 * Registra que la operadora mandó la rendición (HU3.7): el sistema no envía nada, solo guarda el
 * paso a Enviada con la fecha del envío. Por defecto hoy; no se aceptan fechas futuras ni
 * anteriores al primer día del período (`problemaDeFechaEnvio`, la misma regla del servidor, que
 * vuelve a comprobarla). En un reenvío (HU3.9), tampoco anteriores al día del último rechazo: el
 * selector arranca ahí. Lo abren "Marcar como enviada" del detalle y "Ya la envié" del diálogo de
 * envío.
 */
export function MarcarEnviadaDialog({
  rendicion,
  abierto,
  onCerrar,
  onEnviada,
  focoAlCerrar,
}: MarcarEnviadaDialogProps) {
  const id = useId();
  const idCampo = `${id}-fecha`;
  const idError = `${id}-error`;
  const cambio = useMarcarEstadoDeRendicion();
  const [fecha, setFecha] = useState(() => hoyEnBuenosAires());
  const [errorDeCampo, setErrorDeCampo] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // El día del último rechazo (HU3.9): el reenvío no puede ser anterior.
  const rechazo = diaDelUltimoRechazo(rendicion.historial);

  async function confirmar() {
    if (cambio.isPending) return;
    setErrorGeneral(null);
    const problema = problemaDeFechaEnvio(fecha, rendicion, new Date(), rechazo);
    setErrorDeCampo(problema);
    if (problema !== null) return;
    try {
      await cambio.mutateAsync({
        clienteId: rendicion.clienteId,
        rendicionId: rendicion.id,
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
      open={abierto}
      onOpenChange={(abrir) => {
        if (!abrir && !cambio.isPending) onCerrar();
      }}
    >
      <AlertDialogContent
        {...(focoAlCerrar !== undefined && { finalFocus: focoAlCerrar })}
        className="data-[size=default]:sm:max-w-sm"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{TITULO_MARCAR_ENVIADA}</AlertDialogTitle>
          <AlertDialogDescription>
            {`Rendición ${etiquetaDePeriodo(rendicion)}. `}
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
            min={primerDiaDeEnvio(rendicion, rechazo)}
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
