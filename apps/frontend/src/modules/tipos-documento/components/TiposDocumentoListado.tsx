import type { TipoDocumento } from '@realpolitik/shared';

import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { EstadoTipoDocumentoBadge } from '@/modules/tipos-documento/components/EstadoTipoDocumentoBadge';
import { NombreTipoDocumento } from '@/modules/tipos-documento/components/NombreTipoDocumento';
import {
  TipoDocumentoAccionesMenu,
  type AccionesTipoDocumento,
} from '@/modules/tipos-documento/components/TipoDocumentoAccionesMenu';
import { TipoDocumentoTarjeta } from '@/modules/tipos-documento/components/TipoDocumentoTarjeta';

/**
 * Debajo de este ancho de ventana el catálogo se muestra como tarjetas. Es propio de esta tabla:
 * tiene pocas columnas y entra mucho antes que la de clientes (que pasa a tarjetas a 1280px).
 */
export const CATALOGO_COMPACTO_QUERY = '(max-width: 767px)';

const claseEncabezado = 'px-4 py-3 font-medium whitespace-nowrap';

interface TiposDocumentoListadoProps extends AccionesTipoDocumento {
  /** En el orden en que los devolvió la API (por nombre sin mayúsculas ni acentos). */
  tipos: TipoDocumento[];
  /** Tipos con un cambio de estado en curso: su Desactivar/Reactivar se deshabilita. */
  idsCambiandoEstado: readonly string[];
}

/**
 * Listado del catálogo: tabla en escritorio, tarjetas en pantallas angostas. Respeta el orden
 * de la API (no reordena ni separa activos de desactivados). Muestra nombre, descripción y
 * estado; ni ids, ni fechas, ni la clave normalizada. Es presentacional: las acciones (editar
 * desde el nombre o el ⋯, desactivar, reactivar) solo se avisan a quien lo usa.
 */
export function TiposDocumentoListado({
  tipos,
  idsCambiandoEstado,
  ...acciones
}: TiposDocumentoListadoProps) {
  const compacto = useMediaQuery(CATALOGO_COMPACTO_QUERY);
  const cambiandoEstado = (tipo: TipoDocumento) => idsCambiandoEstado.includes(tipo.id);

  if (compacto) {
    return (
      <ul aria-label="Tipos de documento" className="grid gap-3">
        {tipos.map((tipo) => (
          <TipoDocumentoTarjeta
            key={tipo.id}
            tipo={tipo}
            cambiandoEstado={cambiandoEstado(tipo)}
            {...acciones}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Tipos de documento</caption>
        <thead className="border-b bg-table-head text-xs text-content-secondary">
          <tr>
            <th scope="col" className={claseEncabezado}>
              Tipo
            </th>
            <th scope="col" className={cn(claseEncabezado, 'w-40')}>
              Estado
            </th>
            <th scope="col" className={cn(claseEncabezado, 'w-20 text-right')}>
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tipos.map((tipo) => (
            <tr key={tipo.id} className="hover:bg-panel-alt">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <NombreTipoDocumento
                  tipo={tipo}
                  onEditar={acciones.onEditar}
                  className={cn('font-medium', !tipo.activo && 'text-content-secondary')}
                />
                {tipo.descripcion !== null && (
                  <span className="mt-0.5 block text-xs break-words text-content-secondary">
                    {tipo.descripcion}
                  </span>
                )}
              </th>
              <td className="px-4 py-3">
                <EstadoTipoDocumentoBadge activo={tipo.activo} />
              </td>
              <td className="px-2 py-2">
                <div className="flex justify-end">
                  <TipoDocumentoAccionesMenu
                    tipo={tipo}
                    cambiandoEstado={cambiandoEstado(tipo)}
                    {...acciones}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
