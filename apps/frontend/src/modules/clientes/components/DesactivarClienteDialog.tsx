import type { Cliente } from '@realpolitik/shared';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DesactivarClienteDialogProps {
  /** Cliente a desactivar. `null` mantiene el diálogo cerrado. */
  cliente: Cliente | null;
  onConfirmar: (cliente: Cliente) => void;
  onCancelar: () => void;
}

/**
 * Confirmación previa a desactivar un cliente (HU1.8). Aclara que no se borra nada: el
 * cliente solo deja de aparecer en el listado de activos y se puede reactivar.
 */
export function DesactivarClienteDialog({
  cliente,
  onConfirmar,
  onCancelar,
}: DesactivarClienteDialogProps) {
  return (
    <AlertDialog
      open={cliente !== null}
      onOpenChange={(abrir) => {
        if (!abrir) onCancelar();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desactivar este cliente?</AlertDialogTitle>
          <AlertDialogDescription>
            {cliente?.razonSocial} dejará de aparecer en el listado de activos. Sus datos se
            conservan y podés reactivarlo cuando quieras desde la vista de inactivos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (cliente !== null) onConfirmar(cliente);
            }}
          >
            Desactivar cliente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
