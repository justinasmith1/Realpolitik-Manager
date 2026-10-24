import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

interface DestinoClientes {
  to: string;
  label: string;
  /** Coincidencia exacta: `/clientes` no debe quedar activo en `/clientes/tipos-documento`. */
  end: boolean;
}

// Solo secciones que existen como ruta real. Es del layout y no de un módulo porque la usan
// páginas de dos módulos (clientes y tipos de documento) y ninguno debe depender del otro.
const destinos: DestinoClientes[] = [
  { to: '/clientes', label: 'Clientes', end: true },
  { to: '/clientes/matrices', label: 'Matrices', end: false },
  { to: '/clientes/tipos-documento', label: 'Tipos de documento', end: false },
];

/**
 * Navegación secundaria de la sección Clientes, debajo del encabezado de cada página. Son
 * enlaces a rutas (no pestañas que muestran paneles), así que van como `<nav>` con `NavLink`:
 * el actual lleva `aria-current="page"`, en semibold y con el subrayado del rojo de la marca.
 */
export function ClientesNav() {
  return (
    // Enlaces directos, sin lista: así la página no suma ítems de lista ajenos a su contenido.
    // 44px de alto en pantallas táctiles, 40px desde md (como los botones).
    <nav
      aria-label="Secciones de Clientes"
      className="flex h-11 items-stretch gap-6 border-b md:h-10"
    >
      {destinos.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'relative inline-flex items-center rounded-chip text-sm whitespace-nowrap text-content-secondary transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30',
              // El subrayado se apoya sobre el borde inferior de la barra.
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
