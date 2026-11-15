import type { Cliente } from '@realpolitik/shared';
import {
  ClipboardListIcon,
  EllipsisIcon,
  FileTextIcon,
  PencilIcon,
  PowerIcon,
  RotateCcwIcon,
  UsersIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Accion = ((cliente: Cliente) => void) | undefined;

/** Las acciones del menú. Cada una aparece solo si quien lo usa la pasa. */
export interface AccionesDeCliente {
  /** Ficha completa en solo lectura (para quien no edita). */
  onVerFicha?: Accion;
  onEditar?: Accion;
  /** Contactos en solo lectura (para quien no edita). */
  onVerContactos?: Accion;
  /** El editor de contactos. */
  onAdministrarContactos?: Accion;
  /** Abre la matriz de requisitos. También en inactivos: se puede consultar. */
  onVerMatriz?: Accion;
  /** Pide desactivar un cliente activo (la confirmación la resuelve quien la usa). */
  onDesactivar?: Accion;
  onReactivar?: Accion;
}

// Las claves de las acciones (y no cualquier prop: `cambiandoEstado` viaja en el mismo objeto).
const CLAVES_DE_ACCION = [
  'onVerFicha',
  'onEditar',
  'onVerContactos',
  'onAdministrarContactos',
  'onVerMatriz',
  'onDesactivar',
  'onReactivar',
] as const satisfies readonly (keyof AccionesDeCliente)[];

interface ClienteAccionesMenuProps extends AccionesDeCliente {
  cliente: Cliente;
  /** El cambio de estado de este cliente está en curso: Desactivar/Reactivar se deshabilita. */
  cambiandoEstado?: boolean;
}

/**
 * Si el menú tendría algún ítem con estas acciones. Lo usan la tabla y las tarjetas para no
 * dejar una columna o un hueco vacíos. Sirve para cualquier fila: las acciones son las mismas en
 * todas (lo que cambia por estado es cuál de Desactivar/Reactivar se muestra, y ese ítem no
 * decide si hay menú).
 */
export function hayAccionesDeCliente(acciones: AccionesDeCliente): boolean {
  return CLAVES_DE_ACCION.some((clave) => acciones[clave] !== undefined);
}

/**
 * Menú de acciones de una fila: un solo botón "⋯" con las acciones que recibe, en este orden:
 * ficha o Editar, contactos (en lectura o el editor), Ver requisitos y, según el estado,
 * Desactivar (destructivo, en rojo) o Reactivar (en verde).
 *
 * Qué acciones hay lo decide quien lo usa según los permisos de la sesión: el menú no muestra
 * ítems que no hagan nada, y sin ninguno no se dibuja (ni siquiera el botón).
 *
 * El menú solo avisa qué acción se eligió: los paneles y el diálogo de confirmación los abre
 * quien lo usa, fuera del menú. Si vivieran adentro, se desmontarían al cerrarse el menú.
 */
export function ClienteAccionesMenu({
  cliente,
  onVerFicha,
  onEditar,
  onVerContactos,
  onAdministrarContactos,
  onVerMatriz,
  onDesactivar,
  onReactivar,
  cambiandoEstado = false,
}: ClienteAccionesMenuProps) {
  const cambioDeEstado = cliente.estado === 'INACTIVO' ? onReactivar : onDesactivar;
  const hayConsulta =
    onVerFicha !== undefined ||
    onEditar !== undefined ||
    onVerContactos !== undefined ||
    onAdministrarContactos !== undefined ||
    onVerMatriz !== undefined;

  if (!hayConsulta && cambioDeEstado === undefined) return null;

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
        {onVerFicha !== undefined && (
          <DropdownMenuItem onClick={() => onVerFicha(cliente)}>
            <FileTextIcon aria-hidden="true" />
            Ver ficha
          </DropdownMenuItem>
        )}
        {onEditar !== undefined && (
          <DropdownMenuItem onClick={() => onEditar(cliente)}>
            <PencilIcon aria-hidden="true" />
            Editar
          </DropdownMenuItem>
        )}
        {onVerContactos !== undefined && (
          <DropdownMenuItem onClick={() => onVerContactos(cliente)}>
            <UsersIcon aria-hidden="true" />
            Ver contactos
          </DropdownMenuItem>
        )}
        {onAdministrarContactos !== undefined && (
          <DropdownMenuItem onClick={() => onAdministrarContactos(cliente)}>
            <UsersIcon aria-hidden="true" />
            Contactos
          </DropdownMenuItem>
        )}
        {onVerMatriz !== undefined && (
          <DropdownMenuItem onClick={() => onVerMatriz(cliente)}>
            <ClipboardListIcon aria-hidden="true" />
            Ver requisitos
          </DropdownMenuItem>
        )}
        {hayConsulta && cambioDeEstado !== undefined && <DropdownMenuSeparator />}
        {cambioDeEstado !== undefined &&
          (cliente.estado === 'INACTIVO' ? (
            // Verde de éxito, en espejo del rojo de Desactivar: vuelve a dejar operativa la cuenta.
            <DropdownMenuItem
              variant="success"
              disabled={cambiandoEstado}
              onClick={() => cambioDeEstado(cliente)}
            >
              <RotateCcwIcon aria-hidden="true" />
              Reactivar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              disabled={cambiandoEstado}
              onClick={() => cambioDeEstado(cliente)}
            >
              <PowerIcon aria-hidden="true" />
              Desactivar
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
