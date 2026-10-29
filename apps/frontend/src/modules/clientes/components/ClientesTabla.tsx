import type { Cliente } from '@realpolitik/shared';
import { Fragment, type ReactElement } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { useIsCompactLayout } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import {
  etiquetasColumnasClientes,
  type ClienteColumnaConfigurableId,
} from '@/modules/clientes/clientes.columnas';
import { CanalEntregaBadge } from '@/modules/clientes/components/CanalEntregaBadge';
import { ClienteAccionesMenu } from '@/modules/clientes/components/ClienteAccionesMenu';
import { ClienteTarjeta, type EnlaceDeCliente } from '@/modules/clientes/components/ClienteTarjeta';
import { EstadoBadge } from '@/modules/clientes/components/EstadoBadge';
import { PeriodicidadTexto } from '@/modules/clientes/components/PeriodicidadTexto';
import { SectorBadge } from '@/modules/clientes/components/SectorBadge';
import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';

interface ClientesTablaProps {
  clientes: Cliente[];
  /**
   * Columnas opcionales de la tabla de escritorio, en el orden en que se muestran. "Cliente" va
   * siempre primera y "Acciones" siempre última. No afecta a las tarjetas del layout compacto.
   */
  columnasVisibles: readonly ClienteColumnaConfigurableId[];
  /** Acción del aviso "sin resultados", cuando la lista filtrada queda vacía. */
  onLimpiarFiltros: () => void;
}

const claseEncabezado = 'px-2.5 py-3 font-medium whitespace-nowrap';

// La columna de acciones queda fija a la derecha: si la ventana no alcanza para toda la tabla y
// aparece el scroll horizontal, el menú ⋯ de cada fila sigue a la vista.
const claseAcciones = 'sticky right-0 bg-card px-2 py-2 shadow-[-1px_0_0_var(--border)]';

// Celda de cada columna opcional. El `Record` obliga a cubrir cada columna del modelo: si se
// agrega una, esto deja de compilar hasta que tenga su celda.
const celdas: Record<ClienteColumnaConfigurableId, (cliente: Cliente) => ReactElement> = {
  cuit: (cliente) => (
    <td className="px-2.5 py-3 font-mono text-xs whitespace-nowrap">{cliente.cuit}</td>
  ),
  sector: (cliente) => (
    <td className="px-2.5 py-3">
      <SectorBadge sector={cliente.sector} />
    </td>
  ),
  subtipo: (cliente) => (
    <td className="px-2.5 py-3">
      {/* Los subtipos largos ("Provincial u organismo público") se recortan con elipsis para que
          las 8 columnas entren a 1280px; el badge lleva el nombre completo en `title`. */}
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
  ),
  email: (cliente) => (
    <td className="max-w-40 px-2.5 py-3">
      <span className="block truncate text-content-secondary" title={cliente.emailContacto}>
        {cliente.emailContacto}
      </span>
    </td>
  ),
  canal: (cliente) => (
    <td className="px-2.5 py-3">
      <CanalEntregaBadge canal={cliente.canalEntrega} />
    </td>
  ),
  periodicidad: (cliente) => (
    <td className="px-2.5 py-3">
      <PeriodicidadTexto periodicidad={cliente.periodicidad} />
    </td>
  ),
};

/**
 * Listado de clientes. Con ancho suficiente es una tabla; debajo de ~1280px, tarjetas (la tabla
 * de escritorio no se comprime hasta un celular). La tabla muestra las columnas opcionales que
 * recibe y en ese orden; las tarjetas muestran siempre todos los datos. Con la lista vacía
 * muestra el aviso de "sin resultados": que no haya ningún cliente en absoluto lo resuelve la
 * página con `ClientesEmptyState`.
 */
export function ClientesTabla({
  clientes,
  columnasVisibles,
  onLimpiarFiltros,
  onAdministrarContactos,
  onEditar,
  onVerMatriz,
  onDesactivar,
  onReactivar,
  idsCambiandoEstado = [],
  enlaceDe,
}: ClientesTablaProps & {
  /**
   * Hace del nombre un enlace estirado sobre su celda (o la tarjeta). Sin esto, el nombre es
   * texto: la tabla no depende del router.
   */
  enlaceDe?: (cliente: Cliente) => EnlaceDeCliente;
  onAdministrarContactos?: (cliente: Cliente) => void;
  onEditar?: (cliente: Cliente) => void;
  onVerMatriz?: (cliente: Cliente) => void;
  /** Pide desactivar un cliente activo (la confirmación la resuelve quien la usa). */
  onDesactivar?: (cliente: Cliente) => void;
  onReactivar?: (cliente: Cliente) => void;
  /** Clientes con un cambio de estado en curso: su Desactivar/Reactivar se deshabilita. */
  idsCambiandoEstado?: readonly string[];
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
    onVerMatriz,
    onDesactivar,
    onReactivar,
    cambiandoEstado: idsCambiandoEstado.includes(cliente.id),
  });

  if (compacto) {
    return (
      // Las columnas dependen del ancho del listado (container query), no del de la ventana: a
      // 768px con el Sidebar abierto quedan ~500px y dos tarjetas no entran sin cortar datos.
      <div className="@container">
        <ul aria-label="Clientes" className="grid gap-3 @2xl:grid-cols-2">
          {clientes.map((cliente) => (
            <ClienteTarjeta
              key={cliente.id}
              cliente={cliente}
              acciones={accionesDe(cliente)}
              enlace={enlaceDe?.(cliente)}
            />
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
            <th scope="col" className={cn(claseEncabezado, 'min-w-48 pl-4')}>
              Cliente
            </th>
            {columnasVisibles.map((id) => (
              <th key={id} scope="col" className={claseEncabezado}>
                {etiquetasColumnasClientes[id]}
              </th>
            ))}
            <th
              scope="col"
              className={cn(
                claseEncabezado,
                'sticky right-0 bg-table-head text-right shadow-[-1px_0_0_var(--border)]',
              )}
            >
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {clientes.map((cliente) => {
            const enlace = enlaceDe?.(cliente);
            return (
              <tr key={cliente.id} className="group hover:bg-panel-alt">
                {/* Con enlace, el nombre se estira solo sobre su celda (`relative`): el resto de la
                    fila queda libre para seleccionar y copiar datos, y para los tooltips. */}
                <th
                  scope="row"
                  className={cn(
                    'py-3 pr-2.5 pl-4 text-left font-normal',
                    enlace && 'relative cursor-pointer',
                  )}
                >
                  {enlace ? (
                    <Link
                      to={enlace.to}
                      state={enlace.state}
                      className="line-clamp-2 w-fit leading-snug font-medium break-words outline-none group-hover:text-brand-accent after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-3 focus-visible:after:ring-ring/30 focus-visible:after:ring-inset"
                      title={cliente.razonSocial}
                    >
                      {cliente.razonSocial}
                    </Link>
                  ) : (
                    <span
                      className="line-clamp-2 leading-snug font-medium break-words"
                      title={cliente.razonSocial}
                    >
                      {cliente.razonSocial}
                    </span>
                  )}
                  <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-content-secondary">
                    <span className="truncate">{cliente.denominacion}</span>
                    {cliente.estado !== 'ACTIVO' && <EstadoBadge estado={cliente.estado} />}
                  </span>
                </th>
                {columnasVisibles.map((id) => (
                  <Fragment key={id}>{celdas[id](cliente)}</Fragment>
                ))}
                <td className={cn(claseAcciones, 'group-hover:bg-panel-alt')}>
                  <div className="flex justify-end">
                    <ClienteAccionesMenu cliente={cliente} {...accionesDe(cliente)} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
