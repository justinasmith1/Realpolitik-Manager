import {
  ActualizarEstadoUsuarioSchema,
  ActualizarUsuarioSchema,
  CrearUsuarioSchema,
  ListarUsuariosQuerySchema,
  RestablecerContrasenaSchema,
} from '@realpolitik/shared';
import { z } from 'zod';

import { validate } from '../../middleware/validate';
import { autorizar, crearRouter } from '../auth/autorizacion';

import {
  cambiarEstadoDeUsuarioController,
  crearUsuarioController,
  listarUsuariosController,
  modificarUsuarioController,
  restablecerContrasenaController,
} from './usuarios.controller';

export const UsuarioIdParamsSchema = z.object({
  id: z.string().uuid({ message: 'El ID debe ser un UUID válido.' }),
});

// Administración de usuarios (HU4.5): solo `usuarios:administrar` (ADMINISTRADOR). No hay DELETE:
// una cuenta se desactiva con `/estado`. Las reglas de autoprotección son del servicio.
export const usuariosRouter = crearRouter();

usuariosRouter.get(
  '/',
  autorizar('usuarios:administrar'),
  validate({ query: ListarUsuariosQuerySchema }),
  listarUsuariosController,
);

usuariosRouter.post(
  '/',
  autorizar('usuarios:administrar'),
  validate({ body: CrearUsuarioSchema }),
  crearUsuarioController,
);

usuariosRouter.patch(
  '/:id',
  autorizar('usuarios:administrar'),
  validate({ params: UsuarioIdParamsSchema, body: ActualizarUsuarioSchema }),
  modificarUsuarioController,
);

usuariosRouter.patch(
  '/:id/estado',
  autorizar('usuarios:administrar'),
  validate({ params: UsuarioIdParamsSchema, body: ActualizarEstadoUsuarioSchema }),
  cambiarEstadoDeUsuarioController,
);

usuariosRouter.post(
  '/:id/restablecer-password',
  autorizar('usuarios:administrar'),
  validate({ params: UsuarioIdParamsSchema, body: RestablecerContrasenaSchema }),
  restablecerContrasenaController,
);
