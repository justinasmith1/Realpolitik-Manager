import { Button } from '@/components/ui/button';

interface ClientesErrorStateProps {
  /**
   * Código técnico para soporte, en tipografía mono (p. ej. un código de error o una
   * referencia). Sin stack traces, URLs ni datos personales. Sin él, no se menciona.
   */
  diagnostico?: string | undefined;
  /** Si se pasa, se ofrece "Reintentar". */
  onReintentar?: (() => void) | undefined;
}

// Falla la carga de la lista.
export function ClientesErrorState({ diagnostico, onReintentar }: ClientesErrorStateProps) {
  const tieneDiagnostico = diagnostico !== undefined && diagnostico.trim() !== '';

  return (
    <div
      role="alert"
      className="flex min-h-95 flex-col items-center justify-center gap-2.5 rounded-card border bg-card p-8 text-center"
    >
      <span className="inline-flex items-center gap-1.75 rounded-pill border border-destructive-border bg-destructive-soft px-2.75 py-0.75 text-[12.5px] font-medium text-destructive">
        <span aria-hidden="true" className="size-1.75 rounded-full bg-destructive" />
        Error de conexión
      </span>
      <h2 className="text-[17px] font-semibold">No pudimos cargar los clientes</h2>
      <p className="max-w-115 text-sm leading-normal text-content-secondary">
        El servidor no respondió. Tus datos no se perdieron: probá de nuevo en unos segundos.
        {tieneDiagnostico && ' Si sigue pasando, avisale a soporte con el código de abajo.'}
      </p>
      {tieneDiagnostico && (
        <p className="font-mono text-xs text-content-secondary">{diagnostico}</p>
      )}
      {onReintentar && (
        <Button variant="outline" onClick={onReintentar}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
