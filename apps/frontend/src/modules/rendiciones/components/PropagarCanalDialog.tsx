import type { CanalEntregaType, RendicionResumen, RequisitoCliente } from '@realpolitik/shared';
import { useId, useState, type RefObject } from 'react';

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
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingButton } from '@/components/ui/loading-button';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import { interpretarFalloPropagacion } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloPropagacion } from '@/modules/rendiciones/components/erroresDeRendicion';
import { usePropagarCanalDeRequisito } from '@/modules/rendiciones/hooks/useRendiciones';
import { etiquetaDePeriodo } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Un requisito al que le cambió el canal efectivo y las rendiciones activas que lo tienen. */
export interface Propagacion {
  clienteId: string;
  requisito: RequisitoCliente;
  /** El canal efectivo nuevo: el propio del requisito o, si hereda, el del cliente. */
  canal: CanalEntregaType;
  rendiciones: readonly RendicionResumen[];
}

interface PropagarCanalDialogProps {
  /** `null` mantiene el diálogo cerrado. */
  propagacion: Propagacion | null;
  onCerrar: () => void;
  /** Se actualizaron: avisa en la página con el texto del resultado. */
  onTerminado: (texto: string) => void;
  focoAlCerrar: RefObject<HTMLElement | null>;
}

const describir = (rendicion: RendicionResumen) =>
  `${etiquetaDePeriodo(rendicion)} (factura ${rendicion.numeroFactura})`;

/**
 * Después de cambiar el canal de un requisito, ofrece pasar ese canal a sus documentos en
 * rendiciones activas (ADR-0003). Ninguna viene tildada: actualizar tiene que ser una decisión de
 * la operadora. Es todo o nada: si una rendición no cumple, no cambia ninguna y el error queda en
 * el diálogo para destildarla y reintentar. El requisito ya quedó guardado igual.
 */
export function PropagarCanalDialog({
  propagacion,
  onCerrar,
  onTerminado,
  focoAlCerrar,
}: PropagarCanalDialogProps) {
  const id = useId();
  const propagar = usePropagarCanalDeRequisito();
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrada, setMostrada] = useState(propagacion);
  if (propagacion !== null && propagacion !== mostrada) {
    setMostrada(propagacion);
    setSeleccion(new Set());
    setError(null);
  }
  const nombre = mostrada?.requisito.tipoDocumento.nombre ?? '';
  const rendiciones = mostrada?.rendiciones ?? [];

  function alternar(rendicionId: string, marcada: boolean) {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (marcada) siguiente.add(rendicionId);
      else siguiente.delete(rendicionId);
      return siguiente;
    });
  }

  async function actualizar() {
    if (propagacion === null || seleccion.size === 0 || propagar.isPending) return;
    setError(null);
    // En el orden de la lista: el servidor informa la primera que no cumple en ese orden.
    const elegidas = propagacion.rendiciones.filter((rendicion) => seleccion.has(rendicion.id));
    try {
      await propagar.mutateAsync({
        clienteId: propagacion.clienteId,
        requisitoId: propagacion.requisito.id,
        rendicionIds: elegidas.map((rendicion) => rendicion.id),
      });
    } catch (fallo) {
      setError(
        mensajeFalloPropagacion(interpretarFalloPropagacion(fallo), (rendicionId) => {
          const rendicion = elegidas.find((elegida) => elegida.id === rendicionId);
          return rendicion === undefined ? null : describir(rendicion);
        }),
      );
      return;
    }
    const cantidad = elegidas.length;
    onTerminado(
      `Se actualizó el canal en ${cantidad} ${cantidad === 1 ? 'rendición' : 'rendiciones'}.`,
    );
  }

  return (
    <AlertDialog
      open={propagacion !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !propagar.isPending) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setSeleccion(new Set());
          setError(null);
          setMostrada(null);
        }
      }}
    >
      <AlertDialogContent finalFocus={focoAlCerrar}>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Actualizar el canal en las rendiciones abiertas?</AlertDialogTitle>
          <AlertDialogDescription>
            «{nombre}» ahora se envía por{' '}
            {mostrada === null ? '' : etiquetasCanalEntrega[mostrada.canal]}. Elegí en qué
            rendiciones abiertas pasar sus documentos a ese canal. Las demás, y los otros
            documentos, no cambian.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Rendiciones abiertas con «{nombre}»</legend>
          {rendiciones.map((rendicion) => {
            const idCasilla = `${id}-${rendicion.id}`;
            return (
              <div key={rendicion.id} className="inline-flex min-h-9 items-center gap-2 text-sm">
                <Checkbox
                  id={idCasilla}
                  checked={seleccion.has(rendicion.id)}
                  onCheckedChange={(marcada) => alternar(rendicion.id, marcada)}
                  disabled={propagar.isPending}
                />
                <label htmlFor={idCasilla} className="cursor-pointer">
                  {describir(rendicion)}
                </label>
              </div>
            );
          })}
        </fieldset>
        {error !== null && <Alert>{error}</Alert>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={propagar.isPending}>Ahora no</AlertDialogCancel>
          <LoadingButton
            loading={propagar.isPending}
            loadingText="Actualizando…"
            onClick={() => void actualizar()}
            disabled={seleccion.size === 0}
            className="min-w-48"
          >
            Actualizar las elegidas
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
