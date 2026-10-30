import type { RendicionResumen } from '@realpolitik/shared';
import { cn } from 'cn';
import { ArrowRightIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { interpretarFalloAnulacion } from '@/modules/rendiciones/api/rendiciones.api';
import {
  cierraTrasFallarAnulacion,
  MENSAJE_FALLO_ANULACION,
} from '@/modules/rendiciones/components/erroresDeRendicion';
import { useAnularRendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  avanceDelChecklist,
  checklistCompleto,
  etiquetaDeEmisor,
  etiquetaDePeriodo,
  TEXTO_SIN_EMISOR,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import { rutaDeRendicion } from '@/modules/rendiciones/rendiciones.rutas';

/** Id del elemento de la tarjeta: sirve para llevar el foco a una rendición del listado. */
export const idDeTarjeta = (rendicionId: string) => `rendicion-${rendicionId}`;

interface RendicionCardProps {
  rendicion: RendicionResumen;
  /** Resultado de la anulación, para avisarlo en la página. */
  onAnulada: (rendicion: RendicionResumen) => void;
  /** La rendición ya no existía al anular: el diálogo se cierra y se avisa. */
  onYaNoExiste: (rendicion: RendicionResumen) => void;
}

/**
 * Una rendición del listado: período, factura y avance del checklist, con una marca cuando está
 * completo. Una anulada se ve atenuada, con su marca y sin "Anular": se abre igual, y el detalle
 * la muestra en solo lectura. Toda la tarjeta lleva al detalle: el enlace del período se estira sobre ella (un solo
 * enlace para el teclado y los lectores, sin elementos interactivos anidados). "Anular" queda por
 * encima y fuera del enlace, así que su clic no navega. Pide confirmación (contrato 4.6) y espera
 * la respuesta: no da por hecha la anulación antes.
 */
export function RendicionCard({ rendicion, onAnulada, onYaNoExiste }: RendicionCardProps) {
  const anulacion = useAnularRendicion();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  const periodo = etiquetaDePeriodo(rendicion);
  const completo = checklistCompleto(rendicion.resumen);
  const idTitulo = `${idDeTarjeta(rendicion.id)}-titulo`;
  const anulada = rendicion.estado === 'ANULADA';

  async function confirmar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setError(null);
    try {
      await anulacion.mutateAsync({ clienteId: rendicion.clienteId, rendicionId: rendicion.id });
    } catch (fallo) {
      enCurso.current = false;
      if (cierraTrasFallarAnulacion(interpretarFalloAnulacion(fallo))) {
        setConfirmando(false);
        onYaNoExiste(rendicion);
        return;
      }
      setError(MENSAJE_FALLO_ANULACION);
      return;
    }
    setConfirmando(false);
    onAnulada(rendicion);
  }

  return (
    <article
      id={idDeTarjeta(rendicion.id)}
      tabIndex={-1}
      aria-labelledby={idTitulo}
      data-estado={anulada ? 'anulada' : 'activa'}
      className={cn(
        'group relative flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-card border p-4 transition-colors outline-none hover:bg-panel-alt focus-visible:ring-3 focus-visible:ring-ring/30 has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/30',
        anulada ? 'bg-muted/40' : 'bg-card',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3
          id={idTitulo}
          className={cn(
            'text-sm font-semibold',
            anulada ? 'text-content-secondary' : 'text-foreground',
          )}
        >
          <Link
            to={rutaDeRendicion(rendicion.clienteId, rendicion.id)}
            className="outline-none after:absolute after:inset-0 after:rounded-card after:content-[''] group-hover:text-brand-accent"
          >
            {periodo}
          </Link>
        </h3>
        <p className="text-sm text-content-secondary">
          Factura <span className="font-mono text-foreground">{rendicion.numeroFactura}</span>
          <span aria-hidden="true"> · </span>
          Emisor{' '}
          {rendicion.emisor === null ? (
            <span className="text-muted-foreground">{TEXTO_SIN_EMISOR}</span>
          ) : (
            <span className="text-foreground">{etiquetaDeEmisor(rendicion.emisor)}</span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {anulada && <Badge tone="muted">Anulada</Badge>}
          <span>{avanceDelChecklist(rendicion.resumen)}</span>
          {completo && !anulada && (
            <span className="rounded-pill border border-success-border bg-success-soft px-2 py-0.5 font-semibold text-success">
              Checklist completo
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {/* Encima del enlace estirado: el clic anula, no navega. Una anulada no lo ofrece. */}
        {!anulada && (
          <Button
            ref={botonRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmando(true)}
            aria-label={`Anular la rendición de ${periodo}, factura ${rendicion.numeroFactura}`}
            className="relative z-10"
          >
            Anular
          </Button>
        )}
        {/* Pista visual: el enlace del período ya lleva al detalle. */}
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 text-xs font-medium text-content-secondary group-hover:text-foreground"
        >
          Ver detalle
          <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>

      <AlertDialog
        open={confirmando}
        onOpenChange={(abrir) => {
          if (!abrir && !anulacion.isPending) setConfirmando(false);
        }}
        onOpenChangeComplete={(abierto) => {
          if (!abierto) {
            enCurso.current = false;
            setError(null);
          }
        }}
      >
        <AlertDialogContent finalFocus={botonRef}>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular la rendición de {periodo}?</AlertDialogTitle>
            <AlertDialogDescription>
              La factura {rendicion.numeroFactura} queda libre para abrir otra rendición. La
              rendición y su checklist no se borran: se pueden consultar con el filtro «Anuladas».
              No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error !== null && <Alert>{error}</Alert>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anulacion.isPending}>Cancelar</AlertDialogCancel>
            <LoadingButton
              variant="destructive"
              loading={anulacion.isPending}
              loadingText="Anulando…"
              onClick={() => void confirmar()}
              className="min-w-40"
            >
              Anular rendición
            </LoadingButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
