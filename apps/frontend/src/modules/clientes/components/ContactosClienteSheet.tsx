import type { Cliente } from '@realpolitik/shared';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useContactos } from '@/modules/clientes/hooks/useContactos';

interface ContactosClienteSheetProps {
  /** El cliente cuyos contactos se muestran; `null`, cerrado. */
  cliente: Cliente | null;
  onClose: () => void;
}

/**
 * Contactos de un cliente en SOLO LECTURA (HU4.3), para quien puede ver clientes pero no
 * editarlos. Misma lectura que el editor (`GET /clientes/:id/contactos`, `useContactos`), en el
 * orden en que la devuelve la API. Sin formularios: no se agregan, editan ni quitan contactos.
 *
 * Quien puede editar usa `GestionarContactosSheet`, el editor de siempre.
 */
export function ContactosClienteSheet({ cliente, onClose }: ContactosClienteSheetProps) {
  // Mientras el panel sale, sigue mostrando al último cliente (ver `GestionarContactosSheet`).
  const [mostrado, setMostrado] = useState(cliente);
  if (cliente !== null && cliente !== mostrado) {
    setMostrado(cliente);
  }
  const consulta = useContactos(mostrado?.id ?? '');

  return (
    <Sheet
      open={cliente !== null}
      onOpenChange={(abrir) => {
        if (!abrir) onClose();
      }}
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) setMostrado(null);
      }}
    >
      <SheetContent className="flex flex-col data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Contactos de {mostrado?.razonSocial}</SheetTitle>
          <SheetDescription>
            Personas de contacto del cliente, en modo de solo lectura.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
          {consulta.isError ? (
            <Alert>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>No pudimos cargar los contactos.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void consulta.refetch()}
                  disabled={consulta.isFetching}
                >
                  Reintentar
                </Button>
              </div>
            </Alert>
          ) : consulta.isPending ? (
            <div className="flex flex-col gap-3" data-testid="contactos-cargando" aria-busy="true">
              <span className="sr-only">Cargando contactos…</span>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : consulta.data.length === 0 ? (
            <p className="text-sm text-content-secondary">
              Este cliente no tiene contactos registrados.
            </p>
          ) : (
            <ul aria-label="Contactos" className="flex flex-col gap-3">
              {consulta.data.map((contacto) => (
                <li key={contacto.id} className="rounded-card border bg-card p-4">
                  <p className="font-medium break-words">{contacto.nombre}</p>
                  <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-content-secondary">Área</dt>
                    <dd className="break-words">{contacto.area}</dd>
                    <dt className="text-content-secondary">Email</dt>
                    <dd className="break-all">{contacto.email}</dd>
                    <dt className="text-content-secondary">Recibe rendiciones</dt>
                    <dd>{contacto.recibeRendiciones ? 'Sí' : 'No'}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
