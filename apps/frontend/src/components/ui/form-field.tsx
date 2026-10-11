import { cn } from 'cn';
import { CircleAlertIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { FieldError } from 'react-hook-form';

interface FormFieldProps {
  id: string;
  label: string;
  /** Ayuda breve bajo el control. */
  hint?: string;
  error: FieldError | undefined;
  /** Marca el campo como opcional. Los obligatorios no llevan marca: son la regla. */
  optional?: boolean;
  /** Clases extra del contenedor (p. ej. para ocupar todo el ancho de una grilla). */
  className?: string;
  children: ReactNode;
}

/**
 * Etiqueta, control, ayuda y error de un campo de formulario. Los ids de la ayuda y el error
 * son derivados (`<id>-ayuda`, `<id>-error`): `describirCampo` los conecta con el control.
 */
function FormField({ id, label, hint, error, optional, className, children }: FormFieldProps) {
  return (
    <div data-slot="form-field" className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {optional && <span className="text-xs text-muted-foreground">Opcional</span>}
      </div>
      {children}
      {hint !== undefined && (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error?.message !== undefined && (
        <p
          id={`${id}-error`}
          className="flex items-start gap-1.5 text-[13px] leading-snug text-destructive animate-in duration-150 fade-in-0"
        >
          <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {error.message}
        </p>
      )}
    </div>
  );
}

interface DescribirCampoOptions {
  /** El campo tiene ayuda (`<id>-ayuda`). */
  hint?: boolean | undefined;
  /** Por defecto casi todos los campos son obligatorios. */
  required?: boolean | undefined;
}

/** Atributos que conectan un control con su ayuda y su error, y lo marcan inválido u obligatorio. */
function describirCampo(
  id: string,
  error: FieldError | undefined,
  { hint = false, required = true }: DescribirCampoOptions = {},
) {
  const descripciones = [hint && `${id}-ayuda`, error && `${id}-error`].filter(Boolean);
  return {
    id,
    required,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': descripciones.length > 0 ? descripciones.join(' ') : undefined,
  };
}

interface FormSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

/** Grupo de campos con un encabezado sobrio: título en versalitas y una línea que lo acompaña. */
function FormSection({ title, children, className }: FormSectionProps) {
  const titleId = useId();
  return (
    <section
      role="group"
      aria-labelledby={titleId}
      className={cn('flex min-w-0 flex-col gap-4', className)}
    >
      <h3
        id={titleId}
        className="flex items-center gap-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase after:h-px after:flex-1 after:bg-border"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export { describirCampo, FormField, FormSection };
