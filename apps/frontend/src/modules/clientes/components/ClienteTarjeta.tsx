import type { Cliente } from '@realpolitik/shared';
import type { ComponentProps } from 'react';
import { Link } from 'react-router';

import { cn } from '@/lib/utils';
import { CanalEntregaBadge } from '@/modules/clientes/components/CanalEntregaBadge';
import { ClienteAccionesMenu } from '@/modules/clientes/components/ClienteAccionesMenu';
import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';
import { EstadoBadge } from '@/modules/clientes/components/EstadoBadge';
import { PeriodicidadTexto } from '@/modules/clientes/components/PeriodicidadTexto';
import { SectorBadge } from '@/modules/clientes/components/SectorBadge';
import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';

/** A dónde lleva el nombre de un cliente del listado, con el `state` de la navegación. */
export interface EnlaceDeCliente {
  to: string;
  state: unknown;
}

interface ClienteTarjetaProps {
  cliente: Cliente;
  /** Las mismas acciones de la tabla: se pasan al menú ⋯ de la tarjeta. */
  acciones: Omit<ComponentProps<typeof ClienteAccionesMenu>, 'cliente'>;
  /** Hace del nombre un enlace estirado sobre la tarjeta, como en la fila de la tabla. */
  enlace?: EnlaceDeCliente | undefined;
}

/**
 * Un cliente como tarjeta, para pantallas donde la tabla no entra. Misma información que la
 * fila de la tabla, ordenada para escanear de arriba abajo: quién es, cómo se clasifica y los
 * datos de contacto y rendición. El menú ⋯ queda arriba a la derecha, con área táctil de 44px.
 */
export function ClienteTarjeta({ cliente, acciones, enlace }: ClienteTarjetaProps) {
  return (
    <li
      className={cn(
        'rounded-card border bg-card p-4',
        enlace &&
          'group relative cursor-pointer transition-colors hover:bg-panel-alt has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/30',
      )}
    >
      <div className="flex items-start gap-3">
        <ClienteMonogram nombre={cliente.razonSocial} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 leading-snug font-semibold break-words">
            {enlace ? (
              <Link
                to={enlace.to}
                state={enlace.state}
                className="outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] group-hover:text-brand-accent"
              >
                {cliente.razonSocial}
              </Link>
            ) : (
              cliente.razonSocial
            )}
          </p>
          <p className="truncate text-sm text-content-secondary">{cliente.denominacion}</p>
        </div>
        {/* Encima del enlace estirado: el menú no navega. */}
        <div className="relative z-10 -mt-2 -mr-2 shrink-0">
          <ClienteAccionesMenu cliente={cliente} {...acciones} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <SectorBadge sector={cliente.sector} />
        {cliente.sector === 'PUBLICO' && <SubtipoBadge subtipo={cliente.subtipo} />}
        {cliente.estado !== 'ACTIVO' && <EstadoBadge estado={cliente.estado} />}
      </div>

      <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm">
        <dt className="text-xs text-content-secondary">CUIT</dt>
        <dd className="font-mono text-xs">{cliente.cuit}</dd>
        <dt className="text-xs text-content-secondary">Email</dt>
        <dd className="truncate text-content-secondary" title={cliente.emailContacto}>
          {cliente.emailContacto}
        </dd>
        <dt className="text-xs text-content-secondary">Canal</dt>
        <dd>
          <CanalEntregaBadge canal={cliente.canalEntrega} />
        </dd>
        <dt className="self-start text-xs text-content-secondary">Periodicidad</dt>
        <dd>
          <PeriodicidadTexto periodicidad={cliente.periodicidad} />
        </dd>
      </dl>
    </li>
  );
}
