// Manejo global de los errores de sesión y acceso de CUALQUIER pedido (queries y mutations).
// Se conecta una sola vez, en `crearQueryClient`. Cada pantalla sigue mostrando su propio estado
// de error; acá solo se actualiza el estado de la sesión, y la guarda de rutas reacciona.
//
// - 401 → la sesión terminó: "no autenticado", sin datos en memoria. Varios 401 a la vez dan un
//   solo cambio de estado (y una sola redirección).
// - 403 CAMBIO_DE_PASSWORD_REQUERIDO / ROL_NO_HABILITADO → la sesión sigue pero cambió: se
//   descartan los datos y se vuelve a pedir `GET /auth/sesion`.
// - 403 PERMISO_INSUFICIENTE → la sesión sigue: solo se revalida (pudo cambiar el rol).
// - 429, 503, red y 403 de origen → NUNCA tocan la sesión.

import type { QueryClient } from '@tanstack/react-query';

import { clasificarErrorDeAuth } from '@/modules/auth/erroresDeAuth';
import { CLAVE_SESION, revalidarSesion, terminarSesion } from '@/modules/auth/sesion';

export function manejarErrorGlobal(queryClient: QueryClient, error: unknown): void {
  const clasificado = clasificarErrorDeAuth(error);
  switch (clasificado.clase) {
    case 'sin-sesion':
      // Ya sin sesión (otro pedido llegó antes): no se pisa el motivo ni se repite el trabajo.
      if (queryClient.getQueryData(CLAVE_SESION) !== null) {
        terminarSesion(queryClient, clasificado.vencida ? 'vencida' : 'terminada');
      }
      return;
    case 'cambio-requerido':
    case 'rol-no-habilitado':
      revalidarSesion(queryClient);
      return;
    case 'permiso-insuficiente':
      revalidarSesion(queryClient, { descartar: false });
      return;
    default:
      return;
  }
}
