import type { Cliente } from '@realpolitik/shared';
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

export type AccionDeEstado = 'desactivar' | 'reactivar';

/** El cambio de estado que se está por confirmar. */
export interface CambioAConfirmar {
  cliente: Cliente;
  accion: AccionDeEstado;
}

/**
 * Cómo terminó la confirmación. Solo `error` deja el diálogo abierto, con su mensaje, para
 * reintentar; en los otros casos quien lo usa ya lo cerró y avisó en la página.
 */
export type ResultadoCambioEstado =
  { tipo: 'hecho' } | { tipo: 'no-existe' } | { tipo: 'error'; mensaje: string };

const textos = {
  desactivar: {
    titulo: '¿Desactivar este cliente?',
    descripcion:
      'dejará de aparecer en el listado de activos. Sus datos se conservan y podés reactivarlo cuando quieras desde la vista de inactivos.',
    confirmar: 'Desactivar cliente',
    confirmando: 'Desactivando…',
  },
  reactivar: {
    titulo: '¿Reactivar este cliente?',
    descripcion:
      'volverá a aparecer en el listado de activos. Sus datos y configuración se conservarán.',
    confirmar: 'Reactivar cliente',
    confirmando: 'Reactivando…',
  },
} as const;

interface CambiarEstadoClienteDialogProps {
  /** Lo que se va a confirmar. `null` mantiene el diálogo cerrado. */
  cambio: CambioAConfirmar | null;
  /** Aplica el cambio. El diálogo espera la respuesta: mientras tanto no se puede cancelar. */
  onConfirmar: (cambio: CambioAConfirmar) => Promise<ResultadoCambioEstado>;
  onCancelar: () => void;
  /**
   * A dónde va el foco si el diálogo se cierra por la confirmación. Ahí la fila ya no está en
   * el listado, y con ella el ⋯ desde el que se abrió. Al cancelar, el foco vuelve a ese ⋯.
   */
  focoTrasConfirmar?: RefObject<HTMLElement | null>;
}

/**
 * Confirmación previa a desactivar (HU1.8) o reactivar un cliente. Desactivar aclara que no se
 * borra nada: el cliente solo deja de aparecer en el listado de activos y se puede reactivar.
 *
 * Al confirmar queda abierto con "Desactivando…" / "Reactivando…" hasta que llega la respuesta.
 * Si falla, muestra el error acá mismo y se puede reintentar; si sale bien (o el cliente ya no
 * existe), lo cierra quien lo usa.
 */
export function CambiarEstadoClienteDialog({
  cambio,
  onConfirmar,
  onCancelar,
  focoTrasConfirmar,
}: CambiarEstadoClienteDialogProps) {
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mientras sale, sigue mostrando el último cambio: quien lo usa pasa `cambio` a null al
  // cerrar, y sin esto el diálogo perdería el nombre y los textos durante la salida.
  const [mostrado, setMostrado] = useState(cambio);
  if (cambio !== null && cambio !== mostrado) {
    setMostrado(cambio);
  }
  const accion = mostrado?.accion ?? 'desactivar';
  const texto = textos[accion];

  async function confirmar() {
    if (cambio === null || pendiente) {
      return;
    }
    setError(null);
    setPendiente(true);
    const resultado = await onConfirmar(cambio);
    if (resultado.tipo === 'error') {
      setError(resultado.mensaje);
      setPendiente(false);
    }
    // Si no, ya se está cerrando: `pendiente` sigue hasta que termine de salir, así el botón no
    // vuelve a su texto inicial mientras se va.
  }

  return (
    <AlertDialog
      open={cambio !== null}
      onOpenChange={(abrir) => {
        // Mientras se aplica no se cancela: el resultado tiene que verse.
        if (!abrir && !pendiente) onCancelar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setPendiente(false);
          setError(null);
          setMostrado(null);
        }
      }}
    >
      {/* Solo se cierra estando pendiente si se confirmó: cancelar está bloqueado. */}
      <AlertDialogContent finalFocus={pendiente && focoTrasConfirmar ? focoTrasConfirmar : true}>
        <AlertDialogHeader>
          <AlertDialogTitle>{texto.titulo}</AlertDialogTitle>
          <AlertDialogDescription>
            {mostrado?.cliente.razonSocial} {texto.descripcion}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null && <Alert>{error}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
          <LoadingButton
            // Desactivar en rojo; reactivar en verde, igual que sus opciones en el menú ⋯.
            variant={accion === 'desactivar' ? 'destructive' : 'default'}
            loading={pendiente}
            loadingText={texto.confirmando}
            onClick={() => void confirmar()}
            className={
              accion === 'reactivar'
                ? 'min-w-40 bg-success-soft text-success shadow-none hover:bg-success-border/40 active:bg-success-border/40'
                : 'min-w-40'
            }
          >
            {texto.confirmar}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
