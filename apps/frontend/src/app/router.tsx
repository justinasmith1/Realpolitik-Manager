import { createBrowserRouter, redirect, type RouteObject } from 'react-router';

import { NotFoundPage } from '@/app/NotFoundPage';
import type { AppRouteHandle } from '@/components/layout/AppHeader';
import { AppLayout } from '@/components/layout/AppLayout';
import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';

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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

// El router de datos se crea una vez, fuera del árbol de React (ver main.tsx).
export function createAppRouter() {
  return createBrowserRouter(routes);
}
