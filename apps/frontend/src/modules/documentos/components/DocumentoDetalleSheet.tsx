import type { AplicacionUbicada, DocumentoConAplicaciones } from '@realpolitik/shared';
import { DownloadIcon, FileCheckIcon } from 'lucide-react';
import { Link } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import {
  fechaLegible,
  formatoLegible,
  tamanioLegible,
} from '@/modules/documentos/documentos.etiquetas';
import { useDocumento } from '@/modules/documentos/hooks/useDocumentos';
import { etiquetaDePeriodo, nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';
import { rutaDeRendicion } from '@/modules/rendiciones/rendiciones.rutas';

interface DocumentoDetalleSheetProps {
  /** `null` mantiene el panel cerrado. */
  documentoId: string | null;
  onCerrar: () => void;
  onDescargar: (documento: DocumentoConAplicaciones) => void;
  descargando: boolean;
  onAplicar: (documento: DocumentoConAplicaciones) => void;
}

/** Una aplicación: cliente, factura e ítem, con su estado y el enlace a la rendición. */
function FilaDeAplicacion({ aplicacion }: { aplicacion: AplicacionUbicada }) {
  const { cliente, rendicion, item } = aplicacion.ubicacion;
  const anulada = rendicion.estado === 'ANULADA';
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{cliente.denominacion}</span>
        {cliente.estado !== 'ACTIVO' && (
          <Badge tone="muted">Cliente {etiquetasEstado[cliente.estado]}</Badge>
        )}
        {anulada && <Badge tone="muted">Rendición anulada</Badge>}
      </div>
      <span className="text-[13px] text-content-secondary">
        Factura <span className="font-mono">{rendicion.numeroFactura}</span> · {nombreDeItem(item)}
      </span>
      <span className="text-xs text-content-secondary">
        {aplicacion.estado === 'VIGENTE'
          ? `Aplicado el ${fechaLegible(aplicacion.aplicadaEn)}`
          : `Aplicado el ${fechaLegible(aplicacion.aplicadaEn)} · reemplazado el ${
              aplicacion.reemplazadaEn === null ? '' : fechaLegible(aplicacion.reemplazadaEn)
            }`}
      </span>
      <Link
        to={rutaDeRendicion(cliente.id, rendicion.id)}
        className="w-fit rounded-chip text-xs font-medium text-foreground underline underline-offset-2 outline-none hover:text-content-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        Ver la rendición
        <span className="sr-only">
          {' '}
          de {cliente.denominacion}, factura {rendicion.numeroFactura}
        </span>
      </Link>
    </li>
  );
}

function ListaDeAplicaciones({
  titulo,
  aplicaciones,
  vacio,
}: {
  titulo: string;
  aplicaciones: AplicacionUbicada[];
  vacio: string | null;
}) {
  if (aplicaciones.length === 0 && vacio === null) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={titulo}>
      <h3 className="text-sm font-semibold text-foreground">
        {titulo} {aplicaciones.length > 0 && `(${aplicaciones.length})`}
      </h3>
      {aplicaciones.length === 0 ? (
        <p className="text-sm text-content-secondary">{vacio}</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border bg-card">
          {aplicaciones.map((aplicacion) => (
            <FilaDeAplicacion key={aplicacion.id} aplicacion={aplicacion} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Detalle de un documento del repositorio: sus datos y dónde se usó. Las aplicaciones vigentes
 * van primero y las reemplazadas, aparte, como historial. Una rendición anulada o un cliente no
 * activo se marcan con texto.
 */
export function DocumentoDetalleSheet({
  documentoId,
  onCerrar,
  onDescargar,
  descargando,
  onAplicar,
}: DocumentoDetalleSheetProps) {
  const consulta = useDocumento(documentoId);
  const documento = consulta.data;
  const vigentes = documento?.aplicaciones.filter((a) => a.estado === 'VIGENTE') ?? [];
  const reemplazadas = documento?.aplicaciones.filter((a) => a.estado === 'REEMPLAZADA') ?? [];

  return (
    <Sheet
      open={documentoId !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onCerrar();
      }}
    >
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8 break-all">
            {documento?.nombreOriginal ?? 'Documento'}
          </SheetTitle>
          <SheetDescription>Documento del repositorio</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
          {consulta.isPending && documentoId !== null && (
            <div className="flex flex-col gap-3" aria-busy="true">
              <span className="sr-only" role="status">
                Cargando el documento…
              </span>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
          {consulta.isError && (
            <Alert>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>No pudimos cargar el documento.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void consulta.refetch()}
                  disabled={consulta.isFetching}
                >
                  Reintentar
                </Button>
              </div>
            </Alert>
          )}
          {documento !== undefined && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-content-secondary">Tipo</dt>
                <dd>{documento.tipoDocumento.nombre}</dd>
                <dt className="text-content-secondary">Período</dt>
                <dd>{etiquetaDePeriodo(documento)}</dd>
                <dt className="text-content-secondary">Cargado</dt>
                <dd>{fechaLegible(documento.creadoEn)}</dd>
                <dt className="text-content-secondary">Archivo</dt>
                <dd>
                  {formatoLegible(documento.tipoContenido)} ·{' '}
                  {tamanioLegible(documento.tamanioBytes)}
                </dd>
              </dl>
              <ListaDeAplicaciones
                titulo="Dónde está vigente"
                aplicaciones={vigentes}
                vacio="Todavía no se aplicó a ningún ítem. Podés aplicarlo cuando quieras."
              />
              <ListaDeAplicaciones
                titulo="Historial (reemplazado)"
                aplicaciones={reemplazadas}
                vacio={null}
              />
            </>
          )}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cerrar
          </Button>
          {documento !== undefined && (
            <>
              <LoadingButton
                type="button"
                variant="outline"
                loading={descargando}
                onClick={() => onDescargar(documento)}
              >
                <DownloadIcon aria-hidden="true" />
                Descargar
              </LoadingButton>
              <Button type="button" variant="brand" onClick={() => onAplicar(documento)}>
                <FileCheckIcon aria-hidden="true" />
                Aplicar a otros ítems
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
