import type { UsuarioAdministrado, UsuarioModificado } from '@realpolitik/shared';
import { useMemo, useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { interpretarFalloDeUsuario } from '@/modules/usuarios/api/usuarios.api';
import {
  erroresParaElFormulario,
  type ErroresDeEnvio,
} from '@/modules/usuarios/components/erroresDeUsuario';
import { UsuarioForm } from '@/modules/usuarios/components/UsuarioForm';
import {
  cambiosDeUsuario,
  hayCambios,
  usuarioAValoresForm,
  type DatosDeUsuario,
} from '@/modules/usuarios/components/usuarioForm.validation';
import { useActualizarUsuario } from '@/modules/usuarios/hooks/useActualizarUsuario';

interface EditarUsuarioSheetProps {
  /** La cuenta a editar, con los datos del listado. `null` mantiene el panel cerrado. */
  usuario: UsuarioAdministrado | null;
  /** Es la cuenta de la sesión: se edita el nombre, nunca el rol. */
  propia: boolean;
  onClose: () => void;
  onActualizado: (resultado: UsuarioModificado) => void;
}

/**
 * Panel de la edición de una cuenta: nombre y rol (el email se muestra, no se modifica). Envía solo
 * lo que cambió; sin cambios, el botón queda deshabilitado. Si el envío falla, queda abierto con
 * los datos y el aviso. Si la cuenta ya no existe, no deja volver a enviar. Si sale bien, confirma
 * "Guardado" un instante y recién entonces avisa, como en tipos de documento.
 */
export function EditarUsuarioSheet({
  usuario,
  propia,
  onClose,
  onActualizado,
}: EditarUsuarioSheetProps) {
  const edicion = useActualizarUsuario();
  const exito = useExitoBreve();
  const [noExiste, setNoExiste] = useState(false);
  // Mientras el panel sale, sigue mostrando la última cuenta (quien lo usa pasa `usuario` a null).
  const [mostrado, setMostrado] = useState(usuario);
  const [propiaMostrada, setPropiaMostrada] = useState(propia);
  if (usuario !== null && usuario !== mostrado) {
    setMostrado(usuario);
    setPropiaMostrada(propia);
  }
  const valoresIniciales = useMemo(
    () => (mostrado === null ? null : usuarioAValoresForm(mostrado)),
    [mostrado],
  );

  async function guardar(datos: DatosDeUsuario): Promise<ErroresDeEnvio | undefined> {
    if (usuario === null) return undefined;
    // Solo lo modificado, comparado con la cuenta tal como se abrió. El rol propio nunca viaja.
    const cambios = cambiosDeUsuario(datos, usuario, !propia);
    if (!hayCambios(cambios)) {
      onClose();
      return undefined;
    }
    let resultado: UsuarioModificado;
    try {
      resultado = await edicion.mutateAsync({ id: usuario.id, cambios });
    } catch (error) {
      const fallo = interpretarFalloDeUsuario(error);
      if (fallo.tipo === 'no-existe') setNoExiste(true);
      return erroresParaElFormulario(fallo, 'editar');
    }
    await exito.mostrar();
    onActualizado(resultado);
    return undefined;
  }

  return (
    <Sheet
      open={usuario !== null}
      onOpenChange={(abrir) => {
        if (!abrir && (edicion.isPending || exito.activo)) return;
        if (!abrir) onClose();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          exito.reiniciar();
          edicion.reset();
          setNoExiste(false);
          setMostrado(null);
        }
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{propiaMostrada ? 'Editar tu cuenta' : 'Editar usuario'}</SheetTitle>
          <SheetDescription>
            {propiaMostrada
              ? 'Modificá tu nombre y guardá los cambios.'
              : `Modificá el nombre o el rol de ${mostrado?.nombre ?? ''} y guardá los cambios.`}
          </SheetDescription>
        </SheetHeader>
        {mostrado !== null && valoresIniciales !== null && (
          <UsuarioForm
            key={mostrado.id}
            valoresIniciales={valoresIniciales}
            rolEditable={!propiaMostrada}
            onSubmit={guardar}
            onCancel={onClose}
            textoEnviar="Guardar cambios"
            exito={exito.activo}
            envioBloqueado={noExiste}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
