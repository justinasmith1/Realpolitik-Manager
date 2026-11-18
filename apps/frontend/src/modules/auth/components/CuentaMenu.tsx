import { ChevronsUpDownIcon, KeyRoundIcon, Loader2Icon, LogOutIcon, UsersIcon } from 'lucide-react';
import { useEffect, type Ref } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSidebar } from '@/components/ui/sidebar';
import { useCerrarSesion, usePermiso, useSesion } from '@/modules/auth/hooks/useSesion';
import { ETIQUETA_DE_ROL } from '@/modules/auth/permisos';
import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';

const etiqueta =
  'whitespace-nowrap transition-opacity duration-200 ease-standard group-data-[collapsible=icon]:opacity-0';

interface CuentaMenuProps {
  /** "Cambiar contraseña": abre el panel del cambio voluntario (lo monta `AppLayout`). */
  onCambiarContrasena: () => void;
  /** "Usuarios" (HU4.5): lleva a la administración de cuentas. Solo con `usuarios:administrar`. */
  onUsuarios: () => void;
  /** El disparador del menú: el panel devuelve el foco acá al cerrarse. */
  disparadorRef?: Ref<HTMLButtonElement> | undefined;
  /**
   * El cierre de sesión no se confirmó y la barra lateral está colapsada a íconos: ahí no entra el
   * aviso, así que lo muestra el shell en su aviso de página.
   */
  onErrorAlCerrarSesion: (texto: string) => void;
}

/**
 * Cuenta de la persona con sesión, al pie del sidebar: quién es (nombre, email, rol), "Cambiar
 * contraseña", "Usuarios" (solo con `usuarios:administrar`, HU4.5) y "Cerrar sesión".
 *
 * "Cerrar sesión" espera la confirmación del servidor: si no se puede confirmar, la sesión sigue
 * abierta y se avisa, sin simular que se cerró. Con la barra expandida (o el cajón mobile), el
 * aviso va acá mismo, junto a la cuenta; colapsada a íconos no hay lugar, y lo muestra el shell
 * arriba de la página (`onErrorAlCerrarSesion`). Nunca queda solo para lectores de pantalla.
 */
export function CuentaMenu({
  onCambiarContrasena,
  onUsuarios,
  disparadorRef,
  onErrorAlCerrarSesion,
}: CuentaMenuProps) {
  const usuario = useSesion().data?.usuario;
  const administraUsuarios = usePermiso('usuarios:administrar');
  const { cerrar, cerrando, error, descartarError } = useCerrarSesion();
  const { isMobile, state } = useSidebar();
  const colapsada = state === 'collapsed' && !isMobile;

  // Colapsada (también si se colapsa con el aviso a la vista), el error pasa al aviso de la página
  // y se descarta acá: al volver a expandir no aparece un aviso viejo repetido.
  useEffect(() => {
    if (error === null || !colapsada) {
      return;
    }
    onErrorAlCerrarSesion(error);
    descartarError();
  }, [error, colapsada, onErrorAlCerrarSesion, descartarError]);

  // Debajo de la guarda siempre hay usuario; en el render en que la sesión termina, ya no.
  if (!usuario) {
    return null;
  }
  const rol = ETIQUETA_DE_ROL[usuario.rol];

  return (
    <>
      {error !== null && !colapsada && (
        <div
          role="alert"
          className="flex flex-col gap-1.5 rounded-lg border border-destructive-border bg-destructive-soft p-2.5 text-[13px] leading-snug text-destructive"
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
          ref={disparadorRef}
          // Mientras se cierra la sesión, el estado no depende solo del spinner: el botón queda
          // `aria-busy` (como `LoadingButton`) y su nombre lo dice.
          aria-label={`Cuenta de ${usuario.nombre} (${rol})${cerrando ? ', cerrando sesión' : ''}`}
          aria-busy={cerrando || undefined}
          className="flex min-h-12 w-full items-center gap-2.5 overflow-hidden rounded-lg bg-white/4 px-2.5 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent"
        >
          <span className="relative size-7 shrink-0">
            <ClienteMonogram
              nombre={usuario.nombre}
              className="size-7 shrink-0 rounded-lg bg-[#c8323a] text-[11px] font-semibold text-white"
            />
            {/* Colapsada a íconos solo queda a la vista el monograma (el spinner de la derecha se
                desvanece con las etiquetas y no entra en los 64px): el indicador va encima de él,
                con el fondo oscurecido como señal fija además del giro. Expandida, no se muestra. */}
            {cerrando && (
              <span
                aria-hidden="true"
                data-slot="indicador-cerrando-colapsada"
                className="absolute inset-0 hidden items-center justify-center rounded-lg bg-black/45 group-data-[collapsible=icon]:flex"
              >
                <Loader2Icon className="size-3.5 animate-spin text-white" />
              </span>
            )}
          </span>
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
          <DropdownMenuItem disabled={cerrando} onClick={onCambiarContrasena}>
            <KeyRoundIcon aria-hidden="true" />
            Cambiar contraseña
          </DropdownMenuItem>
          {administraUsuarios && (
            <DropdownMenuItem disabled={cerrando} onClick={onUsuarios}>
              <UsersIcon aria-hidden="true" />
              Usuarios
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={cerrando} onClick={cerrar}>
            <LogOutIcon aria-hidden="true" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
