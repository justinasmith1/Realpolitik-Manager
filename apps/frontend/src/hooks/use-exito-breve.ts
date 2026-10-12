import { useCallback, useEffect, useRef, useState } from 'react';

/** Cuánto se muestra la confirmación de éxito antes de seguir (p. ej. cerrar el panel). */
export const DURACION_EXITO_MS = 500;

/**
 * Éxito breve de una operación: `mostrar()` activa el estado y resuelve a los
 * `DURACION_EXITO_MS`, para seguir recién entonces. Los datos ya están guardados: esto es solo
 * presentación.
 *
 * - `activo` NO se apaga solo al resolver: quien lo usa llama a `reiniciar()` cuando ya no se
 *   ve (p. ej. al terminar de cerrarse el panel), así el botón no vuelve a su texto inicial
 *   mientras sale.
 * - Llamar a `mostrar()` con una espera en curso devuelve esa misma promesa: no se superponen
 *   temporizadores ni queda nadie esperando para siempre.
 * - `reiniciar()` y el desmontaje cancelan la espera: esa promesa ya no resuelve, porque lo que
 *   venía después (cerrar un panel que ya no está) no tiene sentido.
 */
export function useExitoBreve() {
  const [activo, setActivo] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const espera = useRef<Promise<void> | null>(null);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  const mostrar = useCallback(() => {
    setActivo(true);
    espera.current ??= new Promise<void>((resolver) => {
      temporizador.current = setTimeout(() => {
        espera.current = null;
        resolver();
      }, DURACION_EXITO_MS);
    });
    return espera.current;
  }, []);

  const reiniciar = useCallback(() => {
    clearTimeout(temporizador.current);
    espera.current = null;
    setActivo(false);
  }, []);

  return { activo, mostrar, reiniciar };
}
