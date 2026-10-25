import type { Cliente } from '@realpolitik/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { interpretarFalloAlta, type NuevoCliente } from '@/modules/clientes/api/clientes.api';
import {
  guardarIndicacionesArmado,
  indicacionesArmadoQueryKey,
} from '@/modules/clientes/api/indicaciones-armado.api';
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

/**
 * Panel lateral de la edición de cliente (HU1.7, HU2.4). Si el envío falla, queda abierto con los datos.
 * Si sale bien, el botón confirma "Guardado" un instante y recién entonces avisa `onActualizado`.
 */
export function EditarClienteSheet({ cliente, onClose, onActualizado }: EditarClienteSheetProps) {
  const edicion = useActualizarCliente();
  const queryClient = useQueryClient();
  const exito = useExitoBreve();
  // Mientras el panel sale, sigue mostrando al último cliente (y su "Guardado"): quien lo usa
  // pasa `cliente` a null al cerrar, y sin esto el formulario desaparecería durante la salida.
  const [mostrado, setMostrado] = useState(cliente);
  if (cliente !== null && cliente !== mostrado) {
    setMostrado(cliente);
  }
  // Los valores con los que abre el formulario: son la referencia de "qué cambió".
  const valoresIniciales = useMemo(
    () => (mostrado === null ? null : clienteAValoresForm(mostrado)),
    [mostrado],
  );

  async function guardar(
    datos: NuevoCliente,
    { modificados, indicaciones }: EnvioDelFormulario,
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
    const hayCambiosCliente = hayCambios(cambios);
    const hayCambiosIndicaciones = Boolean(indicaciones?.modificado);

    if (!hayCambiosCliente && !hayCambiosIndicaciones) {
      // El botón ya se deshabilita sin cambios; si igual llega acá, no hay nada que pedir.
      onClose();
      return undefined;
    }

    let actualizado: Cliente = cliente;
    if (hayCambiosCliente) {
      try {
        // Resuelve con el cambio hecho y el listado ya vuelto a pedir.
        actualizado = await edicion.mutateAsync({ id: cliente.id, datos: cambios });
      } catch (error) {
        return erroresParaElFormulario(interpretarFalloAlta(error), MENSAJE_INESPERADO);
      }
    }

    if (hayCambiosIndicaciones && indicaciones) {
      try {
        await guardarIndicacionesArmado(cliente.id, {
          indicacionesArmado: indicaciones.texto === '' ? null : indicaciones.texto,
        });
        void queryClient.invalidateQueries({
          queryKey: indicacionesArmadoQueryKey(cliente.id),
        });
      } catch {
        if (!hayCambiosCliente) {
          return { general: MENSAJE_INESPERADO };
        }
      }
    }

    await exito.mostrar();
    onActualizado(actualizado);
    return undefined;
  }

  return (
    <Sheet
      open={cliente !== null}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrir && (edicion.isPending || exito.activo)) {
          return;
        }
        if (!abrir) {
          onClose();
        }
      }}
      // Recién cuando terminó de cerrarse: así el botón no vuelve a "Guardar cambios" mientras sale.
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          exito.reiniciar();
          setMostrado(null);
        }
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>
            Modificá los datos de {mostrado?.razonSocial} y guardá los cambios.
          </SheetDescription>
        </SheetHeader>
        {mostrado !== null && valoresIniciales !== null && (
          <ClienteForm
            key={mostrado.id}
            cliente={mostrado}
            valoresIniciales={valoresIniciales}
            onSubmit={guardar}
            onCancel={onClose}
            textoEnviar="Guardar cambios"
            exito={exito.activo}
            soloConCambios
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
