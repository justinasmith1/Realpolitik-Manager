import type { Cliente } from '@realpolitik/shared';
import { useMemo, useRef, useState } from 'react';

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
  interpretarFalloIndicaciones,
  type FalloIndicaciones,
} from '@/modules/clientes/api/indicaciones-armado.api';
import {
  interpretarFalloObservaciones,
  type FalloObservaciones,
} from '@/modules/clientes/api/observaciones-cliente.api';
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
import { erroresDeNotasParaElFormulario } from '@/modules/clientes/components/erroresDeNotasDelCliente';
import { useActualizarCliente } from '@/modules/clientes/hooks/useActualizarCliente';
import {
  useGuardarIndicacionesArmado,
  useIndicacionesArmado,
} from '@/modules/clientes/hooks/useIndicacionesArmado';
import {
  useGuardarObservacionesCliente,
  useObservacionesCliente,
} from '@/modules/clientes/hooks/useObservacionesCliente';

const MENSAJE_INESPERADO = 'No pudimos guardar los cambios. Probá de nuevo en unos segundos.';

interface EditarClienteSheetProps {
  /** Cliente a editar, con los datos del listado. `null` mantiene el panel cerrado. */
  cliente: Cliente | null;
  onClose: () => void;
  /** Se llama con el cliente actualizado. Quien abre el panel decide cómo seguir. */
  onActualizado: (cliente: Cliente) => void;
  /**
   * A qué campo lleva el foco la hoja al abrirse, en lugar del habitual. Solo se aplica si el
   * campo ya está cargado y se puede editar al abrir; si no, queda el foco habitual (un foco que
   * llegara después le quitaría al usuario lo que ya estuviera haciendo).
   */
  enfocar?: 'observaciones' | undefined;
}

/**
 * Panel lateral de la edición de cliente (HU1.7, HU2.4, HU2.10). Si el envío falla, queda abierto con
 * los datos. Si sale bien, el botón confirma "Guardado" un instante y recién entonces avisa
 * `onActualizado`.
 *
 * Los datos del cliente (PATCH), sus indicaciones de armado (PUT) y sus observaciones internas
 * (PUT) son pedidos distintos. El PATCH va primero y, si falla, no se envía nada más. Si sale
 * bien, las dos notas se intentan aunque la primera falle (son independientes). Si alguna falla,
 * no se muestra "Guardado": el panel queda abierto diciendo qué se guardó y qué no.
 */
export function EditarClienteSheet({
  cliente,
  onClose,
  onActualizado,
  enfocar,
}: EditarClienteSheetProps) {
  const edicion = useActualizarCliente();
  const guardadoIndicaciones = useGuardarIndicacionesArmado();
  const guardadoObservaciones = useGuardarObservacionesCliente();
  const exito = useExitoBreve();
  const observacionesRef = useRef<HTMLTextAreaElement>(null);
  // Mientras el panel sale, sigue mostrando al último cliente (y su "Guardado"): quien lo usa
  // pasa `cliente` a null al cerrar, y sin esto el formulario desaparecería durante la salida.
  const [mostrado, setMostrado] = useState(cliente);
  if (cliente !== null && cliente !== mostrado) {
    setMostrado(cliente);
  }
  const consultaIndicaciones = useIndicacionesArmado(mostrado?.id);
  const consultaObservaciones = useObservacionesCliente(mostrado?.id);
  // Los valores con los que abre el formulario: son la referencia de "qué cambió".
  const valoresIniciales = useMemo(
    () => (mostrado === null ? null : clienteAValoresForm(mostrado)),
    [mostrado],
  );

  /** El campo de observaciones si ya se puede editar; si no, el foco habitual (`true`). */
  function enfocarObservacionesSiPuede() {
    const campo = observacionesRef.current;
    return campo !== null && !campo.disabled ? campo : true;
  }

  async function guardar(
    datos: NuevoCliente,
    { modificados, indicaciones, observaciones }: EnvioDelFormulario,
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
    const hayCambiosIndicaciones = indicaciones.modificado;
    const hayCambiosObservaciones = observaciones.modificado;

    if (!hayCambiosCliente && !hayCambiosIndicaciones && !hayCambiosObservaciones) {
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

    // Las dos notas son independientes: se intentan ambas aunque la primera falle, y el aviso
    // cuenta todo junto.
    let falloIndicaciones: FalloIndicaciones | undefined;
    if (hayCambiosIndicaciones) {
      try {
        await guardadoIndicaciones.mutateAsync({
          clienteId: cliente.id,
          datos: { indicacionesArmado: indicaciones.valor },
        });
      } catch (error) {
        falloIndicaciones = interpretarFalloIndicaciones(error);
      }
    }
    let falloObservaciones: FalloObservaciones | undefined;
    if (hayCambiosObservaciones) {
      try {
        await guardadoObservaciones.mutateAsync({
          clienteId: cliente.id,
          datos: { observaciones: observaciones.valor },
        });
      } catch (error) {
        falloObservaciones = interpretarFalloObservaciones(error);
      }
    }
    if (falloIndicaciones !== undefined || falloObservaciones !== undefined) {
      return erroresDeNotasParaElFormulario({
        seGuardoElCliente: hayCambiosCliente,
        seGuardaronIndicaciones: hayCambiosIndicaciones && falloIndicaciones === undefined,
        seGuardaronObservaciones: hayCambiosObservaciones && falloObservaciones === undefined,
        falloIndicaciones,
        falloObservaciones,
      });
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
        if (
          !abrir &&
          (edicion.isPending ||
            guardadoIndicaciones.isPending ||
            guardadoObservaciones.isPending ||
            exito.activo)
        ) {
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
      <SheetContent
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        {...(enfocar === 'observaciones' && { initialFocus: enfocarObservacionesSiPuede })}
      >
        <SheetHeader>
          <SheetTitle>Editar cliente</SheetTitle>
          <SheetDescription>
            Modificá los datos de {mostrado?.razonSocial} y guardá los cambios.
          </SheetDescription>
        </SheetHeader>
        {mostrado !== null && valoresIniciales !== null && (
          <ClienteForm
            key={mostrado.id}
            valoresIniciales={valoresIniciales}
            indicaciones={{
              guardadas: consultaIndicaciones.data?.indicacionesArmado,
              cargando: consultaIndicaciones.isPending,
              errorAlCargar: consultaIndicaciones.isError,
              estadoCliente: mostrado.estado,
            }}
            observaciones={{
              guardadas: consultaObservaciones.data?.observaciones,
              cargando: consultaObservaciones.isPending,
              errorAlCargar: consultaObservaciones.isError,
            }}
            observacionesRef={observacionesRef}
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
