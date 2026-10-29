import type { DocumentoResumen } from '@realpolitik/shared';
import { DownloadIcon, FileCheckIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import {
  cantidadDeItems,
  fechaLegible,
  formatoLegible,
  tamanioLegible,
} from '@/modules/documentos/documentos.etiquetas';

/** Debajo de este ancho el repositorio se muestra como tarjetas (como el catálogo de tipos). */
export const ARCHIVOS_COMPACTO_QUERY = '(max-width: 767px)';

const claseEncabezado = 'px-4 py-3 font-medium whitespace-nowrap';

export interface AccionesDeArchivo {
  onVerDetalle: (documento: DocumentoResumen) => void;
  onDescargar: (documento: DocumentoResumen) => void;
  onAplicar: (documento: DocumentoResumen) => void;
}

interface ArchivosListadoProps extends AccionesDeArchivo {
  /** En el orden de la API: del más nuevo al más viejo. */
  documentos: DocumentoResumen[];
  /** Documentos con una descarga en curso: su botón muestra la espera. */
  idsDescargando: readonly string[];
}

/** "Sin aplicar" se distingue con el token de alerta, y siempre con texto: el color no es el único canal. */
function Aplicaciones({ cantidad }: { cantidad: number }) {
  return (
    <span className={cn(cantidad === 0 ? 'font-medium text-warning' : 'text-foreground')}>
      {cantidadDeItems(cantidad)}
    </span>
  );
}

/** El nombre abre el detalle. Debajo, el formato y el tamaño. */
function NombreDeArchivo({
  documento,
  onVerDetalle,
}: {
  documento: DocumentoResumen;
  onVerDetalle: AccionesDeArchivo['onVerDetalle'];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onVerDetalle(documento)}
        className="w-fit rounded-chip text-left font-medium break-all text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {documento.nombreOriginal}
      </button>
      <span className="text-xs text-content-secondary">
        {formatoLegible(documento.tipoContenido)} · {tamanioLegible(documento.tamanioBytes)}
      </span>
    </div>
  );
}

function Acciones({
  documento,
  descargando,
  onDescargar,
  onAplicar,
}: {
  documento: DocumentoResumen;
  descargando: boolean;
} & Pick<AccionesDeArchivo, 'onDescargar' | 'onAplicar'>) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <LoadingButton
        type="button"
        variant="ghost"
        size="icon-sm"
        loading={descargando}
        onClick={() => onDescargar(documento)}
        aria-label={`Descargar ${documento.nombreOriginal}`}
        title="Descargar"
      >
        <DownloadIcon aria-hidden="true" />
      </LoadingButton>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onAplicar(documento)}
        aria-label={`Aplicar ${documento.nombreOriginal}`}
      >
        <FileCheckIcon aria-hidden="true" />
        Aplicar
      </Button>
    </div>
  );
}

/**
 * Listado del repositorio de un período: archivo (nombre, formato y tamaño), tipo, fecha de carga
 * y en cuántos ítems está vigente. Presentacional: las acciones se avisan a quien lo usa.
 */
export function ArchivosListado({
  documentos,
  idsDescargando,
  onVerDetalle,
  onDescargar,
  onAplicar,
}: ArchivosListadoProps) {
  const compacto = useMediaQuery(ARCHIVOS_COMPACTO_QUERY);
  const descargando = (documento: DocumentoResumen) => idsDescargando.includes(documento.id);

  if (compacto) {
    return (
      <ul aria-label="Archivos" className="grid gap-3">
        {documentos.map((documento) => (
          <li
            key={documento.id}
            className="flex flex-col gap-3 rounded-card border bg-card p-4 shadow-xs"
          >
            <NombreDeArchivo documento={documento} onVerDetalle={onVerDetalle} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-content-secondary">Tipo</dt>
              <dd>{documento.tipoDocumento.nombre}</dd>
              <dt className="text-content-secondary">Cargado</dt>
              <dd className="font-mono">{fechaLegible(documento.creadoEn)}</dd>
              <dt className="text-content-secondary">Aplicado en</dt>
              <dd>
                <Aplicaciones cantidad={documento.aplicacionesVigentes} />
              </dd>
            </dl>
            <Acciones
              documento={documento}
              descargando={descargando(documento)}
              onDescargar={onDescargar}
              onAplicar={onAplicar}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Archivos del período</caption>
        <thead className="border-b bg-table-head text-xs text-content-secondary">
          <tr>
            <th scope="col" className={claseEncabezado}>
              Archivo
            </th>
            <th scope="col" className={claseEncabezado}>
              Tipo
            </th>
            <th scope="col" className={claseEncabezado}>
              Cargado
            </th>
            <th scope="col" className={claseEncabezado}>
              Aplicado en
            </th>
            <th scope="col" className={cn(claseEncabezado, 'text-right')}>
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {documentos.map((documento) => (
            <tr key={documento.id} className="hover:bg-panel-alt">
              <th scope="row" className="px-4 py-3 text-left font-normal">
                <NombreDeArchivo documento={documento} onVerDetalle={onVerDetalle} />
              </th>
              <td className="px-4 py-3">{documento.tipoDocumento.nombre}</td>
              <td className="px-4 py-3 font-mono whitespace-nowrap">
                {fechaLegible(documento.creadoEn)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <Aplicaciones cantidad={documento.aplicacionesVigentes} />
              </td>
              <td className="px-3 py-2">
                <Acciones
                  documento={documento}
                  descargando={descargando(documento)}
                  onDescargar={onDescargar}
                  onAplicar={onAplicar}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
