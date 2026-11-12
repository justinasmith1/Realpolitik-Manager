import { ChevronsUpDownIcon, Loader2Icon, LogOutIcon } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCerrarSesion, useSesion } from '@/modules/auth/hooks/useSesion';
import { ETIQUETA_DE_ROL } from '@/modules/auth/permisos';
import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';

const etiqueta =
  'whitespace-nowrap transition-opacity duration-200 ease-standard group-data-[collapsible=icon]:opacity-0';

/**
 * Cuenta de la persona con sesión, al pie del sidebar: quién es, su rol y "Cerrar sesión".
 * Versión mínima de HU4.1 (el cambio voluntario de contraseña llega con HU4.2).
 *
 * "Cerrar sesión" espera la confirmación del servidor: si no se puede confirmar, la sesión sigue
 * abierta y se avisa acá mismo, sin simular que se cerró.
 */
export function CuentaMenu() {
  const usuario = useSesion().data?.usuario;
  const { cerrar, cerrando, error, descartarError } = useCerrarSesion();
  // Debajo de la guarda siempre hay usuario; en el render en que la sesión termina, ya no.
  if (!usuario) {
    return null;
  }
  const rol = ETIQUETA_DE_ROL[usuario.rol];

  return (
    <>
      {error !== null && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-lg border border-destructive-border bg-destructive-soft p-2.5 text-[13px] leading-snug text-destructive group-data-[collapsible=icon]:sr-only"
        >
          {error}
          <button
            type="button"
            onClick={descartarError}
            className="self-start font-medium underline underline-offset-2"
          >
            Entendido
          </button>
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Cuenta de ${usuario.nombre} (${rol})`}
          className="flex min-h-12 w-full items-center gap-2.5 overflow-hidden rounded-lg bg-white/4 px-2.5 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent"
        >
          <ClienteMonogram
            nombre={usuario.nombre}
            className="size-7 shrink-0 rounded-lg bg-[#c8323a] text-[11px] font-semibold text-white"
          />
          <span className={`flex min-w-0 flex-1 flex-col gap-px ${etiqueta}`}>
            <span className="truncate text-[13.5px] font-medium text-white">{usuario.nombre}</span>
            <span className="text-xs text-[#a29a97]">{rol}</span>
          </span>
          {cerrando ? (
            <Loader2Icon aria-hidden="true" className={`size-3.5 animate-spin ${etiqueta}`} />
          ) : (
            <ChevronsUpDownIcon
              aria-hidden="true"
              className={`size-3.5 shrink-0 text-[#a29a97] ${etiqueta}`}
            />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-63">
          <div className="mb-1 flex flex-col gap-0.5 border-b px-2.5 pt-2 pb-2.5">
            <span className="text-sm font-semibold">{usuario.nombre}</span>
            <span className="text-[12.5px] wrap-anywhere text-content-secondary">
              {usuario.email}
            </span>
            <span className="mt-1.5 self-start rounded border border-primary bg-primary px-2 text-[11.5px] leading-5 font-semibold text-primary-foreground">
              {rol}
            </span>
          </div>
          <DropdownMenuItem disabled={cerrando} onClick={cerrar}>
            <LogOutIcon aria-hidden="true" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
