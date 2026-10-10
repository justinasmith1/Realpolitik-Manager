import type { Cliente } from '@realpolitik/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { interpretarFalloAlta, type NuevoCliente } from '@/modules/clientes/api/clientes.api';
import { ClienteForm, type ErroresDeEnvio } from '@/modules/clientes/components/ClienteForm';
import { erroresParaElFormulario } from '@/modules/clientes/components/erroresDeEnvio';
import { useCrearCliente } from '@/modules/clientes/hooks/useCrearCliente';

const MENSAJE_INESPERADO = 'No pudimos registrar el cliente. Probá de nuevo en unos segundos.';

interface NuevoClienteSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se llama con el cliente creado. Quien abre el panel decide cómo seguir (p. ej. cerrarlo). */
  onCreado: (cliente: Cliente) => void;
}

/** Panel lateral del alta de cliente (HU1.1). Si el envío falla, queda abierto con los datos. */
export function NuevoClienteSheet({ abierto, onAbiertoChange, onCreado }: NuevoClienteSheetProps) {
  const alta = useCrearCliente();

  async function registrar(datos: NuevoCliente): Promise<ErroresDeEnvio | undefined> {
    try {
      onCreado(await alta.mutateAsync(datos));
      return undefined;
    } catch (error) {
      return erroresParaElFormulario(interpretarFalloAlta(error), MENSAJE_INESPERADO);
    }
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se guarda no se cierra: el resultado del envío tiene que verse.
        if (!abrir && alta.isPending) {
          return;
        }
        onAbiertoChange(abrir);
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
        />
      </SheetContent>
    </Sheet>
  );
}
