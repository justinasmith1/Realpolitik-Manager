import {
  INDICACIONES_ARMADO_MAX,
  IndicacionesArmadoSchema,
  type Cliente,
} from '@realpolitik/shared';
import { QueryClientContext } from '@tanstack/react-query';
import { cn } from 'cn';
import { CircleAlertIcon } from 'lucide-react';
import { useContext, useEffect, useId, useRef } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { FormSection } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { useIndicacionesArmado } from '@/modules/clientes/hooks/useIndicacionesArmado';

export interface IndicacionesArmadoFormValues {
  indicacionesArmado: string;
}

export interface IndicacionesArmadoSectionProps {
  /** Cliente del que se configuran las indicaciones. Si no se pasa o no tiene id, actúa en modo creación. */
  cliente?: Pick<Cliente, 'id' | 'estado' | 'razonSocial'> | null | undefined;
  /** Valor inicial alternativo (útil en formularios locales o previews). */
  valorInicial?: string | null | undefined;
  /** Notifica al componente padre cuando cambia el texto y si difiere del valor base. */
  onCambio?: ((valor: string, modificado: boolean) => void) | undefined;
  className?: string;
}

/**
 * Resolver que delega en IndicacionesArmadoSchema de `@realpolitik/shared`.
 */
const resolver: Resolver<IndicacionesArmadoFormValues> = (values) => {
  const texto = values.indicacionesArmado;
  const parseado = IndicacionesArmadoSchema.safeParse({
    indicacionesArmado: texto === '' ? null : texto,
  });

  if (!parseado.success) {
    const errorIssue = parseado.error.issues[0];
    return {
      values: {},
      errors: {
        indicacionesArmado: {
          type: 'validate',
          message: errorIssue?.message ?? 'Las indicaciones no son válidas.',
        },
      },
    };
  }

  return {
    values: {
      indicacionesArmado: values.indicacionesArmado,
    },
    errors: {},
  };
};

interface PresentacionProps extends IndicacionesArmadoSectionProps {
  textoCargado?: string | null | undefined;
}

function IndicacionesArmadoPresentacion({
  cliente,
  valorInicial,
  textoCargado,
  onCambio,
  className,
}: PresentacionProps) {
  const textareaId = useId();
  const esInactivo = cliente !== null && cliente !== undefined && cliente.estado !== 'ACTIVO';
  const textoBase = textoCargado ?? valorInicial ?? '';
  const onCambioRef = useRef(onCambio);

  useEffect(() => {
    onCambioRef.current = onCambio;
  }, [onCambio]);

  const {
    register,
    reset,
    control,
    formState: { errors },
  } = useForm<IndicacionesArmadoFormValues>({
    resolver,
    defaultValues: {
      indicacionesArmado: valorInicial ?? '',
    },
  });

  // Si llegan datos del backend o cambian los valores iniciales, inicializamos
  useEffect(() => {
    if (textoCargado !== undefined) {
      reset({ indicacionesArmado: textoCargado ?? '' });
    }
  }, [textoCargado, reset]);

  const textoActual = useWatch({ control, name: 'indicacionesArmado' }) ?? '';
  const cantidadCaracteres = textoActual.length;
  const superaLimite = cantidadCaracteres > INDICACIONES_ARMADO_MAX;
  const modificado = textoActual !== textoBase;

  useEffect(() => {
    onCambioRef.current?.(textoActual, modificado);
  }, [textoActual, modificado]);

  return (
    <FormSection title="Indicaciones de armado" className={cn('relative', className)}>
      {/* Advertencia de Seguridad */}
      <Alert variant="warning" className="text-xs sm:text-sm">
        <div>
          <p className="font-semibold text-foreground">
            Atención: No utilices este campo para guardar contraseñas de portales gubernamentales.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Se muestran al lado del checklist de cada rendición. No guardes contraseñas ni
            credenciales de portales en este campo.
          </p>
        </div>
      </Alert>

      {/* Alerta de Cliente Inactivo o Suspendido */}
      {esInactivo && (
        <Alert
          variant="warning"
          className="border-amber-500/30 bg-amber-50/50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <p className="text-xs sm:text-sm font-medium">
            El cliente está {cliente?.estado.toLowerCase()}. Debe reactivarse para editar sus
            indicaciones de armado.
          </p>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <label htmlFor={textareaId} className="font-medium text-foreground">
            Instrucciones para el legajo
          </label>
          <span
            data-testid="contador-caracteres"
            className={cn(
              'font-mono transition-colors',
              superaLimite ? 'text-destructive font-semibold' : 'text-muted-foreground',
            )}
          >
            {`${cantidadCaracteres} / ${INDICACIONES_ARMADO_MAX}`}
          </span>
        </div>

        <Textarea
          id={textareaId}
          placeholder="Escribí aquí cómo exige el cliente armar el legajo (ej. orden de documentos, un solo PDF, duplicados)..."
          rows={5}
          disabled={esInactivo}
          aria-invalid={Boolean(errors.indicacionesArmado) || superaLimite}
          aria-describedby={`${textareaId}-contador ${textareaId}-ayuda`}
          {...register('indicacionesArmado')}
          className="resize-y"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {/* Mensaje de error de validación o ayuda */}
          {errors.indicacionesArmado?.message ? (
            <p
              role="alert"
              className="flex items-center gap-1.5 text-xs text-destructive animate-in fade-in-0"
            >
              <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {errors.indicacionesArmado.message}
            </p>
          ) : (
            <p id={`${textareaId}-ayuda`} className="text-xs text-muted-foreground">
              Se muestran al lado del checklist de cada rendición. No guardes contraseñas ni
              credenciales de portales en este campo.
            </p>
          )}

          {/* Feedback visual dinámico debajo del textarea */}
          <div className="ml-auto text-xs font-mono text-muted-foreground">
            <span className={cn(superaLimite && 'text-destructive font-bold')}>
              {`${cantidadCaracteres} / ${INDICACIONES_ARMADO_MAX}`}
            </span>
          </div>
        </div>
      </div>
    </FormSection>
  );
}

function IndicacionesArmadoConQuery({
  clienteId,
  ...props
}: IndicacionesArmadoSectionProps & { clienteId: string }) {
  const consulta = useIndicacionesArmado(clienteId, {
    enabled: Boolean(clienteId),
  });

  return (
    <IndicacionesArmadoPresentacion {...props} textoCargado={consulta.data?.indicacionesArmado} />
  );
}

/**
 * Sección de "Indicaciones de Armado" dentro de la ficha del cliente (HU2.4).
 *
 * Incluye:
 * - Textarea ancho completo para texto libre (hasta 1000 caracteres, admite saltos de línea).
 * - Advertencia de seguridad destacada para no guardar contraseñas de portales gubernamentales.
 * - Contador dinámico de caracteres (ej. "145 / 1000").
 * - Bloqueo de edición si el cliente está INACTIVO o SUSPENDIDO.
 * - Su guardado se realiza junto con el formulario principal de creación o edición.
 */
export function IndicacionesArmadoSection(props: IndicacionesArmadoSectionProps) {
  const queryClient = useContext(QueryClientContext);

  if (queryClient && props.cliente?.id) {
    return <IndicacionesArmadoConQuery {...props} clienteId={props.cliente.id} />;
  }

  return <IndicacionesArmadoPresentacion {...props} />;
}
