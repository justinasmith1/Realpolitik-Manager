/**
 * Lleva el foco a un elemento y, si quedó fuera de la vista, lo muestra con un desplazamiento
 * suave (instantáneo si la persona pidió reducir el movimiento). `preventScroll` evita el salto
 * brusco del propio `focus()`; `nearest` no mueve nada si el elemento ya se ve entero.
 */
export function enfocarYMostrar(elemento: HTMLElement | null | undefined): void {
  if (!elemento) {
    return;
  }
  elemento.focus({ preventScroll: true });
  // jsdom no implementa scrollIntoView.
  if (typeof elemento.scrollIntoView === 'function') {
    const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    elemento.scrollIntoView({ block: 'nearest', behavior: reducirMovimiento ? 'auto' : 'smooth' });
  }
}
