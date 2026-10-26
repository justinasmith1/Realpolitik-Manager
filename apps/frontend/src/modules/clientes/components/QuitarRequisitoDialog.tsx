import type { RequisitoCliente } from '@realpolitik/shared';
import { useRef, useState, type RefObject } from 'react';

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

/** Cómo terminó la confirmación. Solo `error` deja el diálogo abierto para reintentar. */
export type ResultadoBaja =
  { tipo: 'hecho' } | { tipo: 'cerrado' } | { tipo: 'error'; mensaje: string };

interface QuitarRequisitoDialogProps {
  /** Requisito a quitar. `null` mantiene el diálogo cerrado. */
  requisito: RequisitoCliente | null;
  denominacion: string;
  onConfirmar: (requisito: RequisitoCliente) => Promise<ResultadoBaja>;
  onCancelar: () => void;
  /** Foco si la fila puede haber desaparecido (la baja salió o el requisito ya no está). */
  focoTrasConfirmar: RefObject<HTMLElement | null>;
  /** Foco al cancelar: el ⋯ de la fila, que sigue en la página. */
  focoAlCancelar: RefObject<HTMLElement | null>;
}

/**
 * Confirmación de la baja lógica. Aclara que afecta a las rendiciones que se abran después y no a
 * las ya abiertas. Espera el 204: no cierra ni da por hecha la baja antes de la respuesta.
 */
export function QuitarRequisitoDialog({
  requisito,
  denominacion,
  onConfirmar,
  onCancelar,
  focoTrasConfirmar,
  focoAlCancelar,
}: QuitarRequisitoDialogProps) {
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrado, setMostrado] = useState(requisito);
  const enCurso = useRef(false);
  if (requisito !== null && requisito !== mostrado) setMostrado(requisito);
  const nombre = mostrado?.tipoDocumento.nombre ?? '';

  async function confirmar() {
    if (requisito === null || enCurso.current) return;
    enCurso.current = true;
    setError(null);
    setPendiente(true);
    const resultado = await onConfirmar(requisito);
    if (resultado.tipo === 'error') {
      enCurso.current = false;
      setError(resultado.mensaje);
      setPendiente(false);
    }
  }

  return (
    <AlertDialog
      open={requisito !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !pendiente) onCancelar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          enCurso.current = false;
          setPendiente(false);
          setError(null);
          setMostrado(null);
        }
      }}
    >
      <AlertDialogContent finalFocus={pendiente ? focoTrasConfirmar : focoAlCancelar}>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Quitar este requisito?</AlertDialogTitle>
          <AlertDialogDescription>
            «{nombre}» dejará de pedirse en las rendiciones que se abran a partir de ahora para{' '}
            {denominacion}. Las rendiciones ya abiertas no se modifican.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null && <Alert>{error}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
          <LoadingButton
            variant="destructive"
            loading={pendiente}
            loadingText="Quitando…"
            onClick={() => void confirmar()}
            className="min-w-40"
          >
            Quitar requisito
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
