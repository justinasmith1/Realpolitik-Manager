import { Button } from '@/components/ui/button';

interface TiposDocumentoSinActivosProps {
  /**
   * Cuántos tipos desactivados hay. `null` si no se pudo comprobar (falló esa consulta): no se
   * afirma que el catálogo esté vacío, y "Ver desactivados" deja salir de la duda.
   */
  cantidadDesactivados: number | null;
  onVerDesactivados: () => void;
}

function textoDe(cantidad: number | null): string {
  if (cantidad === null) {
    return 'No pudimos comprobar si hay tipos desactivados. Podés revisarlos con el filtro.';
  }
  const hay = cantidad === 1 ? 'Hay 1 tipo desactivado' : `Hay ${cantidad} tipos desactivados`;
  return `${hay}: se conservan y se pueden consultar con el filtro.`;
}

// Vista por defecto (solo activos) vacía, pero el catálogo no lo está (o no se pudo saber). Como
// en clientes, se dice que los datos están y se ofrece pasar a la vista con desactivados.
export function TiposDocumentoSinActivos({
  cantidadDesactivados,
  onVerDesactivados,
}: TiposDocumentoSinActivosProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border bg-card p-6">
      <h2 className="text-base font-semibold">No hay tipos activos</h2>
      <p className="max-w-140 text-sm text-content-secondary">{textoDe(cantidadDesactivados)}</p>
      <Button variant="outline" onClick={onVerDesactivados}>
        Ver desactivados
      </Button>
    </div>
  );
}
