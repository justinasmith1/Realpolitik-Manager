import '@testing-library/jest-dom/vitest';

// jsdom no define AnimationEvent. Sin él, React escucha `webkitAnimationEnd` en vez de
// `animationend` y `fireEvent.animationEnd` no llega a `onAnimationEnd` (en los navegadores sí).
// Tiene que existir antes de que se cargue react-dom.
if (!('AnimationEvent' in window)) {
  Object.defineProperty(window, 'AnimationEvent', { writable: true, value: Event });
}

// jsdom no implementa matchMedia, que usa useIsMobile (Sidebar). Se simula un
// viewport de escritorio: ninguna media query coincide.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
