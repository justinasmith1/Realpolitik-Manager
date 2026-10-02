import type { CSSProperties } from 'react';
import { Outlet } from 'react-router';

import { AppHeader } from '@/components/layout/AppHeader';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

// Anchos del handoff: 220px expandido, 64px colapsado a íconos.
const sidebarWidths = {
  '--sidebar-width': '220px',
  '--sidebar-width-icon': '64px',
} as CSSProperties;

export function AppLayout() {
  return (
    <TooltipProvider>
      <SidebarProvider style={sidebarWidths} className="bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
