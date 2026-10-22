import type { CreateTipoDocumentoDto, TipoDocumento } from '@realpolitik/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { interpretarFalloAltaTipoDocumento } from '@/modules/tipos-documento/api/tipos-documento.api';
import {
  erroresParaElFormulario,
  type ErroresDeEnvio,
} from '@/modules/tipos-documento/components/erroresDeTipoDocumento';
import { TipoDocumentoForm } from '@/modules/tipos-documento/components/TipoDocumentoForm';
import { useCrearTipoDocumento } from '@/modules/tipos-documento/hooks/useCrearTipoDocumento';

const MENSAJE_INESPERADO =
  'No pudimos crear el tipo de documento. Probá de nuevo en unos segundos.';

interface NuevoTipoDocumentoSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se llama con el tipo creado. Quien abre el panel decide cómo seguir (p. ej. cerrarlo). */
  onCreado: (tipo: TipoDocumento) => void;
}

/**
 * Panel lateral del alta de un tipo de documento. Si el envío falla, queda abierto con los datos
 * y el error (un nombre repetido se marca en el campo). Si sale bien, el botón confirma
 * "Guardado" un instante y recién entonces avisa `onCreado`.
 */
export function NuevoTipoDocumentoSheet({
  abierto,
  onAbiertoChange,
  onCreado,
}: NuevoTipoDocumentoSheetProps) {
  const alta = useCrearTipoDocumento();
  const exito = useExitoBreve();

  async function crear(datos: CreateTipoDocumentoDto): Promise<ErroresDeEnvio | undefined> {
    let creado: TipoDocumento;
    try {
      // Solo nombre y descripción: id, estado, fechas y la clave normalizada los fija el servidor.
      // Resuelve con el alta hecha y el catálogo ya vuelto a pedir.
      creado = await alta.mutateAsync({ nombre: datos.nombre, descripcion: datos.descripcion });
    } catch (error) {
      return erroresParaElFormulario(interpretarFalloAltaTipoDocumento(error), MENSAJE_INESPERADO);
    }
    await exito.mostrar();
    onCreado(creado);
    return undefined;
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrir && (alta.isPending || exito.activo)) {
          return;
        }
        onAbiertoChange(abrir);
      }}
      // Recién cuando terminó de cerrarse: así el botón no vuelve a "Crear tipo" mientras sale.
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) exito.reiniciar();
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Nuevo tipo de documento</SheetTitle>
          <SheetDescription>
            Agregá un tipo de documento para utilizarlo en las matrices de requisitos.
          </SheetDescription>
        </SheetHeader>
        <TipoDocumentoForm
          onSubmit={crear}
          onCancel={() => onAbiertoChange(false)}
          textoEnviar="Crear tipo"
          exito={exito.activo}
        />
      </SheetContent>
    </Sheet>
  );
}
