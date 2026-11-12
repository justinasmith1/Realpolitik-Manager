import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { debeReintentar, DEMORA_DEL_REINTENTO_MS } from '@/lib/reintentos';
import { manejarErrorGlobal } from '@/modules/auth/manejoGlobal';

/**
 * El QueryClient de la app, con la política de reintentos explícita (ver `lib/reintentos`):
 * las lecturas reintentan una vez, rápido, solo ante fallos que pueden ser transitorios; las
 * mutations no se reintentan. Exportado para que los tests usen la misma configuración.
 *
 * Además conecta el manejo global de sesión y acceso (401, 403): cualquier pedido que falle pasa
 * por `manejarErrorGlobal`, salvo los de la propia sesión (`meta.esDeSesion`), que se manejan solos.
 */
export function crearQueryClient(): QueryClient {
  const alFallar = (error: unknown, meta: Record<string, unknown> | undefined) => {
    if (meta?.esDeSesion !== true) {
      manejarErrorGlobal(queryClient, error);
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => alFallar(error, query.meta) }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _contexto, mutation) => alFallar(error, mutation.meta),
    }),
    defaultOptions: {
      queries: { retry: debeReintentar, retryDelay: DEMORA_DEL_REINTENTO_MS },
      mutations: { retry: false },
    },
  });
  return queryClient;
}

// Una única instancia durante toda la vida de la app: se crea al cargar el módulo,
// fuera del árbol de React (igual que el router), así no depende de renders ni de la
// doble invocación de StrictMode. Sin SSR no hay caché compartida entre requests.
export const queryClient = crearQueryClient();

interface AppProvidersProps {
  children: ReactNode;
}

/** Punto de composición de la infraestructura de la aplicación. */
export function AppProviders({ children }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
