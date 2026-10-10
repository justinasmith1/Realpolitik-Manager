import type { Cliente } from '@realpolitik/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ContactoAGuardar } from '@/modules/clientes/api/contactos.api';
import { ContactosForm } from '@/modules/clientes/components/ContactosForm';
import {
  erroresDeGuardadoDeContactos,
  type ErroresDeContactos,
} from '@/modules/clientes/components/erroresDeContactos';
import { useContactos, useGuardarContactos } from '@/modules/clientes/hooks/useContactos';

interface GestionarContactosSheetProps {
  cliente: Cliente | null;
  onClose: () => void;
}

/**
 * Panel de los contactos de un cliente. "Guardar contactos" envía la lista completa con UNA
 * request (`PUT`), que se aplica entera o no se aplica. Si falla, el panel queda abierto y el
 * formulario conserva lo escrito; si sale bien, se cierra.
 */
export function GestionarContactosSheet({ cliente, onClose }: GestionarContactosSheetProps) {
  const abierto = cliente !== null;
  const consulta = useContactos(cliente?.id ?? '');
  const guardar = useGuardarContactos();

  const handleSave = async (
    contactos: ContactoAGuardar[],
  ): Promise<ErroresDeContactos | undefined> => {
    if (!cliente) return undefined;
    try {
      await guardar.mutateAsync({ clienteId: cliente.id, contactos });
      onClose();
      return undefined;
    } catch (error) {
      return erroresDeGuardadoDeContactos(error);
    }
  };

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se guarda no se cierra: el resultado del envío tiene que verse.
        if (!abrir && !guardar.isPending) onClose();
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-md flex flex-col">
        <SheetHeader className="pr-12">
          <SheetTitle>Contactos de {cliente?.razonSocial}</SheetTitle>
          <SheetDescription>
            Administrá los contactos para el envío de notificaciones.
          </SheetDescription>
        </SheetHeader>

        {consulta.isPending ? (
          <div className="p-4 text-sm">Cargando contactos...</div>
        ) : consulta.isError ? (
          <div role="alert" className="p-4 text-sm text-destructive">
            Error al cargar contactos
          </div>
        ) : (
          // El formulario se monta una vez por cliente. Que la query se vuelva a pedir NO lo
          // reinicia: lo escrito sin guardar no se pierde.
          <ContactosForm
            key={cliente?.id}
            contactosIniciales={consulta.data}
            onSave={handleSave}
            onCancel={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
