import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

interface DestinoDocumentos {
  to: string;
  label: string;
}

// Solo secciones que existen como ruta real. `/documentos` sigue siendo el catálogo de tipos (es
// donde lleva el Sidebar): va primero. Las dos son coincidencia exacta, así `/documentos` no queda
// activo en `/documentos/archivos`.
const destinos: DestinoDocumentos[] = [
  { to: '/documentos', label: 'Tipos de documento' },
  { to: '/documentos/archivos', label: 'Archivos' },
];

/**
 * Navegación secundaria de la sección Documentos, debajo del encabezado de cada página. Mismo
 * patrón que `ClientesNav`: enlaces a rutas (no pestañas), el actual con `aria-current="page"`,
 * en semibold y con el subrayado del rojo de la marca.
 */
export function DocumentosNav() {
  return (
    <nav
      aria-label="Secciones de Documentos"
      className="flex h-11 items-stretch gap-6 border-b md:h-10"
    >
      {destinos.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            cn(
              'relative inline-flex items-center rounded-chip text-sm whitespace-nowrap text-content-secondary transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30',
              isActive &&
                'font-semibold text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-accent',
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
