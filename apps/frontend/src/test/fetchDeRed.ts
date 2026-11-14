// El `fetch` real de Node, guardado antes de que `setup.ts` lo reemplace por uno que no sale a la
// red. Lo usan solo los tests contra la API real (`*.api.test.tsx`, a través de `sesionDeApi`):
// ningún otro test debería pedir nada fuera del proceso.
export const fetchDeRed: typeof fetch = globalThis.fetch.bind(globalThis);
