import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Anchos de las barras de cada fila: solo comunican el patrón de carga, no son columnas
// definidas. Pocas filas alcanzan para que se lea como lista.
const filas = [
  { nombre: 'w-[62%]', sector: 'w-24', dato: 'w-[80%]' },
  { nombre: 'w-[48%]', sector: 'w-29.5', dato: 'w-[70%]' },
  { nombre: 'w-[70%]', sector: 'w-24', dato: 'w-[85%]' },
  { nombre: 'w-[40%]', sector: 'w-32.5', dato: 'w-[64%]' },
  { nombre: 'w-[58%]', sector: 'w-24', dato: 'w-[78%]' },
];

/**
 * Esqueleto de la futura lista de clientes. Es solo presentacional: no decide cuándo se
 * muestra (ni demora ni timers). El mensaje para lectores de pantalla va aparte, como
 * región `status`, porque una región en vivo dentro de un contenedor `aria-busy` puede
 * no anunciarse.
 */
export function ClientesLoadingState() {
  return (
    <>
      <p role="status" className="sr-only">
        Cargando clientes…
      </p>
      <div aria-busy="true" className="flex flex-col gap-3.5">
        <div aria-hidden="true" className="flex flex-wrap gap-2">
          <Skeleton className="h-8.5 w-60" />
          <Skeleton className="h-8.5 w-27.5 rounded-full" />
        </div>
        <div aria-hidden="true" className="overflow-hidden rounded-card border bg-card">
          <div className="h-10 border-b bg-table-head" />
          {filas.map((fila, indice) => (
            <div
              key={indice}
              className="flex h-12 items-center gap-3 border-b border-muted px-4 last:border-b-0"
            >
              <div className="flex min-w-0 flex-[1.4] items-center gap-2.5">
                <Skeleton className="size-7.5 flex-none" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className={cn('h-2.5 rounded-full bg-border', fila.nombre)} />
                  <Skeleton className="h-2 w-24 rounded-full" />
                </div>
              </div>
              <div className="w-32.5 flex-none lg:w-42.5">
                <Skeleton className={cn('h-5 rounded-full', fila.sector)} />
              </div>
              <div className="hidden w-30 flex-none lg:block">
                <Skeleton className="h-2.5 w-16 rounded-full" />
              </div>
              <div className="hidden min-w-0 flex-[1.4] lg:block">
                <Skeleton className={cn('h-2.5 rounded-full', fila.dato)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
