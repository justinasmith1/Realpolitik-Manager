import type { ReactNode } from 'react';

import { AccesoDenegadoPage } from '@/app/AccesoDenegadoPage';
import { usePermiso } from '@/modules/auth/hooks/useSesion';
import type { Permiso } from '@/modules/auth/permisos';

/**
 * Guarda de una ruta que pide un permiso (dentro de `RequiereSesion`, que ya resolvió la sesión).
 * Sin el permiso, "No tenés acceso" y la página no se monta: tampoco hace sus pedidos. Si el rol
 * cambia con la página abierta (un 403 revalida la sesión), se pasa a esa pantalla sola.
 *
 * Es solo presentación: la API rechaza por su cuenta cada pedido sin permiso.
 */
export function RequierePermiso({ permiso, children }: { permiso: Permiso; children: ReactNode }) {
  return usePermiso(permiso) ? children : <AccesoDenegadoPage />;
}
