import type { UsuarioAdministrado } from '@realpolitik/shared';
import { useState } from 'react';

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
import type { AvisoDeFallo } from '@/modules/usuarios/components/erroresDeUsuario';

export type AccionSobreUsuario = 'desactivar' | 'reactivar' | 'restablecer';

/** La acción que se está por confirmar, sobre una cuenta ajena. */
export interface AccionAConfirmar {
  usuario: UsuarioAdministrado;
  accion: AccionSobreUsuario;
}

/**
 * Cómo terminó la confirmación. Solo `error` deja el diálogo abierto, con su aviso, para volver a
 * intentar; con `cerrado`, quien lo usa ya lo cerró (y avisó en la página o abrió otro diálogo).
 */
export type ResultadoDeConfirmacion = { tipo: 'cerrado' } | { tipo: 'error'; aviso: AvisoDeFallo };

const textos = {
  desactivar: {
    titulo: '¿Desactivar esta cuenta?',
    descripcion: (nombre: string) =>
      `${nombre} no podrá iniciar sesión y sus sesiones actuales se cerrarán. Podrás reactivar la cuenta más adelante.`,
    confirmar: 'Desactivar usuario',
    confirmando: 'Desactivando…',
  },
  reactivar: {
    titulo: '¿Reactivar esta cuenta?',
    descripcion: (nombre: string) =>
      `${nombre} podrá volver a iniciar sesión con sus credenciales vigentes. Las sesiones anteriores no se recuperarán.`,
    confirmar: 'Reactivar usuario',
    confirmando: 'Reactivando…',
  },
  restablecer: {
    titulo: '¿Restablecer la contraseña?',
    descripcion: (nombre: string) =>
      `Se generará una nueva contraseña temporal para ${nombre}. Sus sesiones actuales se cerrarán y deberá elegir una contraseña propia cuando vuelva a ingresar.`,
    confirmar: 'Restablecer contraseña',
    confirmando: 'Restableciendo…',
  },
} as const;

// Desactivar en rojo y reactivar en verde, como en el menú ⋯; restablecer, el botón principal.
const claseDelBoton: Record<AccionSobreUsuario, string> = {
  desactivar: 'min-w-44',
  reactivar:
    'min-w-44 bg-success-soft text-success shadow-none hover:bg-success-border/40 active:bg-success-border/40',
  restablecer: 'min-w-44',
};

interface ConfirmarAccionUsuarioDialogProps {
  /** Lo que se va a confirmar. `null` mantiene el diálogo cerrado. */
  accion: AccionAConfirmar | null;
  /** Aplica la acción. El diálogo espera la respuesta: mientras tanto no se puede cancelar. */
  onConfirmar: (accion: AccionAConfirmar) => Promise<ResultadoDeConfirmacion>;
  onCancelar: () => void;
  /**
   * A dónde va el foco si se cerró por la confirmación: la fila pudo salir del listado (una cuenta
   * desactivada en la vista de activas), y con ella el ⋯. `false`: no se mueve (lo tomó otro
   * diálogo, el de la contraseña temporal). Al cancelar, vuelve al ⋯.
   */
  focoTrasConfirmar: () => HTMLElement | false | null;
}

/**
 * Confirmación de las acciones sensibles sobre una cuenta: desactivar, reactivar y restablecer la
 * contraseña. Las tres usan el mismo mecanismo que el cambio de estado de un tipo de documento: al
 * confirmar queda abierto con "…ando" hasta la respuesta, sin poder cancelar ni repetir; si falla
 * con algo que se puede reintentar, muestra el aviso acá mismo.
 */
export function ConfirmarAccionUsuarioDialog({
  accion,
  onConfirmar,
  onCancelar,
  focoTrasConfirmar,
}: ConfirmarAccionUsuarioDialogProps) {
  const [pendiente, setPendiente] = useState(false);
  const [aviso, setAviso] = useState<AvisoDeFallo | null>(null);
  const [mostrada, setMostrada] = useState(accion);
  if (accion !== null && accion !== mostrada) {
    setMostrada(accion);
  }
  const tipo = mostrada?.accion ?? 'desactivar';
  const texto = textos[tipo];

  async function confirmar() {
    if (accion === null || pendiente) return;
    setAviso(null);
    setPendiente(true);
    const resultado = await onConfirmar(accion);
    if (resultado.tipo === 'error') {
      setAviso(resultado.aviso);
      setPendiente(false);
    }
    // Si no, ya se está cerrando: `pendiente` sigue hasta que termine de salir.
  }

  return (
    <AlertDialog
      open={accion !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !pendiente) onCancelar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setPendiente(false);
          setAviso(null);
          setMostrada(null);
        }
      }}
    >
      <AlertDialogContent finalFocus={() => (pendiente ? (focoTrasConfirmar() ?? true) : true)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{texto.titulo}</AlertDialogTitle>
          <AlertDialogDescription>
            {texto.descripcion(mostrada?.usuario.nombre ?? '')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {aviso !== null && <Alert variant={aviso.variante}>{aviso.texto}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
          <LoadingButton
            variant={tipo === 'desactivar' ? 'destructive' : 'default'}
            loading={pendiente}
            loadingText={texto.confirmando}
            onClick={() => void confirmar()}
            className={claseDelBoton[tipo]}
          >
            {texto.confirmar}
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
