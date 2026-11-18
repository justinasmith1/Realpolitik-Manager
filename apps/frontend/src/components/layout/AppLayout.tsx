import { useRef, useState, type CSSProperties } from 'react';
import { Outlet } from 'react-router';

import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { Alert } from '@/components/ui/alert';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAvisoDePagina } from '@/hooks/use-aviso-de-pagina';
import {
  CambiarContrasenaSheet,
  MENSAJE_CONTRASENA_CAMBIADA,
} from '@/modules/auth/components/CambiarContrasenaSheet';

// Anchos del handoff: 220px expandido, 64px colapsado a íconos.
const sidebarWidths = {
  '--sidebar-width': '220px',
  '--sidebar-width-icon': '64px',
} as CSSProperties;

/**
 * El shell: sidebar, encabezado mobile y la página. Monta además el cambio voluntario de
 * contraseña (se abre desde el menú de cuenta, sobre cualquier pantalla) y su aviso de éxito, que
 * se muestra arriba de la página sin navegar ni recargar sus datos.
 */
export function AppLayout() {
  const [cambioAbierto, setCambioAbierto] = useState(false);
  const cuentaRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const { aviso, avisar, cerrar, quitar } = useAvisoDePagina({
    avisoRef,
    destinoDelFoco: mainRef,
  });

  return (
    <TooltipProvider>
      <SidebarProvider style={sidebarWidths} className="bg-background">
        <AppSidebar
          onCambiarContrasena={() => setCambioAbierto(true)}
          cuentaRef={cuentaRef}
          // Con la barra colapsada a íconos, el error del cierre de sesión se ve acá, en la página.
          onErrorAlCerrarSesion={(texto) => avisar('destructive', texto)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
            {aviso !== null && (
              <div className="px-4 pt-4 md:px-6">
                <Alert
                  key={aviso.id}
                  ref={avisoRef}
                  variant={aviso.variante}
                  saliendo={aviso.cerrando}
                  onCerrar={() => cerrar(aviso.id)}
                  onAnimationEnd={(evento) => {
                    if (aviso.cerrando && evento.target === evento.currentTarget) {
                      quitar(aviso.id);
                    }
                  }}
                >
                  {aviso.texto}
                </Alert>
              </div>
            )}
            <Outlet />
          </main>
        </div>
        <CambiarContrasenaSheet
          abierto={cambioAbierto}
          onAbiertoChange={setCambioAbierto}
          onCambiada={() => {
            setCambioAbierto(false);
            avisar('success', MENSAJE_CONTRASENA_CAMBIADA);
          }}
          // En mobile el menú quedó dentro del cajón cerrado: el foco vuelve al botón que lo abre.
          focoAlCerrar={() =>
            cuentaRef.current?.isConnected === true
              ? cuentaRef.current
              : (document.querySelector<HTMLElement>('header [data-sidebar="trigger"]') ??
                mainRef.current)
          }
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}
