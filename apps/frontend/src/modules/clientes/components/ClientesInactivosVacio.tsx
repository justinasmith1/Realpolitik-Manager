// Vista de inactivos sin ningún cliente (y sin otros filtros): no es el primer uso, así que no
// se invita a registrar uno. Los filtros siguen a la vista para poder volver a los activos.
export function ClientesInactivosVacio() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border bg-card p-6">
      <h2 className="text-base font-semibold">No hay clientes inactivos</h2>
      <p className="text-sm text-content-secondary">
        Los clientes que desactives aparecerán acá y podrás reactivarlos cuando quieras.
      </p>
    </div>
  );
}
