import type { CreateTipoDocumentoDto, TipoDocumento } from '@realpolitik/shared';
import { useMemo, useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { interpretarFalloEdicionTipoDocumento } from '@/modules/tipos-documento/api/tipos-documento.api';
import {
  erroresParaElFormulario,
  type ErroresDeEnvio,
} from '@/modules/tipos-documento/components/erroresDeTipoDocumento';
import { TipoDocumentoForm } from '@/modules/tipos-documento/components/TipoDocumentoForm';
import {
  cambiosDeTipoDocumento,
  hayCambios,
  tipoDocumentoAValoresForm,
} from '@/modules/tipos-documento/components/tipoDocumentoForm.validation';
import { useActualizarTipoDocumento } from '@/modules/tipos-documento/hooks/useActualizarTipoDocumento';

const MENSAJE_INESPERADO = 'No pudimos guardar los cambios. Probá de nuevo en unos segundos.';

interface EditarTipoDocumentoSheetProps {
  /** Tipo a editar, con los datos del listado. `null` mantiene el panel cerrado. */
  tipo: TipoDocumento | null;
  onClose: () => void;
  /** Se llama con el tipo actualizado. Quien abre el panel decide cómo seguir. */
  onActualizado: (tipo: TipoDocumento) => void;
}

/**
 * Panel lateral de la edición de un tipo de documento, activo o desactivado. Envía solo lo que
 * cambió (ver `cambiosDeTipoDocumento`); sin cambios, el botón queda deshabilitado. Si el envío
 * falla, queda abierto con los datos. Si el tipo ya no existe, lo dice y no deja volver a enviar:
 * solo cerrar. Si sale bien, confirma "Guardado" un instante y recién entonces avisa.
 */
export function EditarTipoDocumentoSheet({
  tipo,
  onClose,
  onActualizado,
}: EditarTipoDocumentoSheetProps) {
  const edicion = useActualizarTipoDocumento();
  const exito = useExitoBreve();
  const [noExiste, setNoExiste] = useState(false);
  // Mientras el panel sale, sigue mostrando el último tipo (y su "Guardado"): quien lo usa pasa
  // `tipo` a null al cerrar, y sin esto el formulario desaparecería durante la salida.
  const [mostrado, setMostrado] = useState(tipo);
  if (tipo !== null && tipo !== mostrado) {
    setMostrado(tipo);
  }
  // Los valores con los que abre el formulario: son la referencia de "qué cambió".
  const valoresIniciales = useMemo(
    () => (mostrado === null ? null : tipoDocumentoAValoresForm(mostrado)),
    [mostrado],
  );

  async function guardar(datos: CreateTipoDocumentoDto): Promise<ErroresDeEnvio | undefined> {
    if (tipo === null) {
      return undefined;
    }
    // Solo lo modificado: reenviar todo pisaría lo que otra persona haya cambiado mientras este
    // panel estaba abierto. Se compara contra el tipo con el que se abrió.
    const cambios = cambiosDeTipoDocumento(datos, tipo);
    if (!hayCambios(cambios)) {
      // El botón ya se deshabilita sin cambios; si igual llega acá, no hay nada que pedir.
      onClose();
      return undefined;
    }
    let actualizado: TipoDocumento;
    try {
      // Resuelve con el cambio hecho y el catálogo ya vuelto a pedir.
      actualizado = await edicion.mutateAsync({ id: tipo.id, datos: cambios });
    } catch (error) {
      const fallo = interpretarFalloEdicionTipoDocumento(error);
      // Reintentar no tiene sentido: no se deja volver a enviar, solo cerrar. El catálogo ya se
      // vuelve a pedir (lo hace el hook ante el 404).
      if (fallo.tipo === 'no-existe') setNoExiste(true);
      return erroresParaElFormulario(fallo, MENSAJE_INESPERADO);
    }
    await exito.mostrar();
    onActualizado(actualizado);
    return undefined;
  }

  return (
    <Sheet
      open={tipo !== null}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrir && (edicion.isPending || exito.activo)) {
          return;
        }
        if (!abrir) {
          onClose();
        }
      }}
      // Recién al terminar de cerrarse: así el botón no vuelve a "Guardar cambios" mientras sale.
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          exito.reiniciar();
          setNoExiste(false);
          setMostrado(null);
        }
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Editar tipo de documento</SheetTitle>
          <SheetDescription>
            Modificá el nombre o la descripción de {mostrado?.nombre} y guardá los cambios.
          </SheetDescription>
        </SheetHeader>
        {mostrado !== null && valoresIniciales !== null && (
          <TipoDocumentoForm
            key={mostrado.id}
            valoresIniciales={valoresIniciales}
            onSubmit={guardar}
            onCancel={onClose}
            textoEnviar="Guardar cambios"
            exito={exito.activo}
            soloConCambios
            envioBloqueado={noExiste}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
