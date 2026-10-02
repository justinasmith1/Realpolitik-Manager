import '@testing-library/jest-dom/vitest';

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
