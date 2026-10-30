import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, useLocation, useParams } from 'react-router';

import type { EstadoDeDetalle } from '@/modules/rendiciones/rendiciones.rutas';

/** Página de detalle de mentira: deja ver a dónde se navegó y con qué aviso. */
function DetalleDePrueba() {
  const { id, rendicionId } = useParams();
  const estado = useLocation().state as EstadoDeDetalle | null;
  return (
    <div>
      <h1>Detalle {rendicionId}</h1>
      <p>Cliente {id}</p>
      {estado?.aviso !== undefined && <p>{estado.aviso}</p>}
    </div>
  );
}

/**
 * Renderiza `elemento` en la matriz de un cliente (`/clientes/:id/matriz`) dentro de un router en
 * memoria, con el detalle de una rendición como página de mentira. Devuelve el router para leer
 * la URL (`router.state.location`).
 */
export function renderEnMatriz(elemento: ReactNode, entrada = '/clientes/x/matriz') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/clientes/:id/matriz', element: elemento },
      { path: '/clientes/:id/rendiciones/:rendicionId', element: <DetalleDePrueba /> },
    ],
    { initialEntries: [entrada] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), router, queryClient };
}
