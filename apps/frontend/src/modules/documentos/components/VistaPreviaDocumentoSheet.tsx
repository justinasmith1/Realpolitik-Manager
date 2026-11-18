import { DownloadIcon, ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { mensajeFalloVistaPrevia } from '@/modules/documentos/components/erroresDeDocumentos';
import { formatoLegible } from '@/modules/documentos/documentos.etiquetas';
import { useVistaPrevia, type DocumentoAVer } from '@/modules/documentos/hooks/useVistaPrevia';
import { claseDeVistaPrevia } from '@/modules/documentos/vistaPrevia';

export type { DocumentoAVer } from '@/modules/documentos/hooks/useVistaPrevia';

interface VistaPreviaDocumentoSheetProps {
  /** El documento que se muestra. `null` mantiene el visor cerrado. */
  documento: DocumentoAVer | null;
  onCerrar: () => void;
  /** La descarga de siempre: desde el pie y, si no se puede mostrar, desde el aviso. */
  onDescargar: (documento: DocumentoAVer) => void;
  descargando: boolean;
}

/**
 * Visor de un documento (HU3.11): un PDF o una imagen, sin descargarlo, para comprobar que es el
 * correcto. Se abre dentro del sistema (foco atrapado, Escape cierra, título con el nombre) y
 * ofrece abrirlo en otra pestaña, por ejemplo en un celular donde el PDF embebido se ve recortado.
 * Si no se puede mostrar, lo dice y ofrece descargarlo.
 */
export function VistaPreviaDocumentoSheet({
  documento,
  onCerrar,
  onDescargar,
  descargando,
}: VistaPreviaDocumentoSheetProps) {
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrado, setMostrado] = useState(documento);
  if (documento !== null && documento.id !== mostrado?.id) setMostrado(documento);
  const { url, cargando, error, fallo, reintentar } = useVistaPrevia(mostrado);
  // La imagen que el navegador no pudo dibujar (un archivo dañado): se guarda su URL, así un
  // reintento, que crea otra, vuelve a probar.
  const [urlRota, setUrlRota] = useState<string | null>(null);
  const sinMostrar = error || (url !== null && url === urlRota);
  // Sin permiso (403) o con el documento que ya no está (404), descargar y reintentar piden la
  // misma ruta y darían el mismo error: solo queda el mensaje. Los fallos temporales (servicio,
  // red) y el archivo que el navegador no pudo dibujar conservan las dos salidas.
  const recuperable = fallo?.tipo !== 'sin-permiso' && fallo?.tipo !== 'no-existe';
  const clase = mostrado === null ? null : claseDeVistaPrevia(mostrado.tipoContenido);
  const nombre = mostrado?.nombreOriginal ?? '';

  const reintentarTodo = () => {
    setUrlRota(null);
    reintentar();
  };

  return (
    <Sheet
      open={documento !== null}
      onOpenChange={(abierto) => {
        if (!abierto) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) setMostrado(null);
      }}
    >
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8 break-all">
            <span className="sr-only">Vista previa de</span> {nombre}
          </SheetTitle>
          <SheetDescription>
            Vista previa{mostrado === null ? '' : ` · ${formatoLegible(mostrado.tipoContenido)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col bg-panel-alt p-4">
          {mostrado !== null && sinMostrar && (
            <Alert>
              <div className="flex flex-col gap-2">
                <span>{mensajeFalloVistaPrevia(nombre, fallo)}</span>
                {recuperable && (
                  <span className="flex flex-wrap gap-2">
                    <LoadingButton
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={descargando}
                      onClick={() => onDescargar(mostrado)}
                    >
                      <DownloadIcon aria-hidden="true" />
                      Descargar
                    </LoadingButton>
                    <Button type="button" variant="ghost" size="sm" onClick={reintentarTodo}>
                      Reintentar
                    </Button>
                  </span>
                )}
              </div>
            </Alert>
          )}
          {cargando && (
            <div className="flex flex-1 flex-col" aria-busy="true">
              <span className="sr-only" role="status">
                Cargando la vista previa…
              </span>
              <Skeleton className="h-full min-h-64 w-full" />
            </div>
          )}
          {url !== null && !sinMostrar && clase === 'pdf' && (
            <iframe
              src={url}
              title={`Contenido de ${nombre}`}
              className="min-h-[60vh] w-full flex-1 rounded-card border bg-card"
            />
          )}
          {url !== null && !sinMostrar && clase === 'imagen' && (
            <div className="flex flex-1 items-center justify-center overflow-auto">
              <img
                src={url}
                alt={`Contenido de ${nombre}`}
                onError={() => setUrlRota(url)}
                className="max-h-full max-w-full rounded-card border bg-card object-contain"
              />
            </div>
          )}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cerrar
          </Button>
          {url !== null && !sinMostrar && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline' })}
            >
              <ExternalLinkIcon aria-hidden="true" />
              Abrir en otra pestaña
            </a>
          )}
          {mostrado !== null && !sinMostrar && (
            <LoadingButton
              type="button"
              variant="outline"
              loading={descargando}
              onClick={() => onDescargar(mostrado)}
            >
              <DownloadIcon aria-hidden="true" />
              Descargar
            </LoadingButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
