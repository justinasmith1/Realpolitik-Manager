import type { DocumentoResumen, RendicionDetalle } from '@realpolitik/shared';
import { FileTextIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
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
import { cn } from '@/lib/utils';
import {
  interpretarFalloAplicacion,
  interpretarFalloReemplazo,
  sinDocumentosHabilitados,
} from '@/modules/documentos/api/documentos.api';
import {
  mensajeFalloAsociacion,
  mensajeFalloReemplazo,
} from '@/modules/documentos/components/erroresDeDocumentos';
import {
  cantidadDeItems,
  fechaLegible,
  formatoLegible,
  tamanioLegible,
} from '@/modules/documentos/documentos.etiquetas';
import {
  useAplicarDocumento,
  useDocumentos,
  useReemplazarDocumentoDeItem,
} from '@/modules/documentos/hooks/useDocumentos';
import { rutaDeArchivos } from '@/modules/documentos/hooks/useFiltrosArchivos';
import { etiquetaDePeriodo, nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Qué se le hace al documento de un ítem: asociarle uno (pendiente) o reemplazar el que tiene. */
export interface PedidoDeDocumento {
  modo: 'asociar' | 'reemplazar';
  itemId: string;
}

interface ElegirDocumentoDeItemSheetProps {
  /** `null` mantiene el panel cerrado. */
  pedido: PedidoDeDocumento | null;
  /** La rendición como está ahora: el ítem se lee de acá, así un dato refrescado se ve enseguida. */
  rendicion: RendicionDetalle;
  onCerrar: () => void;
  /** Se guardó: avisa en la página con el texto del resultado. */
  onListo: (texto: string) => void;
}

const mismoPedido = (a: PedidoDeDocumento | null, b: PedidoDeDocumento | null) =>
  a?.modo === b?.modo && a?.itemId === b?.itemId;

const usoDe = (documento: DocumentoResumen) =>
  documento.aplicacionesVigentes === 0
    ? 'sin aplicar'
    : `en uso en ${cantidadDeItems(documento.aplicacionesVigentes)}`;

/**
 * Asocia un documento ya cargado a un ítem pendiente, o reemplaza el documento de un ítem
 * completado (HU2.8). Solo ofrece documentos compatibles: del tipo del ítem (su snapshot, aunque el
 * tipo ya no esté activo) y del período de la rendición. El reemplazo se confirma aparte: cambia
 * solo este ítem, y el documento anterior queda en su historial y sigue en los otros ítems.
 */
export function ElegirDocumentoDeItemSheet({
  pedido,
  rendicion,
  onCerrar,
  onListo,
}: ElegirDocumentoDeItemSheetProps) {
  const nombreDelGrupo = useId();
  const aplicacion = useAplicarDocumento();
  const reemplazo = useReemplazarDocumentoDeItem();
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrado, setMostrado] = useState(pedido);
  const [elegidoId, setElegidoId] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (pedido !== null && !mismoPedido(pedido, mostrado)) {
    setMostrado(pedido);
    setElegidoId(null);
    setConfirmando(false);
    setError(null);
  }

  const item = rendicion.items.find((candidato) => candidato.id === mostrado?.itemId);
  const reemplazar = mostrado?.modo === 'reemplazar';
  const consulta = useDocumentos(
    { anio: rendicion.anio, mes: rendicion.mes, tipoDocumentoId: item?.tipoDocumentoId },
    { enabled: item !== undefined },
  );
  // Mientras llega el tipo de otro ítem, `data` es del anterior: no se muestra.
  const documentos = consulta.isPlaceholderData ? undefined : consulta.data;
  const actual = item?.documento ?? null;
  const otros = documentos?.filter((documento) => documento.id !== actual?.documentoId) ?? [];
  const elegido = otros.find((documento) => documento.id === elegidoId) ?? null;
  const ocupado = aplicacion.isPending || reemplazo.isPending;
  const anulada = rendicion.estado === 'ANULADA';

  // El ítem pudo cambiar mientras tanto (otra persona, o un 409 que refrescó la rendición).
  let impedimento: string | null = null;
  if (anulada) impedimento = 'La rendición está anulada: ya no se puede modificar.';
  else if (!reemplazar && actual !== null) {
    impedimento = `Este ítem ya tiene un documento (${actual.nombreOriginal}). Para cambiarlo, usá «Reemplazar documento».`;
  } else if (reemplazar && actual === null) {
    impedimento = 'Este ítem no tiene un documento para reemplazar.';
  }
  const listo = item !== undefined && elegido !== null && impedimento === null;
  const nombre = item === undefined ? '' : nombreDeItem(item);

  async function asociar() {
    if (!listo || item === undefined || elegido === null || ocupado) return;
    setError(null);
    try {
      await aplicacion.mutateAsync({
        documentoId: elegido.id,
        itemIds: [item.id],
        clienteIds: [rendicion.clienteId],
      });
    } catch (fallo) {
      setError(mensajeFalloAsociacion(interpretarFalloAplicacion(fallo)));
      return;
    }
    onListo(`Se asoció ${elegido.nombreOriginal} a ${nombre}.`);
  }

  async function reemplazarDocumento() {
    if (!listo || item === undefined || elegido === null || actual === null || ocupado) return;
    setError(null);
    try {
      await reemplazo.mutateAsync({
        clienteId: rendicion.clienteId,
        rendicionId: rendicion.id,
        itemId: item.id,
        documentoId: elegido.id,
        aplicacionVigenteId: actual.aplicacionId,
      });
    } catch (fallo) {
      const motivo = interpretarFalloReemplazo(fallo);
      setError(mensajeFalloReemplazo(motivo));
      setConfirmando(false);
      // El vigente cambió: lo que se eligió se decidió mirando otro, hay que volver a elegir.
      if (motivo.tipo === 'desactualizada' || motivo.tipo === 'ya-vigente') setElegidoId(null);
      return;
    }
    onListo(`Se reemplazó ${actual.nombreOriginal} por ${elegido.nombreOriginal} en ${nombre}.`);
  }

  let lista: ReactNode;
  if (consulta.isError) {
    lista = sinDocumentosHabilitados(consulta.error) ? (
      <Alert variant="warning">Los documentos no están habilitados en este entorno.</Alert>
    ) : (
      <Alert>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>No pudimos cargar los documentos del período.</span>
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
    );
  } else if (documentos === undefined || item === undefined) {
    lista = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span className="sr-only" role="status">
          Buscando documentos compatibles…
        </span>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  } else if (otros.length === 0) {
    lista = (
      <div className="flex flex-col items-start gap-2 rounded-card border bg-card p-4 text-sm text-content-secondary">
        <p>
          {reemplazar ? 'No hay otro documento' : 'Todavía no hay documentos'} de{' '}
          <span className="font-medium text-foreground">{item.nombreTipoDocumento}</span>{' '}
          {reemplazar ? 'cargado' : 'cargados'} para {etiquetaDePeriodo(rendicion)}.
        </p>
        <Link
          to={rutaDeArchivos({
            anio: rendicion.anio,
            mes: rendicion.mes,
            tipoDocumentoId: item.tipoDocumentoId,
          })}
          className="rounded-chip text-sm font-medium text-foreground underline underline-offset-2 outline-none hover:text-content-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Cargar uno en Archivos
        </Link>
      </div>
    );
  } else {
    lista = (
      <fieldset className="flex flex-col gap-2" disabled={ocupado}>
        <legend className="mb-1 text-sm font-medium">
          {reemplazar ? 'Elegí el documento nuevo' : 'Elegí el documento'}
        </legend>
        <div className="flex flex-col divide-y divide-border rounded-card border bg-card">
          {otros.map((documento) => (
            <label
              key={documento.id}
              className={cn(
                // Como en el asistente: la casilla a la izquierda, el nombre y sus datos al lado.
                'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 px-3 py-2.5 has-focus-visible:ring-3 has-focus-visible:ring-ring/30',
                elegidoId === documento.id && 'bg-panel-alt',
              )}
            >
              <input
                type="radio"
                name={nombreDelGrupo}
                value={documento.id}
                checked={elegidoId === documento.id}
                onChange={() => {
                  setElegidoId(documento.id);
                  setError(null);
                }}
                className="row-span-2 mt-0.5 size-4 accent-primary"
              />
              <span className="text-sm font-medium break-all">{documento.nombreOriginal}</span>
              <span className="col-start-2 text-xs text-content-secondary">
                Cargado el {fechaLegible(documento.creadoEn)} ·{' '}
                {formatoLegible(documento.tipoContenido)} · {tamanioLegible(documento.tamanioBytes)}{' '}
                · {usoDe(documento)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <Sheet
      open={pedido !== null}
      onOpenChange={(abierto) => {
        if (!abierto && !ocupado) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) setMostrado(null);
      }}
    >
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8">
            {reemplazar ? 'Reemplazar documento' : 'Asociar documento existente'}
          </SheetTitle>
          <SheetDescription>
            {nombre} · Factura <span className="font-mono">{rendicion.numeroFactura}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {item !== undefined && (
            <p className="text-sm text-content-secondary">
              Documentos de{' '}
              <span className="font-medium text-foreground">{item.nombreTipoDocumento}</span>{' '}
              cargados para {etiquetaDePeriodo(rendicion)}.
            </p>
          )}
          {reemplazar && actual !== null && (
            <div className="flex items-start gap-2 rounded-card border bg-panel-alt px-3 py-2.5 text-sm">
              <FileTextIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium break-all">{actual.nombreOriginal}</span>
                  <Badge tone="neutral">Actual</Badge>
                </span>
                <span className="text-xs text-content-secondary">
                  Asociado el {fechaLegible(actual.aplicadaEn)}
                </span>
              </div>
            </div>
          )}
          {(error ?? impedimento) !== null && (
            <Alert variant={error !== null ? 'destructive' : 'warning'}>
              {error ?? impedimento}
            </Alert>
          )}
          {confirmando && elegido !== null && actual !== null ? (
            <Alert variant="warning">
              <p>
                Vas a reemplazar{' '}
                <span className="font-medium break-all">{actual.nombreOriginal}</span> por{' '}
                <span className="font-medium break-all">{elegido.nombreOriginal}</span> en {nombre}.
              </p>
              <p className="mt-1">
                El documento anterior queda en el historial de este ítem y sigue igual en los otros
                ítems donde está aplicado.
              </p>
            </Alert>
          ) : (
            lista
          )}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
          {confirmando ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmando(false)}
                disabled={ocupado}
              >
                Volver
              </Button>
              <LoadingButton
                type="button"
                loading={reemplazo.isPending}
                loadingText="Reemplazando…"
                onClick={() => void reemplazarDocumento()}
                disabled={!listo}
              >
                Sí, reemplazar
              </LoadingButton>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onCerrar} disabled={ocupado}>
                Cancelar
              </Button>
              {reemplazar ? (
                <Button type="button" onClick={() => setConfirmando(true)} disabled={!listo}>
                  Reemplazar documento
                </Button>
              ) : (
                <LoadingButton
                  type="button"
                  loading={aplicacion.isPending}
                  loadingText="Asociando…"
                  onClick={() => void asociar()}
                  disabled={!listo}
                >
                  Asociar documento
                </LoadingButton>
              )}
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
