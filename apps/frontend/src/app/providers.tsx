import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { debeReintentar, DEMORA_DEL_REINTENTO_MS } from '@/lib/reintentos';

/**
 * El QueryClient de la app, con la política de reintentos explícita (ver `lib/reintentos`):
 * las lecturas reintentan una vez, rápido, solo ante fallos que pueden ser transitorios; las
 * mutations no se reintentan. Exportado para que los tests usen la misma configuración.
 */
export function crearQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: debeReintentar, retryDelay: DEMORA_DEL_REINTENTO_MS },
      mutations: { retry: false },
    },
  });
}

// Una única instancia durante toda la vida de la app: se crea al cargar el módulo,
// fuera del árbol de React (igual que el router), así no depende de renders ni de la
// doble invocación de StrictMode. Sin SSR no hay caché compartida entre requests.
const queryClient = crearQueryClient();

interface AppProvidersProps {
  children: ReactNode;
}

/** Punto de composición de la infraestructura de la aplicación. */
export function AppProviders({ children }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
