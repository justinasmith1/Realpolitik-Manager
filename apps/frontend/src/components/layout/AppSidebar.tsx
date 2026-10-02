import { UsersIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { NavLink, useMatch } from 'react-router';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

interface NavDestination {
  to: string;
  label: string;
  icon: ComponentType;
}

// Solo destinos que existen como ruta real.
const destinations: NavDestination[] = [{ to: '/clientes', label: 'Clientes', icon: UsersIcon }];

function BrandMark() {
  return (
    <div className="flex items-center gap-1.5 group-data-[collapsible=icon]:justify-center">
      <span className="text-[17px] font-semibold tracking-tight text-primary-foreground group-data-[collapsible=icon]:sr-only">
        Realpolitik Manager
      </span>
      <span
        aria-hidden="true"
        className="hidden text-lg leading-none font-semibold text-primary-foreground group-data-[collapsible=icon]:inline"
      >
        R
      </span>
      <span aria-hidden="true" className="size-1.5 rounded-pill bg-brand-accent" />
    </div>
  );
}

function NavItem({ to, label, icon: Icon }: NavDestination) {
  const isActive = useMatch({ path: to, end: false }) !== null;
  const { isMobile, state } = useSidebar();
  // El tooltip solo hace falta con el Sidebar colapsado a íconos en escritorio. En
  // los demás casos no debe existir: abierto por el foco de teclado, consume el
  // primer Escape y el menú móvil no se cierra.
  const tooltip = state === 'collapsed' && !isMobile ? { tooltip: label } : {};

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        {...tooltip}
        render={<NavLink to={to} />}
        className="h-9.5 gap-2.5 px-3 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center data-active:shadow-[inset_3px_0_0_var(--brand-accent)]"
      >
        <Icon />
        <span className="group-data-[collapsible=icon]:sr-only">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-4 group-data-[collapsible=icon]:px-2">
        <BrandMark />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Principal">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {destinations.map((destination) => (
                  <NavItem key={destination.to} {...destination} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
