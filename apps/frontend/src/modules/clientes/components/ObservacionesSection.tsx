import { OBSERVACIONES_CLIENTE_MAX } from '@realpolitik/shared';
import { cn } from 'cn';
import { CircleAlertIcon } from 'lucide-react';
import type { Ref } from 'react';

import { Alert } from '@/components/ui/alert';
import { FormSection } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';

const TEXTOS = {
  titulo: 'Observaciones internas',
  avisoCredenciales: 'No guardes contraseñas ni credenciales acá.',
  ayuda:
    'Bitácora de hechos puntuales de la cuenta (un cambio de mail, una pauta pausada). No reemplaza a las indicaciones de armado.',
  placeholder: 'Anotá acá un hecho puntual de la cuenta…',
  placeholderCargando: 'Cargando observaciones…',
  errorAlCargar:
    'No pudimos cargar las observaciones internas. Cerrá el panel y volvé a abrirlo para reintentar.',
} as const;

export interface ObservacionesSectionProps {
  /** Id del cuadro de texto. De él salen los de la ayuda, el aviso, el contador y el error. */
  id: string;
  valor: string;
  onCambio: (texto: string) => void;
  /** Error a mostrar en el campo (del schema o del servidor), o `null`. */
  error: string | null;
  /** Las observaciones guardadas todavía no llegaron: no se edita, para no pisar lo que se escriba. */
  cargando?: boolean;
  /** No se pudieron leer las guardadas: no se edita, para no reemplazarlas sin haberlas visto. */
  errorAlCargar?: boolean;
  /** El cuadro de texto, para que quien abre el formulario pueda llevarle el foco. */
  cuadroRef?: Ref<HTMLTextAreaElement> | undefined;
}

/**
 * Sección "Observaciones internas" del formulario del cliente (HU2.10). Solo presenta: el texto,
 * su validación (con `ObservacionesClienteSchema`) y el envío los maneja `ClienteForm`.
 *
 * A diferencia de las indicaciones de armado, no depende del estado del cliente: se edita con el
 * cliente activo, inactivo o suspendido.
 */
export function ObservacionesSection({
  id,
  valor,
  onCambio,
  error,
  cargando = false,
  errorAlCargar = false,
  cuadroRef,
}: ObservacionesSectionProps) {
  const soloLectura = cargando || errorAlCargar;
  const cantidad = valor.length;
  const superaLimite = cantidad > OBSERVACIONES_CLIENTE_MAX;
  const descripciones = [`${id}-aviso`, `${id}-ayuda`, `${id}-contador`, error && `${id}-error`]
    .filter(Boolean)
    .join(' ');

  return (
    <FormSection title={TEXTOS.titulo}>
      <Alert variant="warning" id={`${id}-aviso`}>
        {TEXTOS.avisoCredenciales}
      </Alert>

      {errorAlCargar && <Alert>{TEXTOS.errorAlCargar}</Alert>}

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {TEXTOS.titulo}
          </label>
          <span
            id={`${id}-contador`}
            data-testid="contador-observaciones"
            className={cn(
              'font-mono text-xs',
              superaLimite ? 'font-semibold text-destructive' : 'text-muted-foreground',
            )}
          >
            {`${cantidad} / ${OBSERVACIONES_CLIENTE_MAX}`}
          </span>
        </div>

        <Textarea
          ref={cuadroRef}
          id={id}
          value={valor}
          onChange={(evento) => onCambio(evento.target.value)}
          placeholder={cargando ? TEXTOS.placeholderCargando : TEXTOS.placeholder}
          rows={4}
          disabled={soloLectura}
          aria-busy={cargando || undefined}
          aria-invalid={error !== null || undefined}
          aria-describedby={descripciones}
          className="resize-y"
        />

        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {TEXTOS.ayuda}
        </p>

        {error !== null && (
          <p
            id={`${id}-error`}
            className="flex items-start gap-1.5 text-[13px] leading-snug text-destructive animate-in duration-150 fade-in-0"
          >
            <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>
    </FormSection>
  );
}
