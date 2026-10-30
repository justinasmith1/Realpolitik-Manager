import { Button } from '@/components/ui/button';
import type { CausaDeFalloDeCarga } from '@/lib/errores-api';

// Qué se le dice a la persona según por qué falló la carga del repositorio.
const textos: Record<CausaDeFalloDeCarga, { etiqueta: string; detalle: string }> = {
  conexion: {
    etiqueta: 'Error de conexión',
    detalle: 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.',
  },
  servidor: {
    etiqueta: 'Error del servidor',
    detalle:
      'El servidor respondió con un error y no pudo entregarnos los archivos. Probá de nuevo en unos segundos.',
  },
  configuracion: {
    etiqueta: 'Error de configuración',
    detalle: 'La aplicación no tiene bien configurada la dirección del servidor.',
  },
  inesperado: {
    etiqueta: 'Error inesperado',
    detalle: 'Algo salió mal al cargar los archivos.',
  },
};

interface ArchivosErrorStateProps {
  causa: CausaDeFalloDeCarga;
  /** Código técnico para soporte (`diagnosticoDeError`). Sin él, no se menciona. */
  diagnostico?: string | undefined;
  onReintentar: () => void;
}

/**
 * Falló la carga del repositorio. Mismo tratamiento visual que el error del catálogo de tipos.
 * Dice que no se pudieron cargar los archivos, nunca que no hay ninguno.
 */
export function ArchivosErrorState({ causa, diagnostico, onReintentar }: ArchivosErrorStateProps) {
  const tieneDiagnostico = diagnostico !== undefined && diagnostico.trim() !== '';
  const { etiqueta, detalle } = textos[causa];
  return (
    <div
      role="alert"
      className="flex min-h-80 flex-col items-center justify-center gap-2.5 rounded-card border bg-card p-8 text-center"
    >
      <span className="inline-flex items-center gap-1.75 rounded-pill border border-destructive-border bg-destructive-soft px-2.75 py-0.75 text-[12.5px] font-medium text-destructive">
        <span aria-hidden="true" className="size-1.75 rounded-full bg-destructive" />
        {etiqueta}
      </span>
      <h2 className="text-[17px] font-semibold">No pudimos cargar los archivos</h2>
      <p className="max-w-115 text-sm leading-normal text-content-secondary">
        {detalle}
        {tieneDiagnostico && ' Si sigue pasando, avisale a soporte con el código de abajo.'}
      </p>
      {tieneDiagnostico && (
        <p className="font-mono text-xs text-content-secondary">{diagnostico}</p>
      )}
      <Button variant="outline" onClick={onReintentar}>
        Reintentar
      </Button>
    </div>
  );
}
