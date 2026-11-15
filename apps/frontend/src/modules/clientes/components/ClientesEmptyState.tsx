import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ClientesEmptyStateProps {
  /** Abre el alta. Sin esto (quien no puede cargar clientes), el aviso es neutro y sin botón. */
  onNuevoCliente?: (() => void) | undefined;
}

// Primer uso, sin ningún cliente. A quien puede cargarlos lo invita a registrar el primero (la
// acción principal tiene el mismo estilo que "Nuevo cliente" del encabezado); a quien solo
// consulta le dice que no hay nada, sin invitarlo a algo que no puede hacer.
export function ClientesEmptyState({ onNuevoCliente }: ClientesEmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border bg-card p-6 sm:px-12 sm:py-11">
      {onNuevoCliente === undefined ? (
        <>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">
            Todavía no hay clientes cargados.
          </h2>
          <p className="max-w-140 text-[14.5px] leading-[1.55] text-content-secondary">
            Cuando se carguen, vas a poder consultar su información acá.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">Todavía no cargaste clientes</h2>
          <p className="max-w-140 text-[14.5px] leading-[1.55] text-content-secondary">
            Los clientes que cargues aparecerán acá para que puedas consultar y organizar su
            información.
          </p>
          <Button variant="brand" onClick={onNuevoCliente}>
            <PlusIcon aria-hidden="true" />
            Registrar el primer cliente
          </Button>
        </>
      )}
    </div>
  );
}
