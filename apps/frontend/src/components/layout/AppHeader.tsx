import { useMatches } from 'react-router';

import { SidebarTrigger } from '@/components/ui/sidebar';

/** Datos que una ruta puede declarar en `handle` para el shell. */
export interface AppRouteHandle {
  /** Nombre de la sección, mostrado en el Header. */
  title: string;
}

function isAppRouteHandle(handle: unknown): handle is AppRouteHandle {
  return typeof handle === 'object' && handle !== null && 'title' in handle;
}

export function AppHeader() {
  const title = useMatches()
    .map((match) => match.handle)
    .filter(isAppRouteHandle)
    .at(-1)?.title;

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-card px-4 md:px-6">
      {/* Área táctil de 44px en mobile; compacta (28px) desde md. El ícono mantiene 16px. */}
      <SidebarTrigger className="size-11 md:size-7" />
      {title ? <span className="text-sm font-medium">{title}</span> : null}
    </header>
  );
}
