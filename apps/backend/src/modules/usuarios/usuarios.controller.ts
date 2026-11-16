// Controladores de `/usuarios` (HU4.5). Van detrás de `requerirSesion` y de
// `autorizar('usuarios:administrar')`: el actor es SIEMPRE el usuario de la sesión, nunca algo que
// llegue en el pedido. Las reglas (autoprotección, último administrador, revocación de sesiones,
// contraseña temporal) son del servicio; acá solo se traduce su resultado a HTTP.
//
// | Error del servicio                   | Respuesta                                                        |
// | ------------------------------------ | ---------------------------------------------------------------- |
// | Datos inválidos                      | 400 VALIDATION_ERROR, un detalle por campo                       |
// | Usuario inexistente                  | 404 NOT_FOUND                                                    |
// | Email de otra cuenta                 | 409 CONFLICT, motivo EMAIL_EN_USO, campo `email`                 |
// | Operación sobre la propia cuenta     | 409 CONFLICT, motivo OPERACION_SOBRE_CUENTA_PROPIA, `operacion`  |
// | Dejaría sin administrador activo     | 409 CONFLICT, motivo ULTIMO_ADMINISTRADOR, `operacion`           |
// | Conflictos agotados (nada se guardó) | 409 CONFLICT, motivo CONFLICTO_DE_CONCURRENCIA                   |
// | Capacidad de argon2 agotada          | 503 SERVICE_UNAVAILABLE, Retry-After (antes de escribir nada)    |
// | PostgreSQL no responde, al leer      | 503 SERVICE_UNAVAILABLE, Retry-After                             |
// | PostgreSQL no responde, al escribir  | 503 SERVICE_UNAVAILABLE, motivo RESULTADO_NO_CONFIRMADO          |
// | COMMIT no confirmado                 | 500 INTERNAL_ERROR, motivo RESULTADO_NO_CONFIRMADO               |
// | Cualquier otro                       | 500 INTERNAL_ERROR (errorHandler)                                |
//
// Un resultado no confirmado puede ser una operación revertida o una que sí se guardó: el mensaje
// no afirma ninguna de las dos, no lleva Retry-After (no invita a reintentar solo) y nunca trae una
// contraseña temporal.

import type {
  ActualizarEstadoUsuarioSchema,
  ActualizarUsuarioSchema,
  ContrasenaRestablecida,
  CrearUsuarioSchema,
  EstadoDeUsuarioCambiado,
  ListarUsuariosQuerySchema,
  RestablecerContrasenaSchema,
  UsuarioAdministrado,
  UsuarioCreado,
  UsuarioModificado,
} from '@realpolitik/shared';
import type { Request, Response } from 'express';

import {
  AppError,
  conflict,
  notFound,
  serviceUnavailable,
  validationError,
} from '../../errors/app-error';
import { BaseDeDatosNoDisponibleError } from '../../lib/baseDeDatosNoDisponible';
import { CapacidadAgotadaError } from '../../lib/limitadorDeConcurrencia';
import { prisma } from '../../lib/prisma';
import type { ValidatedLocals } from '../../middleware/validate';
import {
  MENSAJE_SERVICIO_NO_DISPONIBLE,
  MENSAJE_SERVICIO_OCUPADO,
  REINTENTO_POR_SATURACION_SEGUNDOS,
} from '../auth/auth.controller';
import type { LocalsDeSesion } from '../auth/autorizacion';

import type { UsuarioIdParamsSchema } from './usuarios.routes';
import {
  cambiarEstadoDeUsuario,
  ConflictoDeConcurrenciaError,
  crearUsuario,
  DatosDeUsuarioInvalidosError,
  EmailEnUsoError,
  listarUsuarios,
  modificarUsuario,
  OperacionNoConfirmadaError,
  OperacionSobreCuentaPropiaError,
  restablecerContrasena,
  UltimoAdministradorError,
  UsuarioInexistenteError,
} from './usuarios.service';

type ListarUsuariosLocals = ValidatedLocals<{ query: typeof ListarUsuariosQuerySchema }>;
type CrearUsuarioLocals = LocalsDeSesion & ValidatedLocals<{ body: typeof CrearUsuarioSchema }>;
type ModificarUsuarioLocals = LocalsDeSesion &
  ValidatedLocals<{ params: typeof UsuarioIdParamsSchema; body: typeof ActualizarUsuarioSchema }>;
