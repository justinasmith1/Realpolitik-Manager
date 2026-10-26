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
import {
  ClienteForm,
  type EnvioDelFormulario,
  type ErroresDeEnvio,
} from '@/modules/clientes/components/ClienteForm';
import { erroresParaElFormulario } from '@/modules/clientes/components/erroresDeEnvio';
import { motivoFalloIndicaciones } from '@/modules/clientes/components/erroresDeIndicaciones';
import { useCrearCliente } from '@/modules/clientes/hooks/useCrearCliente';
import { useGuardarIndicacionesArmado } from '@/modules/clientes/hooks/useIndicacionesArmado';

const MENSAJE_INESPERADO = 'No pudimos registrar el cliente. Probá de nuevo en unos segundos.';

interface NuevoClienteSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /**
   * Se llama con el cliente creado. Quien abre el panel decide cómo seguir (p. ej. cerrarlo).
   * `falloIndicaciones` llega si el cliente se creó pero sus indicaciones de armado no se
   * guardaron: es el motivo, para avisarlo.
   */
  onCreado: (cliente: Cliente, falloIndicaciones?: string) => void;
}

/**
 * Panel lateral del alta de cliente (HU1.1, HU2.4). Si el envío falla, queda abierto con los
 * datos. Si sale bien, el botón confirma "Registrado" un instante y recién entonces avisa
 * `onCreado`.
 *
 * Las indicaciones de armado se guardan después del alta, con otro pedido. Si ese pedido falla,
 * el cliente ya existe: no se puede volver a enviar el alta (sería un CUIT duplicado), así que el
 * alta se da por hecha y el motivo viaja en `onCreado` para que la página lo avise.
 */
export function NuevoClienteSheet({ abierto, onAbiertoChange, onCreado }: NuevoClienteSheetProps) {
  const alta = useCrearCliente();
  const guardadoIndicaciones = useGuardarIndicacionesArmado();
  const exito = useExitoBreve();

  async function registrar(
    datos: NuevoCliente,
    { indicaciones }: EnvioDelFormulario,
  ): Promise<ErroresDeEnvio | undefined> {
    let creado: Cliente;
    try {
      // Resuelve con el alta hecha y el listado ya vuelto a pedir.
      creado = await alta.mutateAsync(datos);
    } catch (error) {
      return erroresParaElFormulario(interpretarFalloAlta(error), MENSAJE_INESPERADO);
    }

    let falloIndicaciones: string | undefined;
    if (indicaciones.valor !== null) {
      try {
        await guardadoIndicaciones.mutateAsync({
          clienteId: creado.id,
          datos: { indicacionesArmado: indicaciones.valor },
        });
      } catch (error) {
        falloIndicaciones = motivoFalloIndicaciones(interpretarFalloIndicaciones(error));
      }
    }

    await exito.mostrar();
    if (falloIndicaciones === undefined) {
      onCreado(creado);
    } else {
      onCreado(creado, falloIndicaciones);
    }
    return undefined;
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrir && (alta.isPending || guardadoIndicaciones.isPending || exito.activo)) {
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
