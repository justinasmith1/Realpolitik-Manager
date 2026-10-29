import { INDICACIONES_ARMADO_MAX, type ClienteEstadoType } from '@realpolitik/shared';
import { cn } from 'cn';
import { CircleAlertIcon } from 'lucide-react';
import type { Ref } from 'react';

import { Alert } from '@/components/ui/alert';
import { FormSection } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import { AVISO_SIN_CREDENCIALES } from '@/modules/clientes/components/textosFichaCliente';

export interface IndicacionesArmadoSectionProps {
  /** Id del textarea. De él salen los de la ayuda, el contador y el error. */
  id: string;
  valor: string;
  onCambio: (texto: string) => void;
  /** Error a mostrar en el campo (del schema o del servidor), o `null`. */
  error: string | null;
  /** Estado del cliente en una edición. Fuera de `ACTIVO` las indicaciones se leen pero no se editan. */
  estadoCliente?: ClienteEstadoType | undefined;
  /** Las indicaciones guardadas todavía no llegaron: no se edita, para no pisar lo que se escriba. */
  cargando?: boolean;
  /** No se pudieron leer las guardadas: no se edita, para no reemplazarlas sin haberlas visto. */
  errorAlCargar?: boolean;
  /** El cuadro de texto, para que quien abre el formulario pueda llevarle el foco. */
  cuadroRef?: Ref<HTMLTextAreaElement> | undefined;
}

/**
 * Sección "Indicaciones de armado" del formulario del cliente (HU2.4). Solo presenta: el texto,
 * su validación (con `IndicacionesArmadoSchema`) y el envío los maneja `ClienteForm`, que bloquea
 * el guardado si el texto no es válido.
 */
export function IndicacionesArmadoSection({
  id,
  valor,
  onCambio,
  error,
  estadoCliente,
  cargando = false,
  errorAlCargar = false,
  cuadroRef,
}: IndicacionesArmadoSectionProps) {
  const clienteNoActivo = estadoCliente !== undefined && estadoCliente !== 'ACTIVO';
  const soloLectura = clienteNoActivo || cargando || errorAlCargar;
  const cantidad = valor.length;
  const superaLimite = cantidad > INDICACIONES_ARMADO_MAX;
  const descripciones = [`${id}-aviso`, `${id}-ayuda`, `${id}-contador`, error && `${id}-error`]
    .filter(Boolean)
    .join(' ');

  return (
    <FormSection title="Indicaciones de armado">
      <Alert variant="warning" id={`${id}-aviso`}>
        {AVISO_SIN_CREDENCIALES}
      </Alert>

      {clienteNoActivo && (
        <Alert variant="warning">
          El cliente está {etiquetasEstado[estadoCliente]}: reactivalo para editar sus indicaciones
          de armado.
        </Alert>
      )}

      {errorAlCargar && (
        <Alert>
          No pudimos cargar las indicaciones de armado. Cerrá el panel y volvé a abrirlo para
          reintentar.
        </Alert>
      )}

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            Indicaciones de armado
          </label>
          <span
            id={`${id}-contador`}
            data-testid="contador-caracteres"
            className={cn(
              'font-mono text-xs',
              superaLimite ? 'font-semibold text-destructive' : 'text-muted-foreground',
            )}
          >
            {`${cantidad} / ${INDICACIONES_ARMADO_MAX}`}
          </span>
        </div>

        <Textarea
          ref={cuadroRef}
          id={id}
          value={valor}
          onChange={(evento) => onCambio(evento.target.value)}
          placeholder={
            cargando
              ? 'Cargando indicaciones…'
              : 'Escribí aquí cómo exige el cliente armar el legajo (ej. orden de documentos, un solo PDF, duplicados)...'
          }
          rows={5}
          disabled={soloLectura}
          aria-busy={cargando || undefined}
          aria-invalid={error !== null || undefined}
          aria-describedby={descripciones}
          className="resize-y"
        />

        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          Se muestran junto al checklist de cada rendición. Podés usar saltos de línea.
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