type CambiarEstadoDeUsuarioLocals = LocalsDeSesion &
  ValidatedLocals<{
    params: typeof UsuarioIdParamsSchema;
    body: typeof ActualizarEstadoUsuarioSchema;
  }>;
type RestablecerContrasenaLocals = LocalsDeSesion &
  ValidatedLocals<{
    params: typeof UsuarioIdParamsSchema;
    body: typeof RestablecerContrasenaSchema;
  }>;

type Operacion = 'listar' | 'crear' | 'modificar' | 'estado' | 'restablecer';

export const MENSAJE_USUARIO_INEXISTENTE = 'Usuario no encontrado';
export const MENSAJE_EMAIL_EN_USO = 'Ya existe una cuenta con ese email.';
export const MENSAJE_ULTIMO_ADMINISTRADOR =
  'Tiene que quedar al menos una persona administradora activa.';
export const MENSAJE_CONFLICTO_DE_CONCURRENCIA =
  'Otra operación sobre las cuentas se hizo al mismo tiempo y no se guardó ningún cambio. Actualizá el listado y probá de nuevo.';

const MENSAJE_CUENTA_PROPIA: Record<OperacionSobreCuentaPropiaError['operacion'], string> = {
  'cambiar-rol': 'No podés cambiar tu propio rol: lo tiene que hacer otra persona administradora.',
  desactivar: 'No podés desactivar tu propia cuenta.',
  'restablecer-password':
    'Tu contraseña no se restablece desde acá: cambiala desde el menú de tu cuenta.',
};

/** Qué decir cuando no se puede confirmar si una escritura quedó guardada. */
const MENSAJE_NO_CONFIRMADO: Record<Exclude<Operacion, 'listar'>, string> = {
  crear:
    'No pudimos confirmar el alta y no hay una contraseña temporal para entregar. Actualizá el listado: si la cuenta aparece, restablecé su contraseña.',
  modificar:
    'No pudimos confirmar el resultado. Actualizá el listado antes de volver a intentarlo.',
  estado: 'No pudimos confirmar el resultado. Actualizá el listado antes de volver a intentarlo.',
  restablecer:
    'No pudimos confirmar el restablecimiento y no hay una contraseña temporal para entregar. Actualizá el listado antes de volver a restablecerla.',
};

const RESULTADO_NO_CONFIRMADO = { motivo: 'RESULTADO_NO_CONFIRMADO' };

/** Traduce los errores del servicio de usuarios; el resto sigue su curso (500 en errorHandler). */
function traducirError(error: unknown, operacion: Operacion): unknown {
  if (error instanceof DatosDeUsuarioInvalidosError) {
    return validationError(
      error.errores.map(({ campo, mensaje }) => ({ campo: campo || 'body', mensaje })),
    );
  }
  if (error instanceof UsuarioInexistenteError) return notFound(MENSAJE_USUARIO_INEXISTENTE);
  if (error instanceof EmailEnUsoError) {
    return conflict('EMAIL_EN_USO', { campo: error.campo }, MENSAJE_EMAIL_EN_USO);
  }
  if (error instanceof OperacionSobreCuentaPropiaError) {
    return conflict(
      'OPERACION_SOBRE_CUENTA_PROPIA',
      { operacion: error.operacion },
      MENSAJE_CUENTA_PROPIA[error.operacion],
    );
  }
  if (error instanceof UltimoAdministradorError) {
    return conflict(
      'ULTIMO_ADMINISTRADOR',
      { operacion: error.operacion },
      MENSAJE_ULTIMO_ADMINISTRADOR,
    );
  }
  if (error instanceof ConflictoDeConcurrenciaError) {
    return conflict('CONFLICTO_DE_CONCURRENCIA', {}, MENSAJE_CONFLICTO_DE_CONCURRENCIA);
  }
  // El hash se calcula antes de escribir nada: se puede reintentar.
  if (error instanceof CapacidadAgotadaError) {
    return serviceUnavailable(MENSAJE_SERVICIO_OCUPADO, REINTENTO_POR_SATURACION_SEGUNDOS);
  }
  if (error instanceof BaseDeDatosNoDisponibleError) {
    return operacion === 'listar'
      ? serviceUnavailable(MENSAJE_SERVICIO_NO_DISPONIBLE, REINTENTO_POR_SATURACION_SEGUNDOS)
      : new AppError(
          'SERVICE_UNAVAILABLE',
          503,
          MENSAJE_NO_CONFIRMADO[operacion],
          RESULTADO_NO_CONFIRMADO,
        );
  }
  if (error instanceof OperacionNoConfirmadaError && operacion !== 'listar') {
    return new AppError(
      'INTERNAL_ERROR',
      500,
      MENSAJE_NO_CONFIRMADO[operacion],
      RESULTADO_NO_CONFIRMADO,
    );
  }
  return error;
}

