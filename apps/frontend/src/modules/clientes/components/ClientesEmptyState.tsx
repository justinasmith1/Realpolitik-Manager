// Primer uso, sin ningún cliente. Sin acciones todavía: "Nuevo cliente" llega con HU1.1.
export function ClientesEmptyState() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-card border bg-card p-6 sm:px-12 sm:py-11">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Todavía no cargaste clientes</h2>
      <p className="max-w-140 text-[14.5px] leading-[1.55] text-content-secondary">
        Los clientes que cargues aparecerán acá para que puedas consultar y organizar su
        información.
      </p>
    </div>
  );
}
