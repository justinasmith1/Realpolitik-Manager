// Manejo global de los errores de sesión y acceso de CUALQUIER pedido (queries y mutations).
// Se conecta una sola vez, en `crearQueryClient`. Cada pantalla sigue mostrando su propio estado
// de error; acá solo se actualiza el estado de la sesión, y la guarda de rutas reacciona.
//
// - 401 → se confirma con el servidor (`confirmarSesion`): si la cookie actual vale, era un 401
//   atrasado (un pedido con el token anterior a una rotación) y la sesión sigue; si no, la sesión
//   terminó: "no autenticado", sin datos en memoria. Varios 401 a la vez dan una sola consulta, un
//   solo cambio de estado y una sola redirección. Si el 401 vino de un envío de formulario,
//   `/login` avisa que lo que se estaba guardando no se guardó.
// - 403 CAMBIO_DE_PASSWORD_REQUERIDO / ROL_NO_HABILITADO → la sesión sigue pero cambió: se
//   descartan los datos y se vuelve a pedir `GET /auth/sesion`.
// - 403 PERMISO_INSUFICIENTE → la sesión sigue: solo se revalida (pudo cambiar el rol).
// - 429, 503, red y 403 de origen → NUNCA tocan la sesión.

import type { QueryClient } from '@tanstack/react-query';

import { clasificarErrorDeAuth } from '@/modules/auth/erroresDeAuth';
import {
  CLAVE_SESION,
  confirmarSesion,
  revalidarSesion,
  type ConsultaDeLaCache,
} from '@/modules/auth/sesion';

/** De dónde vino el error: una consulta (se puede volver a pedir) o un envío (no se reintenta). */
export type OrigenDelError =
  { origen: 'consulta'; consulta: ConsultaDeLaCache } | { origen: 'envio' };

export function manejarErrorGlobal(
  queryClient: QueryClient,
  error: unknown,
  contexto?: OrigenDelError,
): void {
  const clasificado = clasificarErrorDeAuth(error);
  switch (clasificado.clase) {
    case 'sin-sesion':
      // Ya sin sesión (otro pedido llegó antes): no se pisa el motivo ni se repite el trabajo.
      if (queryClient.getQueryData(CLAVE_SESION) !== null) {
        void confirmarSesion(
          queryClient,
          {
            motivo: clasificado.vencida ? 'vencida' : 'terminada',
            sinGuardar: contexto?.origen === 'envio',
          },
          contexto?.origen === 'consulta' ? contexto.consulta : undefined,
        );
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
