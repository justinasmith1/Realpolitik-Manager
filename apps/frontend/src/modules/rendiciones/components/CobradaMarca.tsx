import { cn } from 'cn';
import { BadgeCheckIcon } from 'lucide-react';

interface CobradaMarcaProps {
  /** El texto ya armado: "Cobrada el 10/11/2026" o "Cobrada · 10/11/2026". */
  texto: string;
  className?: string;
}

/**
 * La marca "Cobrada" (HU3.10): el cliente informó el pago. Es una marca de la rendición, no un
 * estado, así que no usa los colores de los estados. Tokens `success-*`, con ícono y texto: el color
 * nunca es el único canal. El mismo chip que "Checklist completo".
 */
export function CobradaMarca({ texto, className }: CobradaMarcaProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border border-success-border bg-success-soft px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-success',
        className,
      )}
    >
      <BadgeCheckIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {texto}
    </span>
  );
}
