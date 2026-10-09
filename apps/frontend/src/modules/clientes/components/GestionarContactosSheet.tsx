import type { Cliente, CreateContactoDto } from '@realpolitik/shared';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/http';

import {
  useActualizarContacto,
  useContactos,
  useCrearContacto,
  useEliminarContacto,
} from '../hooks/useContactos';

import { ContactosForm } from './ContactosForm';

interface GestionarContactosSheetProps {
  cliente: Cliente | null;
  onClose: () => void;
}

export function GestionarContactosSheet({ cliente, onClose }: GestionarContactosSheetProps) {
  const abierto = cliente !== null;
  const consulta = useContactos(cliente?.id ?? '');

  const crear = useCrearContacto();
  const actualizar = useActualizarContacto();
  const eliminar = useEliminarContacto();

  const handleSave = async (
    nuevos: (CreateContactoDto & { _id?: string })[],
    borradosIds: string[],
  ) => {
    if (!cliente) return;

    try {
      // 1. Eliminar los borrados
      for (const id of borradosIds) {
        await eliminar.mutateAsync({ clienteId: cliente.id, contactoId: id });
      }

      // 2. Crear y actualizar
      for (const c of nuevos) {
        if (c._id) {
          // Si tiene _id y es un string que no está en borrados, se actualiza
          // Solo llamamos actualizar si hubo cambios reales (opcional) pero por simplicidad se manda
          await actualizar.mutateAsync({
            clienteId: cliente.id,
            contactoId: c._id,
            datos: c,
          });
        } else {
          // Es nuevo
          await crear.mutateAsync({ clienteId: cliente.id, datos: c });
        }
      }

      onClose();
      return undefined;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        return 'Ya existe un contacto con ese email en este cliente.';
      }
      return 'Ocurrió un error al guardar los contactos.';
    }
  };

  return (
    <Sheet open={abierto} onOpenChange={(open) => !open && onClose()}>
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
          <div className="p-4 text-sm text-destructive">Error al cargar contactos</div>
        ) : (
          <ContactosForm
            key={`${cliente?.id}-${consulta.dataUpdatedAt}`}
            contactosIniciales={consulta.data}
            onSave={handleSave}
            onCancel={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
