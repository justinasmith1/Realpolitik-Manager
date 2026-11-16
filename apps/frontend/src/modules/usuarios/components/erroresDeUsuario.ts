// Traduce un fallo de `/usuarios` (ya interpretado por `usuarios.api`) a texto de la interfaz:
// errores del formulario del alta y la edición, o el aviso de un diálogo o de la página. Nunca
// muestra detalles técnicos ni el mensaje interno de un error.

import { mensajeDelServidor } from '@/lib/errores-api';
import { MENSAJE_PERMISO_INSUFICIENTE } from '@/modules/auth/erroresDeAuth';
import type { FalloDeUsuario, OperacionPropia } from '@/modules/usuarios/api/usuarios.api';

/** La operación que falló: cambia qué se dice de un resultado sin confirmar. */
export type OperacionDeUsuario = 'crear' | 'editar' | 'desactivar' | 'reactivar' | 'restablecer';

export type CampoDeUsuario = 'nombre' | 'email' | 'rol';

export interface AvisoDeFallo {
  variante: 'destructive' | 'warning';
  texto: string;
}

/** Errores que informó el servidor al enviar un formulario: por campo y/o un aviso general. */
export interface ErroresDeEnvio {
  campos?: Partial<Record<CampoDeUsuario, string>>;
  general?: AvisoDeFallo;
}

export const MENSAJE_EMAIL_EN_USO =
  'Ya existe una cuenta con ese email. Si está desactivada, la encontrás con «Incluir desactivados».';
export const MENSAJE_ULTIMO_ADMINISTRADOR_DESACTIVAR =
  'No podés desactivar al último administrador activo. Primero asigná ese rol a otra persona.';
export const MENSAJE_ULTIMO_ADMINISTRADOR_ROL =
  'No podés quitarle el rol al último administrador activo. Primero asigná ese rol a otra persona.';
export const MENSAJE_CONCURRENCIA =
  'Otra operación sobre las cuentas se hizo al mismo tiempo y no se guardó ningún cambio. Revisá el listado y probá de nuevo.';
export const MENSAJE_NO_EXISTE = 'Esta cuenta ya no existe.';
export const MENSAJE_OCUPADO =
  'El servicio está ocupado y no se guardó ningún cambio. Probá de nuevo en unos segundos.';
export const MENSAJE_INESPERADO = 'No pudimos completar la operación. Probá de nuevo.';

/** Sin confirmar: nunca se afirma que se guardó, ni que no. */
export const MENSAJE_NO_CONFIRMADO: Record<OperacionDeUsuario, string> = {
  crear:
    'No pudimos confirmar el alta y no hay una contraseña temporal para entregar. Revisá el listado: si la cuenta aparece, restablecé su contraseña.',
  editar: 'No pudimos confirmar los cambios. Revisá el listado antes de volver a intentarlo.',
  desactivar:
    'No pudimos confirmar si la cuenta se desactivó. Revisá el listado antes de volver a intentarlo.',
  reactivar:
    'No pudimos confirmar si la cuenta se reactivó. Revisá el listado antes de volver a intentarlo.',
  restablecer:
    'No pudimos confirmar el restablecimiento y no hay una contraseña temporal para entregar. Revisá el listado antes de volver a restablecerla.',
};

const MENSAJE_CUENTA_PROPIA: Record<OperacionPropia, string> = {
  'cambiar-rol': 'No podés cambiar tu propio rol: lo tiene que hacer otra persona administradora.',
  desactivar: 'No podés desactivar tu propia cuenta.',
  'restablecer-password':
    'Tu contraseña no se restablece desde acá: cambiala desde el menú de tu cuenta.',
};

const MENSAJE_DATO_INVALIDO = 'Revisá este dato.';
const MENSAJE_GENERAL_CON_CAMPOS = 'Algunos datos no son válidos. Revisá los campos marcados.';
const MENSAJE_GENERAL_SIN_CAMPOS = 'Algunos datos no son válidos. Revisá los datos ingresados.';

const error = (texto: string): AvisoDeFallo => ({ variante: 'destructive', texto });
const advertencia = (texto: string): AvisoDeFallo => ({ variante: 'warning', texto });

/** El aviso de un fallo que no va en un campo del formulario. */
export function avisoDeFallo(fallo: FalloDeUsuario, operacion: OperacionDeUsuario): AvisoDeFallo {
  switch (fallo.tipo) {
    case 'no-confirmado':
      return advertencia(MENSAJE_NO_CONFIRMADO[operacion]);
    case 'concurrencia':
      return advertencia(MENSAJE_CONCURRENCIA);
    case 'cuenta-propia':
      return error(
        fallo.operacion === null
          ? 'Esta operación no se puede hacer sobre tu propia cuenta.'
          : MENSAJE_CUENTA_PROPIA[fallo.operacion],
      );
    case 'ultimo-administrador':
      return error(
        operacion === 'desactivar'
          ? MENSAJE_ULTIMO_ADMINISTRADOR_DESACTIVAR
          : MENSAJE_ULTIMO_ADMINISTRADOR_ROL,
      );
    case 'no-existe':
      return error(MENSAJE_NO_EXISTE);
    case 'sin-permiso':
      return error(MENSAJE_PERMISO_INSUFICIENTE);
    case 'ocupado':
      return error(MENSAJE_OCUPADO);
    case 'email-en-uso':
      return error(MENSAJE_EMAIL_EN_USO);
    case 'datos-invalidos':
      return error(MENSAJE_GENERAL_SIN_CAMPOS);
    case 'sin-sesion':
    case 'inesperado':
      return error(MENSAJE_INESPERADO);
  }
}

/**
 * Errores para el formulario del alta o la edición. Un email repetido y los datos rechazados van
 * en su campo (con el mensaje de shared si es útil); lo demás, al aviso general.
 */
export function erroresParaElFormulario(
  fallo: FalloDeUsuario,
  operacion: 'crear' | 'editar',
): ErroresDeEnvio {
  if (fallo.tipo === 'email-en-uso') {
    return { campos: { email: MENSAJE_EMAIL_EN_USO } };
  }
  if (fallo.tipo !== 'datos-invalidos') {
    return { general: avisoDeFallo(fallo, operacion) };
  }
  const campos: Partial<Record<CampoDeUsuario, string>> = {};
  const sueltos: string[] = [];
  for (const { campo, mensaje } of fallo.detalles) {
    const texto = mensajeDelServidor(mensaje);
    if (campo === 'nombre' || campo === 'email' || campo === 'rol') {
      campos[campo] ??= texto ?? MENSAJE_DATO_INVALIDO;
    } else if (texto !== null) {
      sueltos.push(texto);
    }
  }
  const hayCampos = Object.keys(campos).length > 0;
  return {
    campos,
    general: error(
      hayCampos ? MENSAJE_GENERAL_CON_CAMPOS : (sueltos[0] ?? MENSAJE_GENERAL_SIN_CAMPOS),
    ),
  };
}
