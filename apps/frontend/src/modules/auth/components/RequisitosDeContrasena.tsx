import { CONTRASENA_LARGO_MINIMO, contarCaracteresDeContrasena } from '@realpolitik/shared';
import { CheckIcon } from 'lucide-react';

function Requisito({ cumplido, children }: { cumplido: boolean; children: string }) {
  return (
    <li
      className={`flex items-center gap-2 text-[13px] ${cumplido ? 'text-success' : 'text-content-secondary'}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${cumplido ? 'border-success bg-success text-white' : 'border-input bg-card'}`}
      >
        {cumplido && <CheckIcon className="size-2.5" strokeWidth={3.5} />}
      </span>
      {children}
      <span className="sr-only">{cumplido ? ' (cumplido)' : ' (pendiente)'}</span>
    </li>
  );
}

/**
 * Los requisitos de la contraseña nueva, que se van marcando mientras se escribe: el largo mínimo
 * (contado como el servidor) y que sea distinta de la actual. Solo guía: la validación que decide
 * es la del envío (y, al final, la del servidor).
 */
export function RequisitosDeContrasena({
  actual,
  nueva,
  distintaDe,
}: {
  actual: string;
  nueva: string;
  /** Cómo se nombra la actual en el requisito: "la contraseña temporal", "la actual". */
  distintaDe: string;
}) {
  const largoSuficiente = contarCaracteresDeContrasena(nueva) >= CONTRASENA_LARGO_MINIMO;
  const distinta = nueva !== '' && nueva.normalize('NFC') !== actual.normalize('NFC');
  const largo = `Al menos ${CONTRASENA_LARGO_MINIMO} caracteres`;
  return (
    <ul aria-label="Requisitos de la contraseña" className="flex flex-col gap-1">
      <Requisito cumplido={largoSuficiente}>{largo}</Requisito>
      <Requisito cumplido={distinta}>{`Distinta de ${distintaDe}`}</Requisito>
    </ul>
  );
}
