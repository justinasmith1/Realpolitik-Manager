import type { SesionActual, UsuarioDeSesion } from '@realpolitik/shared';

import { queryClient } from '@/app/providers';
import { CLAVE_SESION } from '@/modules/auth/sesion';

export const USUARIO_DE_PRUEBA: UsuarioDeSesion = {
  id: '0000a000-0000-4000-8000-000000000001',
  email: 'administrativo@realpolitik.test',
  nombre: 'Ana Administrativa',
  rol: 'ADMINISTRATIVO',
  debeCambiarPassword: false,
};

export const sesionDePrueba = (cambios: Partial<UsuarioDeSesion> = {}): SesionActual => ({
  usuario: { ...USUARIO_DE_PRUEBA, ...cambios },
});

/**
 * Deja el QueryClient de la app como después de `GET /auth/sesion` con 200: para los tests que
 * renderizan las rutas reales y no tratan sobre la autenticación. Empieza de cero (la caché es
 * una sola para toda la app y no se comparte entre tests).
 */
export function conSesionDePrueba(cambios: Partial<UsuarioDeSesion> = {}): void {
  queryClient.clear();
  queryClient.setQueryData(CLAVE_SESION, sesionDePrueba(cambios));
}
