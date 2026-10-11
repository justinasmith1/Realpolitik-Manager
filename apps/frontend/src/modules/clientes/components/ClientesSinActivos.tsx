import { Button } from '@/components/ui/button';

interface ClientesSinActivosProps {
  /** Cuántos clientes inactivos hay: se dice, para que no parezca que se perdieron los datos. */
  cantidadInactivos: number;
  onVerInactivos: () => void;
}

// Vista de activos vacía, pero con clientes inactivos: no es el primer uso. Se aclara que los
// datos están y se ofrece pasar a la vista de inactivos para reactivarlos.
export function ClientesSinActivos({ cantidadInactivos, onVerInactivos }: ClientesSinActivosProps) {
  const texto =
    cantidadInactivos === 1
      ? 'Hay 1 cliente inactivo'
      : `Hay ${cantidadInactivos} clientes inactivos`;
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border bg-card p-6">
      <h2 className="text-base font-semibold">No hay clientes activos</h2>
      <p className="max-w-140 text-sm text-content-secondary">
        {texto}: sus datos se conservan y podés reactivarlos cuando quieras.
      </p>
      <Button variant="outline" onClick={onVerInactivos}>
        Ver clientes inactivos
      </Button>
    </div>
  );
}
