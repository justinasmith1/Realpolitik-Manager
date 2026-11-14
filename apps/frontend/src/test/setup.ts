import '@testing-library/jest-dom/vitest';

// Guarda el `fetch` real antes de bloquearlo (abajo): tiene que importarse primero.
import './fetchDeRed';

// Ningún test sale a la red. Si un test no simula `fetch`, cualquier pedido falla con la URL que
// intentó pedir, y el test falla al terminar aunque la app se haya tragado el error (un pedido a
// la API que falla se muestra como un aviso, no como una excepción). Antes, con `.env.local`
// apuntando al backend de desarrollo, los tests que montan la app le pegaban de verdad: desde
// HU4.1 respondía 401 y la app mostraba la pantalla de ingreso. La base de la API de los tests se
// fija en `vite.config.ts` (`test.env`).
//
// Se reemplaza `fetch` al cargar el setup, no con `vi.stubGlobal`: así `vi.unstubAllGlobals()`,
// que los tests llaman al terminar, vuelve a este bloqueo y no al `fetch` real. Los tests contra
// la API real usan `fetchDeRed`.
const pedidosNoSimulados: string[] = [];

function describirPedido(entrada: RequestInfo | URL, init?: RequestInit): string {
  const esRequest = typeof Request !== 'undefined' && entrada instanceof Request;
  const metodo = (init?.method ?? (esRequest ? entrada.method : 'GET')).toUpperCase();
  const url =
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  return `${metodo} ${url}`;
}

globalThis.fetch = (entrada, init) => {
  const pedido = describirPedido(entrada, init);
  pedidosNoSimulados.push(pedido);
  return Promise.reject(
    new Error(
      `Pedido no simulado en un test: ${pedido}. Los tests no salen a la red: simulá fetch en el test (vi.stubGlobal('fetch', …)).`,
    ),
  );
};

beforeEach(() => {
  pedidosNoSimulados.length = 0;
});

afterEach(() => {
  if (pedidosNoSimulados.length > 0) {
    const pedidos = pedidosNoSimulados.splice(0);
    throw new Error(
      `El test hizo ${pedidos.length} pedido(s) que no simuló (no salen a la red):\n${pedidos
        .map((pedido) => `  - ${pedido}`)
        .join('\n')}`,
    );
  }
});

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
