import type { UsuarioCreado } from '@realpolitik/shared';
import { useRef } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  erroresParaElFormulario,
  type ErroresDeEnvio,
} from '@/modules/usuarios/components/erroresDeUsuario';
import { UsuarioForm } from '@/modules/usuarios/components/UsuarioForm';
import type { DatosDeUsuario } from '@/modules/usuarios/components/usuarioForm.validation';
import { useCrearUsuario } from '@/modules/usuarios/hooks/useContrasenaTemporal';

interface NuevoUsuarioSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /**
   * El alta quedó confirmada. Recibe la respuesta con la contraseña temporal: quien abrió el panel
   * lo cierra y la muestra (el panel no la guarda).
   */
  onCreado: (creado: UsuarioCreado) => void;
}

/**
 * Panel lateral del alta de una cuenta. Si el envío falla, queda abierto con los datos y el error
 * (un email repetido se marca en su campo). Si no se pudo confirmar, lo dice sin afirmar que no se
 * creó: el listado se vuelve a pedir, y reenviar el mismo email nunca duplica la cuenta (sería un
 * 409). Sin "Guardado" intermedio: la confirmación es el diálogo con la contraseña.
 */
export function NuevoUsuarioSheet({ abierto, onAbiertoChange, onCreado }: NuevoUsuarioSheetProps) {
  const { crear, creando } = useCrearUsuario();
  // Al cerrarse por un alta, el foco no vuelve a "Nuevo usuario": ya lo tiene el diálogo de la
  // contraseña, que se abre en el mismo momento.
  const cerradoPorAlta = useRef(false);

  async function enviar({
    nombre,
    email,
    rol,
  }: DatosDeUsuario): Promise<ErroresDeEnvio | undefined> {
    const resultado = await crear({ nombre, email, rol });
    if (resultado === null) return undefined;
    if (!resultado.ok) return erroresParaElFormulario(resultado.fallo, 'crear');
    cerradoPorAlta.current = true;
    onCreado(resultado.respuesta);
    return undefined;
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se crea no se cierra: el resultado (o la contraseña) tiene que verse.
        if (!abrir && creando) return;
        onAbiertoChange(abrir);
      }}
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) cerradoPorAlta.current = false;
      }}
    >
      <SheetContent
        finalFocus={() => !cerradoPorAlta.current}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>Nuevo usuario</SheetTitle>
          <SheetDescription>Creá una cuenta y asignale un rol de acceso.</SheetDescription>
        </SheetHeader>
        <UsuarioForm
          onSubmit={enviar}
          onCancel={() => onAbiertoChange(false)}
          textoEnviar="Crear usuario"
          textoEnviando="Creando…"
        />
      </SheetContent>
    </Sheet>
  );
}
