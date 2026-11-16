import type { UsuarioAdministrado } from '@realpolitik/shared';
import { EllipsisIcon, KeyRoundIcon, PencilIcon, PowerIcon, RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Lo que se puede pedir desde una fila o tarjeta del listado. */
export interface AccionesUsuario {
  onEditar: (usuario: UsuarioAdministrado) => void;
  onRestablecer: (usuario: UsuarioAdministrado) => void;
  onDesactivar: (usuario: UsuarioAdministrado) => void;
  onReactivar: (usuario: UsuarioAdministrado) => void;
}

interface UsuarioAccionesMenuProps extends AccionesUsuario {
  usuario: UsuarioAdministrado;
  /** Es la cuenta de la sesión: solo se ofrece editar el nombre. */
  propia: boolean;
}

/**
 * Menú "⋯" de una cuenta, como el de tipos de documento: Editar y, si no es la propia, Restablecer
 * contraseña y Desactivar (en rojo) o Reactivar (en verde). En la propia cuenta esas acciones no
 * aparecen (tampoco deshabilitadas): el servidor las rechazaría, y la contraseña propia se cambia
 * desde el menú de cuenta. No hay borrado: una cuenta se desactiva.
 *
 * El menú solo avisa qué se eligió: los paneles y diálogos los abre la página, fuera del menú.
 */
export function UsuarioAccionesMenu({
  usuario,
  propia,
  onEditar,
  onRestablecer,
  onDesactivar,
  onReactivar,
}: UsuarioAccionesMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Acciones de ${usuario.nombre}`} />}
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onEditar(usuario)}>
          <PencilIcon aria-hidden="true" />
          Editar
        </DropdownMenuItem>
        {!propia && (
          <>
            <DropdownMenuItem onClick={() => onRestablecer(usuario)}>
              <KeyRoundIcon aria-hidden="true" />
              Restablecer contraseña
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {usuario.activo ? (
              <DropdownMenuItem variant="destructive" onClick={() => onDesactivar(usuario)}>
                <PowerIcon aria-hidden="true" />
                Desactivar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="success" onClick={() => onReactivar(usuario)}>
                <RotateCcwIcon aria-hidden="true" />
                Reactivar
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
