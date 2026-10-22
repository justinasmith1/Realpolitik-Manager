import type { TipoDocumento } from '@realpolitik/shared';

import { cn } from '@/lib/utils';
import { EstadoTipoDocumentoBadge } from '@/modules/tipos-documento/components/EstadoTipoDocumentoBadge';
import { NombreTipoDocumento } from '@/modules/tipos-documento/components/NombreTipoDocumento';
import {
  TipoDocumentoAccionesMenu,
  type AccionesTipoDocumento,
} from '@/modules/tipos-documento/components/TipoDocumentoAccionesMenu';

interface TipoDocumentoTarjetaProps extends AccionesTipoDocumento {
  tipo: TipoDocumento;
  cambiandoEstado: boolean;
}

/**
 * Un tipo de documento como tarjeta, para pantallas angostas. La misma información y las mismas
 * acciones que la fila de la tabla: nombre (abre la edición), descripción, estado y el menú ⋯
 * arriba a la derecha, con área táctil de 44px. Los textos largos se parten, sin desbordar.
 */
export function TipoDocumentoTarjeta({
  tipo,
  cambiandoEstado,
  ...acciones
}: TipoDocumentoTarjetaProps) {
  return (
    <li className="rounded-card border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <NombreTipoDocumento
            tipo={tipo}
            onEditar={acciones.onEditar}
            className={cn('font-semibold', !tipo.activo && 'text-content-secondary')}
          />
          {tipo.descripcion !== null && (
            <p className="mt-0.5 text-sm break-words text-content-secondary">{tipo.descripcion}</p>
          )}
        </div>
        <div className="-mt-2 -mr-2 shrink-0">
          <TipoDocumentoAccionesMenu tipo={tipo} cambiandoEstado={cambiandoEstado} {...acciones} />
        </div>
      </div>
      <div className="mt-3">
        <EstadoTipoDocumentoBadge activo={tipo.activo} />
      </div>
    </li>
  );
}