export async function listarUsuariosController(
  _req: Request,
  res: Response<UsuarioAdministrado[], ListarUsuariosLocals>,
): Promise<void> {
  const { q, rol, incluirDesactivados } = res.locals.validated.query;
  let usuarios: UsuarioAdministrado[];
  try {
    usuarios = await listarUsuarios(prisma, {
      ...(q === undefined ? {} : { busqueda: q }),
      ...(rol === undefined ? {} : { rol }),
      incluirDesactivados,
    });
  } catch (error) {
    throw traducirError(error, 'listar');
  }
  res.status(200).json(usuarios);
}

export async function crearUsuarioController(
  _req: Request,
  res: Response<UsuarioCreado, CrearUsuarioLocals>,
): Promise<void> {
  const actorId = res.locals.sesion.usuario.id;
  let creado: UsuarioCreado;
  try {
    creado = await crearUsuario(prisma, { actorId, datos: res.locals.validated.body });
  } catch (error) {
    throw traducirError(error, 'crear');
  }
  res.status(201).json({ usuario: creado.usuario, contrasenaTemporal: creado.contrasenaTemporal });
}

export async function modificarUsuarioController(
  _req: Request,
  res: Response<UsuarioModificado, ModificarUsuarioLocals>,
): Promise<void> {
  const actorId = res.locals.sesion.usuario.id;
  const { params, body } = res.locals.validated;
  let modificado: UsuarioModificado;
  try {
    modificado = await modificarUsuario(prisma, {
      actorId,
      usuarioId: params.id,
      cambios: {
        ...(body.nombre === undefined ? {} : { nombre: body.nombre }),
        ...(body.rol === undefined ? {} : { rol: body.rol }),
      },
    });
  } catch (error) {
    throw traducirError(error, 'modificar');
  }
  const { usuario, modificados, sesionesRevocadas } = modificado;
  res.status(200).json({ usuario, modificados, sesionesRevocadas });
}

export async function cambiarEstadoDeUsuarioController(
  _req: Request,
  res: Response<EstadoDeUsuarioCambiado, CambiarEstadoDeUsuarioLocals>,
): Promise<void> {
  const actorId = res.locals.sesion.usuario.id;
  const { params, body } = res.locals.validated;
  let resultado: EstadoDeUsuarioCambiado;
  try {
    resultado = await cambiarEstadoDeUsuario(prisma, {
      actorId,
      usuarioId: params.id,
      activo: body.activo,
    });
  } catch (error) {
    throw traducirError(error, 'estado');
  }
  const { usuario, cambio, sesionesRevocadas } = resultado;
  res.status(200).json({ usuario, cambio, sesionesRevocadas });
}

export async function restablecerContrasenaController(
  _req: Request,
  res: Response<ContrasenaRestablecida, RestablecerContrasenaLocals>,
): Promise<void> {
  const actorId = res.locals.sesion.usuario.id;
  let restablecida: ContrasenaRestablecida;
  try {
    restablecida = await restablecerContrasena(prisma, {
      actorId,
      usuarioId: res.locals.validated.params.id,
    });
  } catch (error) {
    throw traducirError(error, 'restablecer');
  }
  const { usuario, contrasenaTemporal, sesionesRevocadas } = restablecida;
  res.status(200).json({ usuario, contrasenaTemporal, sesionesRevocadas });
}
