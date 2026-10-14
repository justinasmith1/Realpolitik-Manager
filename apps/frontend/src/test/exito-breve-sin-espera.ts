import type * as ExitoBreve from '@/hooks/use-exito-breve';

/**
 * Reemplazo de `@/hooks/use-exito-breve` para los tests cuyo tema NO es la pausa de éxito: el
 * estado se activa igual (el botón dice "Guardado", el panel no se deja cerrar), pero `mostrar()`
 * no espera los 500 ms reales. La pausa en sí se prueba con el hook real y temporizadores falsos
 * (`*.exito.test.tsx`).
 *
 * Uso: `vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));`
 */
const real = await vi.importActual<typeof ExitoBreve>('@/hooks/use-exito-breve');

export const DURACION_EXITO_MS = real.DURACION_EXITO_MS;

export function useExitoBreve(): ReturnType<typeof ExitoBreve.useExitoBreve> {
  const exito = real.useExitoBreve();
  return {
    ...exito,
    mostrar: () => {
      void exito.mostrar();
      return Promise.resolve();
    },
  };
}
