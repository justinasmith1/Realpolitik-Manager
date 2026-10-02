import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Una única instancia durante toda la vida de la app: se crea al cargar el módulo,
// fuera del árbol de React (igual que el router), así no depende de renders ni de la
// doble invocación de StrictMode. Sin SSR no hay caché compartida entre requests.
// Se usan los defaults de TanStack Query hasta que una query real justifique otra cosa.
const queryClient = new QueryClient();

interface AppProvidersProps {
  children: ReactNode;
}

/** Punto de composición de la infraestructura de la aplicación. */
export function AppProviders({ children }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
