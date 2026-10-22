import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Anchos de las barras de cada fila: solo comunican el patrón de carga (nombre, descripción y
// estado), no son datos.
const filas = [
  { nombre: 'w-[38%]', descripcion: 'w-[22%]' },
  { nombre: 'w-[26%]', descripcion: null },
  { nombre: 'w-[44%]', descripcion: 'w-[30%]' },
  { nombre: 'w-[32%]', descripcion: null },
  { nombre: 'w-[40%]', descripcion: 'w-[18%]' },
];

/**
 * Esqueleto de la carga inicial del catálogo. Es solo presentacional: no decide cuándo se
 * muestra. Igual que en clientes, el aviso para lectores de pantalla va aparte, como región
 * `status`, porque una región en vivo dentro de un contenedor `aria-busy` puede no anunciarse.
 * Las filas sirven tanto para la tabla como para las tarjetas: nombre a la izquierda y estado a
 * la derecha.
 */
export function TiposDocumentoLoadingState() {
  return (
    <>
      <p role="status" className="sr-only">
        Cargando tipos de documento…
      </p>
      <div aria-busy="true" className="overflow-hidden rounded-card border bg-card">
        <div aria-hidden="true">
          <div className="h-10 border-b bg-table-head" />
          {filas.map((fila, indice) => (
            <div
              key={indice}
              className="flex min-h-14 items-center gap-3 border-b border-muted px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn('h-2.5 rounded-full bg-border', fila.nombre)} />
                {fila.descripcion !== null && (
                  <Skeleton className={cn('h-2 rounded-full', fila.descripcion)} />
                )}
              </div>
              <Skeleton className="h-6 w-20 flex-none rounded-pill" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
