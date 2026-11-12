// Rutas de `/auth`, públicas (`crearRouterPublico`): aplican sus propias reglas de sesión. Delante,
// en `createApp`, ya corrieron `sinCache` y `verificarOrigen`. Login y logout no exigen sesión; la
// consulta de sesión y el cambio de contraseña, sí (`requerirSesion` y `cuenta:propia`, antes de
// validar el cuerpo: primero 401, después 400).
//
// Una cuenta con `debeCambiarPassword` usa todas estas rutas: inicia sesión, consulta su sesión,
// cambia la contraseña y cierra sesión. Fuera de `/auth/*` recibe 403 `CAMBIO_DE_PASSWORD_REQUERIDO`
// (`exigirPasswordDefinitiva`, en `createApp`).

import { CambiarContrasenaSchema, IniciarSesionSchema } from '@realpolitik/shared';

import { validate } from '../../middleware/validate';

import {
  crearCambioDeContrasenaController,
  crearLoginController,
  logoutController,
  requerirSesion,
  sesionController,
} from './auth.controller';
import { autorizar, crearRouterPublico } from './autorizacion';
import type { ProteccionDeLogin } from './proteccionDeLogin';

export function crearAuthRouter({ proteccion }: { proteccion: ProteccionDeLogin }) {
  const router = crearRouterPublico();
  router.post('/login', validate({ body: IniciarSesionSchema }), crearLoginController(proteccion));
  router.get('/sesion', requerirSesion, autorizar('cuenta:propia'), sesionController);
  router.put(
    '/password',
    requerirSesion,
    autorizar('cuenta:propia'),
    validate({ body: CambiarContrasenaSchema }),
    crearCambioDeContrasenaController(proteccion),
  );
  router.post('/logout', logoutController);
  return router;
}
