// Validación del formulario de usuario. Las reglas son las de shared (`NombreDeUsuarioSchema`,
// `EmailDeUsuarioSchema`, `RolDeUsuarioSchema`, las mismas que arman `CrearUsuarioSchema`): acá
// solo se adapta el resultado a un formulario. Sus mensajes ya están en español.

import {
  EmailDeUsuarioSchema,
  NombreDeUsuarioSchema,
  RolDeUsuarioSchema,
  type ActualizarUsuarioDto,
  type RolUsuarioType,
  type UsuarioAdministrado,
} from '@realpolitik/shared';
import type { FieldErrors, Resolver } from 'react-hook-form';

/** Los campos como texto; `rol: ''` es "todavía sin elegir" (el alta arranca así). */
export interface UsuarioFormValues {
  nombre: string;
  email: string;
  rol: RolUsuarioType | '';
}

/** Lo que entrega el formulario ya validado y normalizado por shared. */
export interface DatosDeUsuario {
  nombre: string;
  email: string;
  rol: RolUsuarioType;
}

export type CampoUsuarioForm = keyof UsuarioFormValues;

export const valoresInicialesUsuarioForm: UsuarioFormValues = { nombre: '', email: '', rol: '' };

export const usuarioAValoresForm = (usuario: UsuarioAdministrado): UsuarioFormValues => ({
  nombre: usuario.nombre,
  email: usuario.email,
  rol: usuario.rol,
});

/** Qué campos se validan: en la edición el email es de lectura, y el rol propio también. */
interface CamposEditables {
  email: boolean;
  rol: boolean;
}

/**
 * Valida cada campo editable con su schema de shared. Lo que no se edita pasa tal como llegó (son
 * los datos de la cuenta, que ya cumplen el contrato).
 */
export function resolverDeUsuario(
  editables: CamposEditables,
): Resolver<UsuarioFormValues, unknown, DatosDeUsuario> {
  return (valores) => {
    const errores: FieldErrors<UsuarioFormValues> = {};
    const nombre = NombreDeUsuarioSchema.safeParse(valores.nombre);
    const email = editables.email ? EmailDeUsuarioSchema.safeParse(valores.email) : null;
    const rol = editables.rol ? RolDeUsuarioSchema.safeParse(valores.rol) : null;

    if (!nombre.success) {
      errores.nombre = { type: 'validate', message: nombre.error.issues[0]?.message ?? '' };
    }
    if (email !== null && !email.success) {
      errores.email = { type: 'validate', message: email.error.issues[0]?.message ?? '' };
    }
    if (rol !== null && !rol.success) {
      errores.rol = { type: 'validate', message: rol.error.issues[0]?.message ?? '' };
    }
    if (Object.keys(errores).length > 0 || !nombre.success) {
      return { values: {}, errors: errores };
    }
    return {
      values: {
        nombre: nombre.data,
        email: email?.success ? email.data : valores.email,
        rol: rol?.success ? rol.data : (valores.rol as RolUsuarioType),
      },
      errors: {},
    };
  };
}

/** ¿El formulario sigue como se abrió? Los espacios de los bordes no cuentan, igual que en shared. */
export function sinCambiosRespectoDe(
  valores: Pick<UsuarioFormValues, 'nombre' | 'rol'>,
  iniciales: UsuarioFormValues,
): boolean {
  return valores.nombre.trim() === iniciales.nombre.trim() && valores.rol === iniciales.rol;
}

/**
 * El PATCH de la edición: solo lo que cambió respecto de la cuenta con la que se abrió. Reenviar el
 * rol sin haberlo tocado pisaría el que otra persona le haya asignado mientras tanto. `{}` si no
 * cambió nada: quien lo usa no envía el pedido.
 */
export function cambiosDeUsuario(
  datos: DatosDeUsuario,
  usuario: UsuarioAdministrado,
  rolEditable: boolean,
): ActualizarUsuarioDto {
  return {
    ...(datos.nombre !== usuario.nombre && { nombre: datos.nombre }),
    ...(rolEditable && datos.rol !== usuario.rol && { rol: datos.rol }),
  };
}

export const hayCambios = (cambios: ActualizarUsuarioDto) => Object.keys(cambios).length > 0;
