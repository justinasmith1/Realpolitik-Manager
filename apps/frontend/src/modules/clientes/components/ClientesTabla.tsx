import type { Cliente } from '@realpolitik/shared';

import { Button } from '@/components/ui/button';
import { SectorBadge } from '@/modules/clientes/components/SectorBadge';
import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';

interface ClientesTablaProps {
  clientes: Cliente[];
  /** Acción del aviso "sin resultados", cuando la lista filtrada queda vacía. */
  onLimpiarFiltros: () => void;
}

const columnas = ['Cliente', 'CUIT', 'Sector', 'Subtipo', 'Email de contacto'];

/**
 * Tabla del listado. Con la lista vacía muestra el aviso de "sin resultados": que no haya
 * ningún cliente en absoluto lo resuelve la página con `ClientesEmptyState`.
 */
export function ClientesTabla({ clientes, onLimpiarFiltros }: ClientesTablaProps) {
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

  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Clientes</caption>
        <thead className="border-b bg-table-head text-xs font-medium text-content-secondary">
          <tr>
            {columnas.map((columna) => (
              <th key={columna} scope="col" className="px-4 py-3">
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {clientes.map((cliente) => (
            <tr key={cliente.id}>
              <th scope="row" className="px-4 py-3 font-medium">
                {cliente.razonSocial}
              </th>
              <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{cliente.cuit}</td>
              <td className="px-4 py-3">
                <SectorBadge sector={cliente.sector} />
              </td>
              <td className="px-4 py-3">
                {cliente.sector === 'PUBLICO' ? (
                  <SubtipoBadge subtipo={cliente.subtipo} />
                ) : (
                  <span aria-label="Sin subtipo" className="text-content-secondary">
                    —
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-content-secondary">{cliente.emailContacto}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
