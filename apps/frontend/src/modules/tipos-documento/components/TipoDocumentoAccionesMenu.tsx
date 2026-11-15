import type { TipoDocumento } from '@realpolitik/shared';
import { EllipsisIcon, PencilIcon, PowerIcon, RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Lo que se puede pedir desde una fila o tarjeta del catálogo. Cada acción aparece solo si quien
 * lo usa la pasa: sin ninguna (quien no edita el catálogo, como CONSULTA) no hay menú (HU4.3).
 */
export interface AccionesTipoDocumento {
  onEditar?: ((tipo: TipoDocumento) => void) | undefined;
  /** Pide desactivar un tipo activo (la confirmación la resuelve quien la usa). */
  onDesactivar?: ((tipo: TipoDocumento) => void) | undefined;
  onReactivar?: ((tipo: TipoDocumento) => void) | undefined;
}

/** Si hay alguna acción: la tabla y las tarjetas no dejan una columna o un hueco vacíos. */
export function hayAccionesDeTipo({ onEditar, onDesactivar, onReactivar }: AccionesTipoDocumento) {
  return onEditar !== undefined || onDesactivar !== undefined || onReactivar !== undefined;
}

interface TipoDocumentoAccionesMenuProps extends AccionesTipoDocumento {
  tipo: TipoDocumento;
  /** El cambio de estado de este tipo está en curso: Desactivar/Reactivar se deshabilita. */
  cambiandoEstado: boolean;
}

/**
 * Menú de acciones de un tipo, como el de clientes: un botón "⋯" que despliega Editar y, según el
 * estado, Desactivar (en rojo) o Reactivar (en verde). No hay borrado: un tipo se desactiva.
 *
 * El menú solo avisa qué acción se eligió: el panel y el diálogo de confirmación los abre quien lo
 * usa, fuera del menú. Si vivieran adentro, se desmontarían al cerrarse el menú.
 */
export function TipoDocumentoAccionesMenu({
  tipo,
  onEditar,
  onDesactivar,
  onReactivar,
  cambiandoEstado,
}: TipoDocumentoAccionesMenuProps) {
  const cambioDeEstado = tipo.activo ? onDesactivar : onReactivar;
  if (onEditar === undefined && cambioDeEstado === undefined) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Acciones de ${tipo.nombre}`} />}
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {onEditar !== undefined && (
          <DropdownMenuItem onClick={() => onEditar(tipo)}>
            <PencilIcon aria-hidden="true" />
            Editar
          </DropdownMenuItem>
        )}
        {onEditar !== undefined && cambioDeEstado !== undefined && <DropdownMenuSeparator />}
        {cambioDeEstado !== undefined &&
          (tipo.activo ? (
            <DropdownMenuItem
              variant="destructive"
              disabled={cambiandoEstado}
              onClick={() => cambioDeEstado(tipo)}
            >
              <PowerIcon aria-hidden="true" />
              Desactivar
            </DropdownMenuItem>
          ) : (
            // Verde de éxito, en espejo del rojo de Desactivar: vuelve a dejarlo disponible.
            <DropdownMenuItem
              variant="success"
              disabled={cambiandoEstado}
              onClick={() => cambioDeEstado(tipo)}
            >
              <RotateCcwIcon aria-hidden="true" />
              Reactivar
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
