import {
  ESTADOS_CON_FECHA,
  esAtrasada,
  fechaDelPaso,
  type RendicionDelMes,
  type RendicionDetalle,
} from '@realpolitik/shared';
import { cn } from 'cn';
import { ArrowRightIcon, XIcon } from 'lucide-react';
import { useEffect, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';
import {
  AvisoDeRechazo,
  rechazoPendienteDe,
} from '@/modules/rendiciones/components/AvisoDeRechazo';
import { EstadoRendicionBadge } from '@/modules/rendiciones/components/EstadoRendicionBadge';
import { ItemReunidoBadge } from '@/modules/rendiciones/components/ItemReunidoBadge';
import { fondoDeEstado, textoDeEstado } from '@/modules/rendiciones/estadoRendicion.colores';
import {
  avanceDelChecklist,
  etiquetaDePeriodo,
  nombreDeItem,
  textoDeUltimoPaso,
  tipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import { rutaDeRendicion } from '@/modules/rendiciones/rendiciones.rutas';

interface ResumenRendicionPanelProps {
  /** La fila del listado: el cliente, para la cabecera, sin esperar al detalle. */
  fila: RendicionDelMes;
  /** El detalle (`GET /rendiciones/:id`), cuando llegó. */
  detalle: RendicionDetalle | undefined;
  error: boolean;
  reintentando: boolean;
  onReintentar: () => void;
  onCerrar: () => void;
  /** La región, para llevarle el foco al abrirse. */
  ref?: Ref<HTMLElement>;
}

/**
 * La fecha del último paso, como en la fila del listado: la de la entrada del historial que llevó
 * a la rendición a su estado actual (en una Enviada, la fecha de envío elegida: `fechaDelPaso`),
 * solo si ya salió hacia el organismo. El historial viene del
 * cambio más viejo al más nuevo.
 */
function ultimoPasoDe({ estado, historial }: RendicionDetalle) {
  const ultima = historial.at(-1);
  const conFecha = (ESTADOS_CON_FECHA as readonly string[]).includes(estado);
  return conFecha && ultima !== undefined && ultima.estadoNuevo === estado
    ? { estado, fecha: fechaDelPaso(ultima) }
    : null;
}

/**
 * Un bloque del panel, separado del anterior por una línea que no llega a los bordes. Con título,
 * el título a la izquierda y un dato (`extra`) a la derecha.
 */
function Bloque({
  titulo,
  extra,
  children,
}: {
  titulo?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-6 flex flex-col gap-3 border-t py-4">
      {titulo !== undefined && (
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

/** Un dato con su etiqueta chica arriba ("Estado", "Período"). */
function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs text-content-secondary">{etiqueta}</span>
      {children}
    </div>
  );
}

/**
 * Resumen de una rendición junto al listado de la pantalla Rendiciones (HU3.5), de solo lectura:
 * la cabecera con el cliente y la factura, el estado (con la marca de Atrasada y la fecha del
 * último paso) y el período, los documentos reunidos y pendientes, y el único acceso al detalle,
 * el enlace "Ir a la rendición".
 *
 * Es una región con nombre, no un diálogo: en escritorio es una tarjeta a la derecha del listado,
 * del alto de su contenido, y el listado sigue a la vista y se puede usar. Por debajo de `lg`
 * ocupa toda la pantalla, por encima del listado. Se cierra con la X o con Escape.
 *
 * Los bloques van uno debajo del otro. El motivo del rechazo pendiente (HU3.9) va en un `Bloque`
 * propio después del estado, destacado: en una Rechazada, o en una En curso o Completa que se está
 * corrigiendo. La fecha del cobro (HU3.10) se sumará igual.
 */
export function ResumenRendicionPanel({
  fila,
  detalle,
  error,
  reintentando,
  onReintentar,
  onCerrar,
  ref,
}: ResumenRendicionPanelProps) {
  const { cliente } = fila;

  // Escape cierra el panel, salvo que otro control ya lo haya usado (un desplegable abierto).
  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape' && !evento.defaultPrevented) onCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  let cuerpo: ReactNode;
  if (error) {
    cuerpo = (
      <Bloque>
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>No pudimos cargar la rendición.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReintentar}
              disabled={reintentando}
            >
              Reintentar
            </Button>
          </div>
        </Alert>
      </Bloque>
    );
  } else if (detalle === undefined) {
    cuerpo = (
      <Bloque>
        <span className="sr-only" role="status">
          Cargando la rendición…
        </span>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-3 h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </Bloque>
    );
  } else {
    const ultimoPaso = ultimoPasoDe(detalle);
    const atrasada =
      detalle.vigencia === 'ACTIVA' && esAtrasada(detalle, detalle.estado, new Date());
    const reunidos = detalle.items.filter((item) => item.completado).length;
    cuerpo = (
      <>
        <Bloque>
          <div className="grid grid-cols-2 gap-4">
            <Dato etiqueta="Estado">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <EstadoRendicionBadge estado={detalle.estado} />
                {atrasada && <span className="text-sm font-semibold text-atrasada">Atrasada</span>}
                {ultimoPaso !== null && (
                  <span className="text-sm text-content-secondary">
                    {textoDeUltimoPaso(ultimoPaso)}
                  </span>
                )}
              </div>
            </Dato>
            <Dato etiqueta="Período">
              <span className="text-[0.9375rem] text-foreground">{etiquetaDePeriodo(detalle)}</span>
            </Dato>
          </div>
        </Bloque>
        {rechazoPendienteDe(detalle) !== null && (
          <Bloque>
            <AvisoDeRechazo rendicion={detalle} />
          </Bloque>
        )}
        <Bloque
          titulo="Documentos"
          extra={
            <span className="text-sm whitespace-nowrap text-content-secondary">
              {avanceDelChecklist({ completados: reunidos, totalItems: detalle.items.length })}
            </span>
          }
        >
          {detalle.items.length === 0 ? (
            <p className="text-sm text-content-secondary">Esta rendición no tiene documentos.</p>
          ) : (
            <ul aria-label="Documentos" className="flex flex-col divide-y">
              {detalle.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0.5 last:pb-0.5"
                >
                  <span className="min-w-0 text-sm text-foreground">{nombreDeItem(item)}</span>
                  <ItemReunidoBadge reunido={item.completado} pendiente="calido" />
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      </>
    );
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={`Resumen de la rendición de ${cliente.denominacion}`}
      className={cn(
        'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-card outline-none',
        // Escritorio: una tarjeta del alto de su contenido, que acompaña el scroll del listado (si
        // es más alta que la ventana, se recorre por dentro).
        'lg:sticky lg:inset-auto lg:top-6 lg:z-auto lg:max-h-[calc(100svh-3rem)] lg:rounded-card lg:border',
      )}
    >
      <div className="flex items-start gap-3.5 px-6 pt-6 pb-5">
        <ClienteMonogram
          nombre={cliente.denominacion}
          className={cn(
            'size-12 shrink-0 rounded-full text-sm',
            fondoDeEstado[fila.estado],
            textoDeEstado[fila.estado],
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-xl leading-tight font-semibold text-foreground">
            {cliente.denominacion}
          </h2>
          <p className="text-sm text-content-secondary">{tipoDeCliente(cliente)}</p>
          <p className="font-mono text-xs text-content-secondary">Factura {fila.numeroFactura}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mt-1 -mr-2 shrink-0"
          aria-label="Cerrar el resumen"
          onClick={onCerrar}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {cuerpo}
      {/* Al pie: en celular, abajo de todo; en escritorio, debajo de los documentos. */}
      <div className="mt-auto px-6 pt-2 pb-6">
        <Link
          to={rutaDeRendicion(fila.clienteId, fila.id)}
          className="inline-flex items-center gap-1 rounded-chip text-sm font-semibold text-brand-accent underline underline-offset-4 outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Ir a la rendición
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  );
}
