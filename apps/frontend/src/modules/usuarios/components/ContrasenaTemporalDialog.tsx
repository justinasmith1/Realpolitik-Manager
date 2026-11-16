import type { UsuarioAdministrado } from '@realpolitik/shared';
import { CopyIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

/** Una contraseña temporal recién recibida, y de quién es. Vive solo mientras se muestra. */
export interface EntregaDeContrasena {
  origen: 'alta' | 'restablecimiento';
  usuario: UsuarioAdministrado;
  contrasena: string;
}

export const ADVERTENCIA_CONTRASENA_TEMPORAL =
  'Entregásela por un canal seguro. No la vas a poder ver de nuevo.';
export const MENSAJE_COPIADA = 'Contraseña copiada.';
export const MENSAJE_COPIA_FALLIDA =
  'No pudimos copiarla. Seleccioná la contraseña y copiala a mano.';

const titulos = { alta: 'Usuario creado', restablecimiento: 'Contraseña restablecida' } as const;

interface ContrasenaTemporalDialogProps {
  /** La contraseña a mostrar. `null` mantiene el diálogo cerrado. */
  entrega: EntregaDeContrasena | null;
  /** "Cerrar": quien lo usa descarta la entrega. */
  onCerrar: () => void;
  /** A dónde vuelve el foco al cerrar: el lugar desde el que se pidió puede ya no estar. */
  focoAlCerrar: (origen: EntregaDeContrasena['origen']) => HTMLElement | null;
}

/**
 * Muestra UNA vez la contraseña temporal de un alta o un restablecimiento. No hay forma de volver a
 * verla: la entrega vive solo en el estado de quien abre el diálogo y en este, mientras se ve. No se
 * guarda en el navegador, ni en la URL, ni en la caché de TanStack Query, y no se registra; al
 * cerrarse se descartan todas las referencias (JavaScript no garantiza borrar la cadena de la
 * memoria, pero nada la retiene).
 *
 * Para no perderla por accidente, solo se cierra con "Cerrar": ni Escape ni un clic afuera. El foco
 * arranca en "Copiar contraseña" y el resultado de copiar se anuncia; la contraseña en sí nunca va
 * a una región en vivo.
 */
export function ContrasenaTemporalDialog({
  entrega,
  onCerrar,
  focoAlCerrar,
}: ContrasenaTemporalDialogProps) {
  const copiarRef = useRef<HTMLButtonElement>(null);
  const [copia, setCopia] = useState<'copiada' | 'fallida' | null>(null);
  // Mientras sale, sigue mostrando la entrega (quien lo usa ya la pasó a null); al terminar de
  // salir, se descarta.
  const [mostrada, setMostrada] = useState(entrega);
  if (entrega !== null && entrega !== mostrada) {
    setMostrada(entrega);
    setCopia(null);
  }

  async function copiar() {
    if (mostrada === null) return;
    try {
      // Sin `navigator.clipboard` (contexto inseguro, navegador viejo) también cae al catch.
      await navigator.clipboard.writeText(mostrada.contrasena);
      setCopia('copiada');
    } catch {
      setCopia('fallida');
    }
  }

  return (
    <AlertDialog
      open={entrega !== null}
      onOpenChange={(abrir, detalles) => {
        if (!abrir && detalles.reason !== 'escape-key') onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setMostrada(null);
          setCopia(null);
        }
      }}
    >
      <AlertDialogContent
        initialFocus={copiarRef}
        finalFocus={() => (mostrada === null ? null : focoAlCerrar(mostrada.origen)) ?? true}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{mostrada === null ? '' : titulos[mostrada.origen]}</AlertDialogTitle>
          <AlertDialogDescription>
            Contraseña temporal de{' '}
            <span className="font-medium text-foreground wrap-anywhere">
              {mostrada?.usuario.nombre} ({mostrada?.usuario.email})
            </span>
            . Al ingresar con ella, va a tener que elegir una propia.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <p
          translate="no"
          className="rounded-lg border bg-muted px-3 py-2.5 font-mono text-base break-all select-all"
        >
          {mostrada?.contrasena}
        </p>

        <p className="text-sm font-medium">{ADVERTENCIA_CONTRASENA_TEMPORAL}</p>

        {/* Solo el resultado de copiar se anuncia; nunca la contraseña. */}
        <p
          role="status"
          className={copia === 'fallida' ? 'text-sm text-destructive' : 'text-sm text-success'}
        >
          {copia === 'copiada' ? MENSAJE_COPIADA : copia === 'fallida' ? MENSAJE_COPIA_FALLIDA : ''}
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel>Cerrar</AlertDialogCancel>
          <Button ref={copiarRef} onClick={() => void copiar()} className="min-w-44">
            <CopyIcon aria-hidden="true" />
            Copiar contraseña
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
