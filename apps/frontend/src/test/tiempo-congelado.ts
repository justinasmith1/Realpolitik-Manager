import { act } from '@testing-library/react';

/**
 * Temporizadores falsos para medir la pausa de éxito (`useExitoBreve`), activados a mitad del
 * test: el formulario se completa con los reales y recién antes de enviar se congela el tiempo.
 * Solo `setTimeout`: lo demás (intervalos, el scheduler de React) sigue real.
 *
 * Con `setTimeout` falso, `user.*` y `findBy*` de Testing Library se cuelgan: su envoltura espera
 * un `setTimeout(0)` que solo avanza sola con los temporizadores de Jest. Mientras dure, usar
 * `fireEvent` y `esperar`.
 */
export const congelarTiempo = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

/** Adelanta el reloj falso `ms` milisegundos y deja que React pinte lo que haya cambiado. */
export const avanzar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/**
 * Reintenta la afirmación hasta que pase. `vi.waitFor` adelanta el reloj falso en cada intento:
 * con intervalo de 1 ms, lo que adelanta es despreciable frente a los 500 ms de la pausa.
 *
 * Como el `waitFor` de Testing Library, mientras espera apaga el entorno de `act` de React: lo
 * que llega solo (la respuesta del servidor, el fin de la validación) no es un update suelto.
 */
export async function esperar<T>(afirmacion: () => T): Promise<T> {
  const entorno = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
  const antes = entorno.IS_REACT_ACT_ENVIRONMENT;
  entorno.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    return await vi.waitFor(afirmacion, { interval: 1 });
  } finally {
    entorno.IS_REACT_ACT_ENVIRONMENT = antes;
  }
}
