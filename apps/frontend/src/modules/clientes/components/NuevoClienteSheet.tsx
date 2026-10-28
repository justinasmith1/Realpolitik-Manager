import type { Cliente } from '@realpolitik/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { interpretarFalloAlta, type NuevoCliente } from '@/modules/clientes/api/clientes.api';
import { interpretarFalloIndicaciones } from '@/modules/clientes/api/indicaciones-armado.api';
import { interpretarFalloObservaciones } from '@/modules/clientes/api/observaciones-cliente.api';
import type { FallosDelAlta, NotaDelAlta } from '@/modules/clientes/components/avisoDelAlta';
import {
  ClienteForm,
  type EnvioDelFormulario,
  type ErroresDeEnvio,
} from '@/modules/clientes/components/ClienteForm';
import { erroresParaElFormulario } from '@/modules/clientes/components/erroresDeEnvio';
import { motivoFalloIndicaciones } from '@/modules/clientes/components/erroresDeIndicaciones';
import { motivoFalloObservaciones } from '@/modules/clientes/components/erroresDeObservaciones';
import { useCrearCliente } from '@/modules/clientes/hooks/useCrearCliente';
import { useGuardarIndicacionesArmado } from '@/modules/clientes/hooks/useIndicacionesArmado';
import { useGuardarObservacionesCliente } from '@/modules/clientes/hooks/useObservacionesCliente';

const MENSAJE_INESPERADO = 'No pudimos registrar el cliente. Probá de nuevo en unos segundos.';

interface NuevoClienteSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /**
   * Se llama con el cliente creado. Quien abre el panel decide cómo seguir (p. ej. cerrarlo).
   * `fallos` llega si el cliente se creó pero alguna de sus notas (indicaciones de armado,
   * observaciones internas) no se guardó: los motivos y qué notas sí se guardaron, para avisarlo.
   */
  onCreado: (cliente: Cliente, fallos?: FallosDelAlta) => void;
}

/**
 * Panel lateral del alta de cliente (HU1.1, HU2.4, HU2.10). Si el envío falla, queda abierto con
 * los datos. Si sale bien, el botón confirma "Registrado" un instante y recién entonces avisa
 * `onCreado`.
 *
 * Las indicaciones de armado y las observaciones internas se guardan después del alta, cada una
 * con su pedido (solo si tienen texto). Son independientes: se intentan las dos aunque la primera
 * falle. Si alguna falla, el cliente ya existe: no se puede volver a enviar el alta (sería un CUIT
 * duplicado), así que el alta se da por hecha y los motivos viajan en `onCreado` para que la
 * página los avise.
 */
export function NuevoClienteSheet({ abierto, onAbiertoChange, onCreado }: NuevoClienteSheetProps) {
  const alta = useCrearCliente();
  const guardadoIndicaciones = useGuardarIndicacionesArmado();
  const guardadoObservaciones = useGuardarObservacionesCliente();
  const exito = useExitoBreve();

  async function registrar(
    datos: NuevoCliente,
    { indicaciones, observaciones }: EnvioDelFormulario,
  ): Promise<ErroresDeEnvio | undefined> {
    let creado: Cliente;
    try {
      // Resuelve con el alta hecha y el listado ya vuelto a pedir.
      creado = await alta.mutateAsync(datos);
    } catch (error) {
      return erroresParaElFormulario(interpretarFalloAlta(error), MENSAJE_INESPERADO);
    }

    const motivos: FallosDelAlta['motivos'] = {};
    const guardadas: NotaDelAlta[] = [];
    if (indicaciones.valor !== null) {
      try {
        await guardadoIndicaciones.mutateAsync({
          clienteId: creado.id,
          datos: { indicacionesArmado: indicaciones.valor },
        });
        guardadas.push('indicaciones');
      } catch (error) {
        motivos.indicaciones = motivoFalloIndicaciones(interpretarFalloIndicaciones(error));
      }
    }
    if (observaciones.valor !== null) {
      try {
        await guardadoObservaciones.mutateAsync({
          clienteId: creado.id,
          datos: { observaciones: observaciones.valor },
        });
        guardadas.push('observaciones');
      } catch (error) {
        motivos.observaciones = motivoFalloObservaciones(interpretarFalloObservaciones(error));
      }
    }

    await exito.mostrar();
    if (Object.keys(motivos).length === 0) {
      onCreado(creado);
    } else {
      onCreado(creado, { motivos, guardadas });
    }
    return undefined;
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (
          !abrir &&
          (alta.isPending ||
            guardadoIndicaciones.isPending ||
            guardadoObservaciones.isPending ||
            exito.activo)
        ) {
          return;
        }
        onAbiertoChange(abrir);
      }}
      // Recién cuando terminó de cerrarse: así el botón no vuelve a "Registrar cliente" mientras sale.
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) exito.reiniciar();
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Nuevo cliente</SheetTitle>
          <SheetDescription>
            Completá los datos para registrarlo en el catálogo. Todos los campos son obligatorios,
            salvo los marcados como opcionales.
          </SheetDescription>
        </SheetHeader>
        <ClienteForm
          onSubmit={registrar}
          onCancel={() => onAbiertoChange(false)}
          textoEnviar="Registrar cliente"
          textoEnviando="Registrando…"
          textoEnviado="Registrado"
          exito={exito.activo}
        />
      </SheetContent>
    </Sheet>
  );
}
