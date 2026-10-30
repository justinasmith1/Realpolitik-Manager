import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface PasosDelAsistenteProps {
  pasos: readonly string[];
  /** 1 a `pasos.length`. */
  actual: number;
}

/**
 * Indicador de pasos de un asistente. Mismo aspecto que el de la carga masiva de requisitos, pero
 * como lista ordenada: el lector de pantalla anuncia "paso 2 de 3" y el actual lleva
 * `aria-current="step"`. Los pasos hechos llevan una tilde y, además, el texto "hecho" oculto: el
 * ícono nunca es el único canal.
 */
export function PasosDelAsistente({ pasos, actual }: PasosDelAsistenteProps) {
  return (
    <ol
      aria-label="Pasos"
      className="flex items-center gap-3 overflow-x-auto pt-3 text-xs font-medium whitespace-nowrap"
    >
      {pasos.map((nombre, indice) => {
        const numero = indice + 1;
        const hecho = numero < actual;
        const esActual = numero === actual;
        return (
          <li
            key={nombre}
            aria-current={esActual ? 'step' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5',
              esActual || hecho ? 'font-semibold text-foreground' : 'text-muted-foreground',
              // El separador entre pasos, sin elementos extra en la lista.
              indice > 0 && 'before:mr-1.5 before:text-muted-foreground before:content-["—"]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[10px]',
                hecho && 'bg-primary text-primary-foreground',
                esActual && 'border-2 border-primary text-primary',
                !hecho && !esActual && 'border border-border',
              )}
            >
              {hecho ? <CheckIcon className="size-3" /> : numero}
            </span>
            {nombre}
            {hecho && <span className="sr-only"> (hecho)</span>}
          </li>
        );
      })}
    </ol>
  );
}
