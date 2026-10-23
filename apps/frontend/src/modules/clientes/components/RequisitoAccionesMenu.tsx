import type { RequisitoCliente } from '@realpolitik/shared';
import { EllipsisIcon, MinusIcon, PencilIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface RequisitoAccionesMenuProps {
  requisito: RequisitoCliente;
  onEditar: (requisito: RequisitoCliente) => void;
  onQuitar: (requisito: RequisitoCliente) => void;
}

/**
 * Menú de un requisito: Editar y Quitar de la matriz. No dice "eliminar": la baja es lógica y las
 * rendiciones ya abiertas no se tocan.
 *
 * El menú solo avisa la acción. El panel y el diálogo los abre la página, fuera del menú: si
 * vivieran adentro, se desmontarían al cerrarse.
 */
export function RequisitoAccionesMenu({
  requisito,
  onEditar,
  onQuitar,
}: RequisitoAccionesMenuProps) {
  const nombre = requisito.tipoDocumento.nombre;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            id={`acciones-requisito-${requisito.id}`}
            aria-label={`Acciones de ${nombre}`}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onEditar(requisito)}>
          <PencilIcon aria-hidden="true" />
          Editar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => onQuitar(requisito)}>
          <MinusIcon aria-hidden="true" />
          Quitar de la matriz
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
