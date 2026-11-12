import { useState, type ComponentProps, type Ref } from 'react';

import { Input } from '@/components/ui/input';

type CampoContrasenaProps = Omit<ComponentProps<'input'>, 'type'> & {
  /** Cómo se llama el campo, para el botón: "Mostrar contraseña", "Mostrar nueva contraseña"… */
  nombre: string;
  ref?: Ref<HTMLInputElement>;
};

/**
 * Campo de contraseña con botón para mostrarla u ocultarla. El botón es un conmutador
 * (`aria-pressed`) con nombre propio, alcanzable con teclado. El valor nunca se guarda fuera del
 * estado del formulario ni se escribe en la consola.
 */
export function CampoContrasena({ nombre, id, className, ...props }: CampoContrasenaProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className={`h-11 pr-21 md:h-11 ${className ?? ''}`}
        {...props}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-controls={id}
        aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${nombre}`}
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1 right-1 h-9 rounded-md px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none"
      >
        {visible ? 'Ocultar' : 'Mostrar'}
      </button>
    </div>
  );
}
