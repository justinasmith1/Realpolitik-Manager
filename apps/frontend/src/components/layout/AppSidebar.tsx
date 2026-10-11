import { PanelLeftCloseIcon, PanelLeftOpenIcon, UsersIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import { NavLink, useMatch } from 'react-router';

import { Button } from '@/components/ui/button';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface NavDestination {
  to: string;
  label: string;
  icon: ComponentType;
}

// Solo destinos que existen como ruta real.
const destinations: NavDestination[] = [{ to: '/clientes', label: 'Clientes', icon: UsersIcon }];

// Misma curva y duración que el ancho del Sidebar (ver `sidebar.tsx`): todo se mueve junto.
const transicion = 'duration-200 ease-standard';

/**
 * Marca del producto. Son dos capas superpuestas que se funden entre sí: el nombre completo
 * (expandido) y el monograma "R•" (colapsado). Ninguna cambia de tamaño ni envuelve su texto
 * durante la animación del ancho: el nombre nunca se parte en dos líneas y la marca no salta.
 * Ocupa la franja superior de 56px del encabezado.
 */
function BrandMark() {
  return (
    <div className="absolute inset-x-0 top-0 flex h-14 items-center">
      <span
        className={`flex items-center gap-1.5 pl-4 whitespace-nowrap transition-opacity ${transicion} group-data-[collapsible=icon]:opacity-0`}
      >
        <span className="text-base font-semibold tracking-tight text-primary-foreground">
          Realpolitik Manager
        </span>
        <span aria-hidden="true" className="size-1.5 rounded-pill bg-brand-accent" />
      </span>
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 flex w-(--sidebar-width-icon) items-center justify-center gap-0.5 opacity-0 transition-opacity ${transicion} group-data-[collapsible=icon]:opacity-100`}
      >
        <span className="text-lg leading-none font-semibold text-primary-foreground">R</span>
        <span className="size-1.5 rounded-pill bg-brand-accent" />
      </span>
    </div>
  );
}

/**
 * Botón de colapsar/expandir, en el encabezado del Sidebar junto a la marca: es lo primero que
 * se ve. Expandido queda a la derecha del nombre; colapsado, centrado justo debajo del "R•".
 *
 * Es siempre el MISMO elemento (solo cambian su posición, su ícono y su nombre): no se vuelve a
 * montar al alternar, así el foco de teclado no se pierde. Solo en escritorio: en mobile el
 * panel es un cajón y se abre desde el Header.
 */
function CollapseToggle() {
  const { isMobile, open, toggleSidebar } = useSidebar();
  if (isMobile) {
    return null;
  }

  const accion = open ? 'Contraer barra lateral' : 'Expandir barra lateral';
  const Icono = open ? PanelLeftCloseIcon : PanelLeftOpenIcon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={accion}
            onClick={toggleSidebar}
            // 32px de área (cómodo con puntero); en el colapsado queda centrado en la columna de
            // 64px. Sobre la superficie oscura, hover y foco usan los tokens del Sidebar.
            className={`absolute top-3 right-2 size-8 rounded-control text-sidebar-foreground transition-[top,right,background-color,color] ${transicion} group-data-[collapsible=icon]:top-[3.75rem] group-data-[collapsible=icon]:right-4 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-sidebar-ring focus-visible:ring-sidebar-ring/40`}
          />
        }
      >
        <Icono aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="right">{accion}</TooltipContent>
    </Tooltip>
  );
}

// Las etiquetas se desvanecen (no se quitan del flujo): el botón conserva su ancho, el ícono
// no se mueve y el texto nunca queda cortado a medias. Siguen en el árbol de accesibilidad.
const claseEtiqueta = `whitespace-nowrap transition-opacity ${transicion} group-data-[collapsible=icon]:opacity-0`;

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
        size="nav"
        isActive={isActive}
        {...tooltip}
        render={<NavLink to={to} />}
        className="data-active:shadow-[inset_3px_0_0_var(--brand-accent)]"
      >
        <Icon />
        <span className={claseEtiqueta}>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      {/* 56px expandido (marca + botón en una fila); colapsado crece a 96px para alojar el
          botón debajo del "R•" sin apretarlo en los 64px de ancho. */}
      <SidebarHeader
        className={`relative h-14 shrink-0 gap-0 border-b border-sidebar-border p-0 transition-[height] ${transicion} group-data-[collapsible=icon]:h-24`}
      >
        <BrandMark />
        <CollapseToggle />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Principal">
          <SidebarGroup className="pt-3">
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
