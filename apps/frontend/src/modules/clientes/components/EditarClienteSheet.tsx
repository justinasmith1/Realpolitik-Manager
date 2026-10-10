import type { Cliente } from '@realpolitik/shared';
import { useMemo } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { interpretarFalloAlta, type NuevoCliente } from '@/modules/clientes/api/clientes.api';
import {
  construirCambiosCliente,
  hayCambios,
} from '@/modules/clientes/components/cambiosDeEdicion';
import {
  ClienteForm,
  type EnvioDelFormulario,
  type ErroresDeEnvio,
} from '@/modules/clientes/components/ClienteForm';
import { clienteAValoresForm } from '@/modules/clientes/components/clienteForm.validation';
import { erroresParaElFormulario } from '@/modules/clientes/components/erroresDeEnvio';
import { useActualizarCliente } from '@/modules/clientes/hooks/useActualizarCliente';

const MENSAJE_INESPERADO = 'No pudimos guardar los cambios. Probá de nuevo en unos segundos.';

interface EditarClienteSheetProps {
  /** Cliente a editar, con los datos del listado. `null` mantiene el panel cerrado. */
  cliente: Cliente | null;
  onClose: () => void;
  /** Se llama con el cliente actualizado. Quien abre el panel decide cómo seguir. */
  onActualizado: (cliente: Cliente) => void;
}

/** Panel lateral de la edición de cliente (HU1.7). Si el envío falla, queda abierto con los datos. */
export function EditarClienteSheet({ cliente, onClose, onActualizado }: EditarClienteSheetProps) {
  const edicion = useActualizarCliente();
  // Los valores con los que abre el formulario: son la referencia de "qué cambió".
  const valoresIniciales = useMemo(
    () => (cliente === null ? null : clienteAValoresForm(cliente)),
    [cliente],
  );

  async function guardar(
    datos: NuevoCliente,
    { modificados }: EnvioDelFormulario,
  ): Promise<ErroresDeEnvio | undefined> {
    if (cliente === null) {
      return undefined;
    }
    // Solo lo modificado: reenviar el formulario entero pisaría lo que otra persona haya
    // cambiado mientras este panel estaba abierto (ver `construirCambiosCliente`).
    const cambios = construirCambiosCliente(
      datos,
      modificados,
      valoresIniciales ?? clienteAValoresForm(cliente),
    );
    if (!hayCambios(cambios)) {
      // El botón ya se deshabilita sin cambios; si igual llega acá, no hay nada que pedir.
      onClose();
      return undefined;
    }
    try {
      onActualizado(await edicion.mutateAsync({ id: cliente.id, datos: cambios }));
      return undefined;
    } catch (error) {
      return erroresParaElFormulario(interpretarFalloAlta(error), MENSAJE_INESPERADO);
    }
  }

  return (
    <Sheet
      open={cliente !== null}
      onOpenChange={(abrir) => {
        // Mientras se guarda no se cierra: el resultado del envío tiene que verse.
        if (!abrir && edicion.isPending) {
          return;
        }
        if (!abrir) {
          onClose();
        }
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>
            Modificá los datos de {cliente?.razonSocial} y guardá los cambios.
          </SheetDescription>
        </SheetHeader>
        {cliente !== null && valoresIniciales !== null && (
          <ClienteForm
            key={cliente.id}
            valoresIniciales={valoresIniciales}
            onSubmit={guardar}
            onCancel={onClose}
            textoEnviar="Guardar cambios"
            soloConCambios
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
