import type { Cliente } from '@realpolitik/shared';

import { Button } from '@/components/ui/button';
import { useIsCompactLayout } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { CanalEntregaBadge } from '@/modules/clientes/components/CanalEntregaBadge';
import { ClienteAccionesMenu } from '@/modules/clientes/components/ClienteAccionesMenu';
import { ClienteTarjeta } from '@/modules/clientes/components/ClienteTarjeta';
import { EstadoBadge } from '@/modules/clientes/components/EstadoBadge';
import { PeriodicidadTexto } from '@/modules/clientes/components/PeriodicidadTexto';
import { SectorBadge } from '@/modules/clientes/components/SectorBadge';
import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';

interface ClientesTablaProps {
  clientes: Cliente[];
  /** Acción del aviso "sin resultados", cuando la lista filtrada queda vacía. */
  onLimpiarFiltros: () => void;
}

// Columnas con su primer nivel de lectura: quién es (Cliente), cómo se identifica (CUIT) y cómo
// se clasifica (Sector y Subtipo). Contacto, canal y periodicidad son datos de segundo nivel.
const columnas = [
  'Cliente',
  'CUIT',
  'Sector',
  'Subtipo',
  'Email de contacto',
  'Canal',
  'Periodicidad',
  'Acciones',
];

// La columna de acciones queda fija a la derecha: si la ventana no alcanza para toda la tabla y
// aparece el scroll horizontal, el menú ⋯ de cada fila sigue a la vista.
const claseAcciones = 'sticky right-0 bg-card px-2 py-2 shadow-[-1px_0_0_var(--border)]';

/**
 * Listado de clientes. Con ancho suficiente es una tabla; debajo de ~1280px, tarjetas (la tabla
 * de escritorio no se comprime hasta un celular). Con la lista vacía muestra el aviso de "sin
 * resultados": que no haya ningún cliente en absoluto lo resuelve la página con
 * `ClientesEmptyState`.
 */
export function ClientesTabla({
  clientes,
  onLimpiarFiltros,
  onAdministrarContactos,
  onEditar,
  onDesactivar,
  onReactivar,
  idCambiandoEstado = null,
}: ClientesTablaProps & {
  onAdministrarContactos?: (cliente: Cliente) => void;
  onEditar?: (cliente: Cliente) => void;
  /** Pide desactivar un cliente activo (la confirmación la resuelve quien la usa). */
  onDesactivar?: (cliente: Cliente) => void;
  onReactivar?: (cliente: Cliente) => void;
  /** Cliente cuyo cambio de estado está en curso: su botón se deshabilita. */
  idCambiandoEstado?: string | null;
}) {
  const compacto = useIsCompactLayout();

  if (clientes.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-card border bg-card p-6">
        <h2 className="text-base font-semibold">No hay clientes que coincidan</h2>
        <p className="text-sm text-content-secondary">
          Probá con otra búsqueda o quitá algún filtro para ver más resultados.
        </p>
        <Button variant="outline" onClick={onLimpiarFiltros}>
          Limpiar filtros
        </Button>
      </div>
    );
  }

  const accionesDe = (cliente: Cliente) => ({
    onEditar,
    onAdministrarContactos,
    onDesactivar,
    onReactivar,
    cambiandoEstado: idCambiandoEstado === cliente.id,
  });

  if (compacto) {
    return (
      // Las columnas dependen del ancho del listado (container query), no del de la ventana: a
      // 768px con el Sidebar abierto quedan ~500px y dos tarjetas no entran sin cortar datos.
      <div className="@container">
        <ul aria-label="Clientes" className="grid gap-3 @2xl:grid-cols-2">
          {clientes.map((cliente) => (
            <ClienteTarjeta key={cliente.id} cliente={cliente} acciones={accionesDe(cliente)} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Clientes</caption>
        <thead className="border-b bg-table-head text-xs text-content-secondary">
          <tr>
            {columnas.map((columna) => (
              <th
                key={columna}
                scope="col"
                className={cn(
                  'px-2.5 py-3 font-medium whitespace-nowrap',
                  columna === 'Cliente' && 'min-w-48 pl-4',
                  columna === 'Acciones' &&
                    'sticky right-0 bg-table-head text-right shadow-[-1px_0_0_var(--border)]',
                )}
              >
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {clientes.map((cliente) => (
            <tr key={cliente.id} className="group hover:bg-panel-alt">
              <th scope="row" className="py-3 pr-2.5 pl-4 text-left font-normal">
                <span
                  className="line-clamp-2 leading-snug font-medium break-words"
                  title={cliente.razonSocial}
                >
                  {cliente.razonSocial}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-content-secondary">
                  <span className="truncate">{cliente.denominacion}</span>
                  {cliente.estado !== 'ACTIVO' && <EstadoBadge estado={cliente.estado} />}
                </span>
              </th>
              <td className="px-2.5 py-3 font-mono text-xs whitespace-nowrap">{cliente.cuit}</td>
              <td className="px-2.5 py-3">
                <SectorBadge sector={cliente.sector} />
              </td>
              <td className="px-2.5 py-3">
                {/* Los subtipos largos ("Provincial u organismo público") se recortan con elipsis
                    para que las 8 columnas entren a 1280px; el badge lleva el nombre completo en
                    `title`. */}
                <div className="flex max-w-28">
                  {cliente.sector === 'PUBLICO' ? (
                    <SubtipoBadge subtipo={cliente.subtipo} />
                  ) : (
                    <span aria-label="Sin subtipo" className="text-content-secondary">
                      —
                    </span>
                  )}
                </div>
              </td>
              <td className="max-w-40 px-2.5 py-3">
                <span
                  className="block truncate text-content-secondary"
                  title={cliente.emailContacto}
                >
                  {cliente.emailContacto}
                </span>
              </td>
              <td className="px-2.5 py-3">
                <CanalEntregaBadge canal={cliente.canalEntrega} />
              </td>
              <td className="px-2.5 py-3">
                <PeriodicidadTexto periodicidad={cliente.periodicidad} />
              </td>
              <td className={cn(claseAcciones, 'group-hover:bg-panel-alt')}>
                <div className="flex justify-end">
                  <ClienteAccionesMenu cliente={cliente} {...accionesDe(cliente)} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
