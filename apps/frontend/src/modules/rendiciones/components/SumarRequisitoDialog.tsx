import type { RendicionResumen, RequisitoCliente } from '@realpolitik/shared';
import { useId, useState, type RefObject } from 'react';

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
import { interpretarFalloAgregado } from '@/modules/rendiciones/api/rendiciones.api';
import { motivoFalloAgregado } from '@/modules/rendiciones/components/erroresDeRendicion';
import { useAgregarRequisitoARendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import { etiquetaDePeriodo } from '@/modules/rendiciones/rendiciones.etiquetas';

export type VarianteDeResultado = 'success' | 'warning' | 'destructive';

interface SumarRequisitoDialogProps {
  /** El requisito recién agregado a la matriz. `null` mantiene el diálogo cerrado. */
  requisito: RequisitoCliente | null;
  /** Las rendiciones abiertas del cliente. */
  rendiciones: readonly RendicionResumen[];
  onCerrar: () => void;
  /** Resultado para avisar en la página: qué rendiciones lo sumaron y cuáles no. */
  onTerminado: (variante: VarianteDeResultado, texto: string) => void;
  focoAlCerrar: RefObject<HTMLElement | null>;
}

const describir = (rendicion: RendicionResumen) =>
  `${etiquetaDePeriodo(rendicion)} (factura ${rendicion.numeroFactura})`;

/**
 * Después de agregar un requisito a la matriz, ofrece sumarlo también a rendiciones ya abiertas
 * (la excepción explícita a la "foto" del checklist, contrato 4.5). Ninguna viene tildada:
 * sumar tiene que ser una decisión de la operadora. Cada rendición es un pedido aparte; si
 * alguno falla, se informa cuáles se sumaron y cuáles no.
 */
export function SumarRequisitoDialog({
  requisito,
  rendiciones,
  onCerrar,
  onTerminado,
  focoAlCerrar,
}: SumarRequisitoDialogProps) {
  const id = useId();
  const agregado = useAgregarRequisitoARendicion();
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [pendiente, setPendiente] = useState(false);
  const [mostrado, setMostrado] = useState(requisito);
  if (requisito !== null && requisito !== mostrado) setMostrado(requisito);
  const nombre = mostrado?.tipoDocumento.nombre ?? '';

  function alternar(rendicionId: string, marcada: boolean) {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (marcada) siguiente.add(rendicionId);
      else siguiente.delete(rendicionId);
      return siguiente;
    });
  }

  async function sumar() {
    if (requisito === null || seleccion.size === 0 || pendiente) return;
    setPendiente(true);
    const elegidas = rendiciones.filter((rendicion) => seleccion.has(rendicion.id));
    const sumadas: RendicionResumen[] = [];
    const fallidas: string[] = [];
    // De a una: así cada resultado se informa por separado y un fallo no frena a las demás.
    for (const rendicion of elegidas) {
      try {
        await agregado.mutateAsync({
          clienteId: rendicion.clienteId,
          rendicionId: rendicion.id,
          requisitoId: requisito.id,
        });
        sumadas.push(rendicion);
      } catch (error) {
        fallidas.push(
          `${describir(rendicion)}: ${motivoFalloAgregado(interpretarFalloAgregado(error))}`,
        );
      }
    }
    setPendiente(false);

    const partes: string[] = [];
    if (sumadas.length > 0) {
      partes.push(`Se sumó ${nombre} a ${sumadas.map(describir).join(', ')}.`);
    }
    if (fallidas.length > 0) {
      partes.push(`No se pudo sumar a ${fallidas.join('; ')}.`);
    }
    const variante: VarianteDeResultado =
      fallidas.length === 0 ? 'success' : sumadas.length === 0 ? 'destructive' : 'warning';
    onTerminado(variante, partes.join(' '));
  }

  return (
    <AlertDialog
      open={requisito !== null}
      onOpenChange={(abrir) => {
        if (!abrir && !pendiente) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setSeleccion(new Set());
          setMostrado(null);
        }
      }}
    >
      <AlertDialogContent finalFocus={focoAlCerrar}>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Sumarlo a las rendiciones abiertas?</AlertDialogTitle>
          <AlertDialogDescription>
            «{nombre}» ya está en los requisitos del cliente y entra en las rendiciones que se abran
            desde ahora. Elegí si también tiene que sumarse a alguna que ya está abierta. Los
            documentos que esas rendiciones ya tienen no cambian.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Rendiciones abiertas</legend>
          {rendiciones.map((rendicion) => {
            const idCasilla = `${id}-${rendicion.id}`;
            return (
              <div key={rendicion.id} className="inline-flex min-h-9 items-center gap-2 text-sm">
                <Checkbox
                  id={idCasilla}
                  checked={seleccion.has(rendicion.id)}
                  onCheckedChange={(marcada) => alternar(rendicion.id, marcada)}
                  disabled={pendiente}
                />
                <label htmlFor={idCasilla} className="cursor-pointer">
                  {describir(rendicion)}
                </label>
              </div>
            );
          })}
        </fieldset>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendiente}>Ahora no</AlertDialogCancel>
          <LoadingButton
            loading={pendiente}
            loadingText="Sumando…"
            onClick={() => void sumar()}
            disabled={seleccion.size === 0}
            className="min-w-48"
          >
            Sumar a las elegidas
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
