'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { cn } from 'cn';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type * as React from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Pick<
  React.ComponentProps<'button'>,
  'aria-describedby' | 'aria-label' | 'onBlur'
> {
  /** Lo recibe el `<label htmlFor>` del campo: el disparador es un botón etiquetable. */
  id?: string;
  /**
   * Valor elegido. El texto vacío ('') es "sin elección": muestra el `placeholder`, salvo que
   * exista una opción con valor '' (p. ej. "Todos"), que entonces se muestra como cualquier otra.
   */
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  /** Marca el campo como inválido (borde y `aria-invalid`). */
  invalid?: boolean | undefined;
  /** Ref al disparador, para que un formulario pueda llevar el foco al campo con error. */
  triggerRef?: React.Ref<HTMLButtonElement> | undefined;
  className?: string | undefined;
}

/**
 * Select sobre Base UI: teclado (flechas, Home/End, Enter/Espacio, Escape, búsqueda por
 * letras) y lectores de pantalla ya vienen resueltos por la primitiva. Acá solo se le da la
 * apariencia de `Input` y una API simple (`value` de texto + `options`) que encaja con
 * react-hook-form a través de `Controller`.
 */
function Select({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  required,
  invalid,
  triggerRef,
  className,
  onBlur,
  ...aria
}: SelectProps) {
  // Base UI representa "sin valor" con `null` (y una opción `null` con etiqueta propia reemplaza
  // al placeholder); el resto del código usa '' para eso.
  const items = options.map((opcion) => ({ ...opcion, value: aValorInterno(opcion.value) }));

  return (
    <SelectPrimitive.Root
      id={id}
      items={items}
      value={aValorInterno(value)}
      onValueChange={(nuevo) => onValueChange(nuevo ?? '')}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger
        ref={triggerRef}
        invalid={invalid}
        required={required}
        onBlur={onBlur}
        className={className}
        {...aria}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          // Gris solo si hay placeholder: una opción "Todos"/"Sin configurar" es un valor real.
          className={cn(
            'truncate',
            placeholder !== undefined && 'data-placeholder:text-muted-foreground',
          )}
        />
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground transition-transform duration-150 ease-standard group-data-popup-open/select-trigger:rotate-180">
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </SelectPrimitive.Icon>
      </SelectTrigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          sideOffset={4}
          // El popup debajo del campo, como un menú: sin la superposición "tipo nativo".
          alignItemWithTrigger={false}
          className="isolate z-50 outline-none"
        >
          <SelectPrimitive.Popup
            data-slot="select-content"
            className="max-h-(--available-height) min-w-[max(var(--anchor-width),10rem)] origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none transition-[opacity,scale] duration-150 ease-standard data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            <SelectPrimitive.List>
              {items.map((opcion) => (
                <SelectItem key={opcion.value ?? ''} {...opcion} />
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function SelectTrigger({
  className,
  invalid,
  required,
  ...props
}: SelectPrimitive.Trigger.Props & {
  invalid?: boolean | undefined;
  required?: boolean | undefined;
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      aria-invalid={invalid ? true : undefined}
      aria-required={required ? true : undefined}
      className={cn(
        'group/select-trigger flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-input bg-card pr-3.5 pl-3 text-left text-base whitespace-nowrap shadow-xs transition-colors outline-none select-none md:h-9 md:text-sm',
        // Hover perceptible (borde más oscuro), como el de Input: los dos se leen como un mismo sistema.
        'hover:not-data-disabled:bg-panel-alt hover:not-data-disabled:not-aria-invalid:border-content-secondary',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 data-popup-open:border-ring data-popup-open:bg-card data-popup-open:ring-3 data-popup-open:ring-ring/25',
        'data-disabled:cursor-not-allowed data-disabled:bg-muted data-disabled:opacity-60',
        'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

const aValorInterno = (valor: string) => (valor === '' ? null : valor);

function SelectItem({
  value,
  label,
  disabled,
}: Omit<SelectOption, 'value'> & { value: string | null }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      value={value}
      label={label}
      disabled={disabled}
      className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-2 py-2.5 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:font-medium md:py-2 md:text-sm"
    >
      {/* La marca de "elegido" no depende solo del color: lleva un tilde y mayor peso. */}
      <SelectPrimitive.ItemIndicator className="col-start-1 flex items-center justify-center">
        <CheckIcon aria-hidden="true" className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText className="col-start-2 truncate">{label}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select };
