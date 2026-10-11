import { useMatches } from 'react-router';

import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';

/** Datos que una ruta puede declarar en `handle` para el shell. */
export interface AppRouteHandle {
  /** Nombre de la sección, mostrado en el Header (mobile). */
  title: string;
}

function isAppRouteHandle(handle: unknown): handle is AppRouteHandle {
  return typeof handle === 'object' && handle !== null && 'title' in handle;
}

/**
 * Barra superior, solo en mobile: ahí el Sidebar es un cajón y hace falta un botón para
 * abrirlo, con el nombre de la sección al lado. En escritorio no se muestra: el Sidebar ya está
 * a la vista (con su propio botón de colapsar) y la página tiene su h1, así que el título
 * quedaría repetido en una barra vacía.
 */
export function AppHeader() {
  const { isMobile } = useSidebar();
  const title = useMatches()
    .map((match) => match.handle)
    .filter(isAppRouteHandle)
    .at(-1)?.title;

  if (!isMobile) {
    return null;
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-card px-2">
      {/* Área táctil de 44px; el ícono mantiene 16px. */}
      <SidebarTrigger className="size-11" />
      {title ? <span className="text-sm font-medium">{title}</span> : null}
    </header>
  );
}
