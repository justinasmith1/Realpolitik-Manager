import type { Cliente } from '@realpolitik/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  interpretarFalloAlta,
  type CambiosCliente,
  type NuevoCliente,
} from '@/modules/clientes/api/clientes.api';
import { ClienteForm, type ErroresDeEnvio } from '@/modules/clientes/components/ClienteForm';
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

  async function guardar(datos: NuevoCliente): Promise<ErroresDeEnvio | undefined> {
    if (cliente === null) {
      return undefined;
    }
    // El formulario no envía la periodicidad si quedó "Sin configurar". Si el cliente tenía
    // una, eso significa borrarla: en la edición, ausente sería "no modificar".
    const cambios: CambiosCliente =
      datos.periodicidad === undefined && cliente.periodicidad !== null
        ? { ...datos, periodicidad: null }
        : datos;
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
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>
            Modificá los datos de {cliente?.razonSocial} y guardá los cambios.
          </SheetDescription>
        </SheetHeader>
        {cliente !== null && (
          <ClienteForm
            key={cliente.id}
            valoresIniciales={clienteAValoresForm(cliente)}
            onSubmit={guardar}
            onCancel={onClose}
            textoEnviar="Guardar cambios"
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
