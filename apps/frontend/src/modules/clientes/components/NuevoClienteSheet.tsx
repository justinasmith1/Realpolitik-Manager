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
  type FalloAltaCliente,
  type NuevoCliente,
} from '@/modules/clientes/api/clientes.api';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import { ClienteForm, type ErroresDeEnvio } from '@/modules/clientes/components/ClienteForm';
import { useCrearCliente } from '@/modules/clientes/hooks/useCrearCliente';

const camposDelFormulario = new Set<string>([
  'razonSocial',
  'denominacion',
  'cuit',
  'sector',
  'subtipo',
  'ivaCondicion',
  'emailContacto',
]);

/** Texto para la interfaz de cada fallo del alta. Nunca muestra detalles técnicos. */
function erroresParaElFormulario(fallo: FalloAltaCliente): ErroresDeEnvio {
  switch (fallo.tipo) {
    case 'cuit-duplicado': {
      const existente = fallo.clienteExistente;
      return {
        campos: {
          cuit:
            existente === null
              ? 'Ya existe un cliente registrado con este CUIT.'
              : `Ya existe un cliente registrado con este CUIT: ${existente.razonSocial} (${etiquetasEstado[existente.estado]}).`,
        },
      };
    }
    case 'datos-invalidos': {
      const campos = Object.fromEntries(
        fallo.campos
          .filter((campo) => camposDelFormulario.has(campo))
          .map((campo) => [campo, 'Revisá este dato.']),
      );
      return { campos, general: 'Algunos datos no son válidos. Revisá los campos marcados.' };
    }
    case 'inesperado':
      return { general: 'No pudimos registrar el cliente. Probá de nuevo en unos segundos.' };
  }
}

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
      return erroresParaElFormulario(interpretarFalloAlta(error));
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
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>Nuevo cliente</SheetTitle>
          <SheetDescription>
            Completá los datos para registrarlo en el catálogo. Todos los campos son obligatorios.
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
