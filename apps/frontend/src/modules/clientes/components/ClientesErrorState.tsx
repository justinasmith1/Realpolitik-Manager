import { Button } from '@/components/ui/button';
import type { CausaDeFalloDeCarga } from '@/modules/clientes/api/clientes.api';

// Qué se le dice a la persona según por qué falló la carga.
const textos: Record<CausaDeFalloDeCarga, { etiqueta: string; detalle: string }> = {
  conexion: {
    etiqueta: 'Error de conexión',
    detalle:
      'No pudimos conectarnos con el servidor. Revisá tu conexión: tus datos no se perdieron.',
  },
  servidor: {
    etiqueta: 'Error del servidor',
    detalle:
      'El servidor respondió con un error y no pudo entregarnos los clientes. Tus datos no se perdieron: probá de nuevo en unos segundos.',
  },
  configuracion: {
    etiqueta: 'Error de configuración',
    detalle: 'La aplicación no tiene bien configurada la dirección del servidor.',
  },
  inesperado: {
    etiqueta: 'Error inesperado',
    detalle: 'Algo salió mal al cargar los clientes. Tus datos no se perdieron.',
  },
};

interface ClientesErrorStateProps {
  /** Por qué falló la carga. Sin él, se asume un problema de conexión. */
  causa?: CausaDeFalloDeCarga | undefined;
  /**
   * Código técnico para soporte, en tipografía mono (p. ej. un código de error o una
   * referencia). Sin stack traces, URLs ni datos personales. Sin él, no se menciona.
   */
  diagnostico?: string | undefined;
  /** Si se pasa, se ofrece "Reintentar". */
  onReintentar?: (() => void) | undefined;
}

// Falla la carga de la lista.
export function ClientesErrorState({
  causa = 'conexion',
  diagnostico,
  onReintentar,
}: ClientesErrorStateProps) {
  const tieneDiagnostico = diagnostico !== undefined && diagnostico.trim() !== '';
  const { etiqueta, detalle } = textos[causa];

  return (
    <div
      role="alert"
      className="flex min-h-95 flex-col items-center justify-center gap-2.5 rounded-card border bg-card p-8 text-center"
    >
      <span className="inline-flex items-center gap-1.75 rounded-pill border border-destructive-border bg-destructive-soft px-2.75 py-0.75 text-[12.5px] font-medium text-destructive">
        <span aria-hidden="true" className="size-1.75 rounded-full bg-destructive" />
        {etiqueta}
      </span>
      <h2 className="text-[17px] font-semibold">No pudimos cargar los clientes</h2>
      <p className="max-w-115 text-sm leading-normal text-content-secondary">
        {detalle}
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
