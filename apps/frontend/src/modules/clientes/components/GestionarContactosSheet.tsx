import type { Cliente } from '@realpolitik/shared';
import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
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
  /** Se llama con el cliente cuyos contactos se guardaron. Quien abre el panel decide cómo seguir. */
  onGuardado: (cliente: Cliente) => void;
}

/**
 * Panel de los contactos de un cliente. "Guardar contactos" envía la lista completa con UNA
 * request (`PUT`), que se aplica entera o no se aplica. Si falla, el panel queda abierto y el
 * formulario conserva lo escrito; si sale bien, el botón confirma "Guardado" un instante y
 * recién entonces avisa `onGuardado`.
 */
export function GestionarContactosSheet({
  cliente,
  onClose,
  onGuardado,
}: GestionarContactosSheetProps) {
  const abierto = cliente !== null;
  // Mientras el panel sale, sigue mostrando al último cliente (y su "Guardado"): quien lo usa
  // pasa `cliente` a null al cerrar, y sin esto se vería "Cargando contactos..." durante la salida.
  const [mostrado, setMostrado] = useState(cliente);
  if (cliente !== null && cliente !== mostrado) {
    setMostrado(cliente);
  }
  const consulta = useContactos(mostrado?.id ?? '');
  const guardar = useGuardarContactos();
  const exito = useExitoBreve();

  const handleSave = async (
    contactos: ContactoAGuardar[],
  ): Promise<ErroresDeContactos | undefined> => {
    if (!cliente) return undefined;
    try {
      await guardar.mutateAsync({ clienteId: cliente.id, contactos });
    } catch (error) {
      return erroresDeGuardadoDeContactos(error);
    }
    await exito.mostrar();
    onGuardado(cliente);
    return undefined;
  };

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrir && !guardar.isPending && !exito.activo) onClose();
      }}
      // Recién cuando terminó de cerrarse: así el botón no vuelve a "Guardar contactos" mientras sale.
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) {
          exito.reiniciar();
          setMostrado(null);
        }
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle>Contactos de {mostrado?.razonSocial}</SheetTitle>
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
            key={mostrado?.id}
            contactosIniciales={consulta.data}
            onSave={handleSave}
            onCancel={onClose}
            exito={exito.activo}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
