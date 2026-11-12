import { createBrowserRouter, redirect, type RouteObject } from 'react-router';

import { NotFoundPage } from '@/app/NotFoundPage';
import type { AppRouteHandle } from '@/components/layout/AppHeader';
import { AppLayout } from '@/components/layout/AppLayout';
import { RequiereSesion } from '@/modules/auth/components/RequiereSesion';
import { CambiarContrasenaPage } from '@/modules/auth/pages/CambiarContrasenaPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';
import { ClientesPage } from '@/modules/clientes/pages/ClientesPage';
import { MatricesPage } from '@/modules/clientes/pages/MatricesPage';
import { MatrizPage } from '@/modules/clientes/pages/MatrizPage';
import { ArchivosPage } from '@/modules/documentos/pages/ArchivosPage';
import { RendicionDetallePage } from '@/modules/rendiciones/pages/RendicionDetallePage';
import { RendicionesPage } from '@/modules/rendiciones/pages/RendicionesPage';
import { TiposDocumentoPage } from '@/modules/tipos-documento/pages/TiposDocumentoPage';

export const routes: RouteObject[] = [
  // Pantallas de acceso, fuera del shell y de la guarda (HU4.1).
  { path: '/login', element: <LoginPage /> },
  { path: '/cambiar-contrasena', element: <CambiarContrasenaPage /> },
  {
    path: '/',
    // Todo lo demás exige una sesión habilitada: sin ella no se monta el shell ni ninguna página
    // (ni sus pedidos). También las rutas desconocidas: no se revela qué existe sin sesión.
    element: (
      <RequiereSesion>
        <AppLayout />
      </RequiereSesion>
    ),
    children: [
      // Al entrar al sistema se abre la pantalla Rendiciones del mes actual (HU3.2).
      { index: true, loader: () => redirect('/rendiciones') },
      {
        path: 'rendiciones',
        element: <RendicionesPage />,
        handle: { title: 'Rendiciones' } satisfies AppRouteHandle,
      },
      {
        path: 'clientes',
        element: <ClientesPage />,
        handle: { title: 'Clientes' } satisfies AppRouteHandle,
      },
      {
        path: 'clientes/matrices',
        element: <MatricesPage />,
        handle: { title: 'Requisitos' } satisfies AppRouteHandle,
      },
      // Sección Documentos, con su navegación secundaria (como Clientes y Requisitos): el
      // repositorio de archivos (HU2.8) es lo de todos los días y va primero; el catálogo de tipos
      // de documento, general del sistema y no de un cliente, es la segunda pestaña.
      // `/documentos` lleva al repositorio. Los redirects de un loader conservan la query string
      // (el hash no llega a un loader y las páginas no lo usan) y reemplazan la entrada del
      // historial, así Atrás no vuelve a la ruta que redirige.
      {
        path: 'documentos',
        loader: ({ request }) => redirect(`/documentos/archivos${new URL(request.url).search}`),
      },
      {
        path: 'documentos/archivos',
        element: <ArchivosPage />,
        handle: { title: 'Documentos' } satisfies AppRouteHandle,
      },
      {
        path: 'documentos/tipos',
        element: <TiposDocumentoPage />,
        handle: { title: 'Documentos' } satisfies AppRouteHandle,
      },
      // Ruta anterior del catálogo: se redirige para no romper enlaces guardados (`?desactivados=1`).
      {
        path: 'clientes/tipos-documento',
        loader: ({ request }) => redirect(`/documentos/tipos${new URL(request.url).search}`),
      },
      // Detalle de un cliente, no una sección del catálogo: ClientesNav no gana un ítem.
      {
        path: 'clientes/:id/matriz',
        element: <MatrizPage />,
        handle: { title: 'Requisitos' } satisfies AppRouteHandle,
      },
      {
        path: 'clientes/:id/rendiciones/:rendicionId',
        element: <RendicionDetallePage />,
        handle: { title: 'Rendición' } satisfies AppRouteHandle,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

// El router de datos se crea una vez, fuera del árbol de React (ver main.tsx).
export function createAppRouter() {
  return createBrowserRouter(routes);
}
