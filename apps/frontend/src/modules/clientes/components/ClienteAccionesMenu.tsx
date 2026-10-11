import type { Cliente } from '@realpolitik/shared';
import { EllipsisIcon, PencilIcon, PowerIcon, RotateCcwIcon, UsersIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ClienteAccionesMenuProps {
  cliente: Cliente;
  onEditar?: ((cliente: Cliente) => void) | undefined;
  onAdministrarContactos?: ((cliente: Cliente) => void) | undefined;
  /** Pide desactivar un cliente activo (la confirmación la resuelve quien la usa). */
  onDesactivar?: ((cliente: Cliente) => void) | undefined;
  onReactivar?: ((cliente: Cliente) => void) | undefined;
  /** El cambio de estado de este cliente está en curso: Desactivar/Reactivar se deshabilita. */
  cambiandoEstado?: boolean;
}

/**
 * Menú de acciones de una fila: un solo botón "⋯" que despliega Editar, Contactos y, según el
 * estado, Desactivar (destructivo, en rojo) o Reactivar (en verde).
 *
 * El menú solo avisa qué acción se eligió: los paneles y el diálogo de confirmación los abre
 * quien lo usa, fuera del menú. Si vivieran adentro, se desmontarían al cerrarse el menú.
 */
export function ClienteAccionesMenu({
  cliente,
  onEditar,
  onAdministrarContactos,
  onDesactivar,
  onReactivar,
  cambiandoEstado = false,
}: ClienteAccionesMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={`Acciones de ${cliente.razonSocial}`} />
        }
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onEditar?.(cliente)}>
          <PencilIcon aria-hidden="true" />
          Editar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAdministrarContactos?.(cliente)}>
          <UsersIcon aria-hidden="true" />
          Contactos
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {cliente.estado === 'INACTIVO' ? (
          // Verde de éxito, en espejo del rojo de Desactivar: vuelve a dejar operativa la cuenta.
          <DropdownMenuItem
            variant="success"
            disabled={cambiandoEstado}
            onClick={() => onReactivar?.(cliente)}
          >
            <RotateCcwIcon aria-hidden="true" />
            Reactivar
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            disabled={cambiandoEstado}
            onClick={() => onDesactivar?.(cliente)}
          >
            <PowerIcon aria-hidden="true" />
            Desactivar
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
