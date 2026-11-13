import { esEstadoCobrable, type EstadoRendicionType } from '@realpolitik/shared';
import { cn } from 'cn';
import { BadgeCheckIcon, BanknoteIcon, PencilIcon } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import {
  TEXTO_EDITAR_COBRO,
  TEXTO_QUITAR_COBRO,
  TEXTO_REGISTRAR_COBRO,
  TEXTO_SIN_COBRO,
  textoDeCobro,
  TITULO_FRANJA_COBRO,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface CobroDeRendicionProps {
  estado: EstadoRendicionType;
  anulada: boolean;
  /** El cobro que informó el cliente, o `null` si no hay. */
  cobro: { fecha: string; nota: string | null } | null;
  onRegistrar: () => void;
  onEditar: () => void;
  onQuitar: () => void;
}

/**
 * La franja del cobro en el detalle de la rendición (HU3.10), a ancho completo bajo la línea
 * Estado · Vigencia · Avance y con el estilo de la tarjeta de cabecera. Es una marca de la
 * rendición, no un estado.
 *
 * - Sin cobro, en una activa Enviada o Aprobada: "Sin cobro registrado" y "Registrar cobro".
 * - Con cobro: fondo y borde `success-*`, "Cobrada el dd/mm/aaaa" en negrita, la nota debajo (dos
 *   líneas como máximo, con el texto completo en el `title`) y, en una activa, "Editar cobro" (si
 *   sigue siendo cobrable) y "Quitar cobro".
 * - Anulada con cobro: lo muestra, sin botones. Anulada sin cobro o no cobrable sin cobro: nada.
 *
 * Es una región con el nombre "Cobro". Con el ancho chico, el texto y los botones se apilan.
 */
export function CobroDeRendicion({
  estado,
  anulada,
  cobro,
  onRegistrar,
  onEditar,
  onQuitar,
}: CobroDeRendicionProps) {
  const idTitulo = useId();
  const puedeCobrar = !anulada && esEstadoCobrable(estado);
  if (cobro === null && !puedeCobrar) return null;

  return (
    <section
      aria-labelledby={idTitulo}
      className={cn(
        'flex flex-col gap-3 rounded-panel border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
        cobro === null ? 'bg-panel' : 'border-success-border bg-success-soft',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {cobro === null ? (
          <>
            <BanknoteIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-content-secondary"
            />
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span id={idTitulo} className="font-semibold text-foreground">
                {TITULO_FRANJA_COBRO}
              </span>
              <span className="text-muted-foreground">{TEXTO_SIN_COBRO}</span>
            </div>
          </>
        ) : (
          <>
            <BadgeCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <div className="flex min-w-0 flex-col gap-0.5">
              {/* El nombre de la región; a la vista, la franja ya dice "Cobrada el …". */}
              <span id={idTitulo} className="sr-only">
                {TITULO_FRANJA_COBRO}
              </span>
              <span className="font-semibold text-success">{textoDeCobro(cobro.fecha)}</span>
              {cobro.nota !== null && (
                <span
                  title={cobro.nota}
                  className="line-clamp-2 text-[0.8125rem] break-words text-foreground"
                >
                  {cobro.nota}
                </span>
              )}
            </div>
          </>
        )}
      </div>
      {(cobro === null || !anulada) && (
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          {cobro === null ? (
            <Button type="button" variant="outline" size="sm" onClick={onRegistrar}>
              {TEXTO_REGISTRAR_COBRO}
            </Button>
          ) : (
            <>
              {puedeCobrar && (
                <Button type="button" variant="outline" size="sm" onClick={onEditar}>
                  <PencilIcon aria-hidden="true" />
                  {TEXTO_EDITAR_COBRO}
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
                {TEXTO_QUITAR_COBRO}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
