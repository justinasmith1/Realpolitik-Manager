import { createBrowserRouter, redirect, type RouteObject } from 'react-router';

import { NotFoundPage } from '@/app/NotFoundPage';
import type { AppRouteHandle } from '@/components/layout/AppHeader';
import { AppLayout } from '@/components/layout/AppLayout';
import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { MatricesPage } from '@/modules/clientes/pages/MatricesPage';
import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';
import { TiposDocumentoPage } from '@/modules/tipos-documento/pages/TiposDocumentoPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, loader: () => redirect('/clientes') },
      {
        path: 'clientes',
        element: <ClientesPage />,
        handle: { title: 'Clientes' } satisfies AppRouteHandle,
      },
      {
        path: 'clientes/matrices',
        element: <MatricesPage />,
        handle: { title: 'Matrices' } satisfies AppRouteHandle,
      },
      // Hermana de `clientes`, no hija: las dos páginas renderizan `ClientesNav` y el Sidebar
      // marca Clientes en ambas (su enlace no exige coincidencia exacta).
      {
        path: 'clientes/tipos-documento',
        element: <TiposDocumentoPage />,
        handle: { title: 'Tipos de documento' } satisfies AppRouteHandle,
      },
      // Detalle de un cliente, no una sección del catálogo: ClientesNav no gana un ítem.
      {
        path: 'clientes/:id/matriz',
        element: <MatrizPage />,
        handle: { title: 'Matriz' } satisfies AppRouteHandle,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

// El router de datos se crea una vez, fuera del árbol de React (ver main.tsx).
export function createAppRouter() {
  return createBrowserRouter(routes);
}
