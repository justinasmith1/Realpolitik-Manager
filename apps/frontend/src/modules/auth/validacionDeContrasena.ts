// Validación en el cliente de los formularios de cambio de contraseña (obligatorio, HU4.1, y
// voluntario, HU4.2). Usa el mismo esquema que el servidor (`CambiarContrasenaSchema` de shared:
// obligatorios, de 8 a 128 caracteres contados después de NFC, la nueva distinta de la actual) y
// agrega la confirmación, que el servidor no recibe. La lista de bloqueo la aplica solo el
// servidor.

import { CambiarContrasenaSchema, type CambiarContrasenaDto } from '@realpolitik/shared';

export const MENSAJE_CONFIRMACION_DISTINTA = 'Las contraseñas no coinciden.';
export const MENSAJE_CONFIRMACION_VACIA = 'Repetí la contraseña nueva.';

export type CampoDeContrasena = 'actual' | 'nueva' | 'confirmacion';
export type ErroresDeContrasena = Partial<Record<CampoDeContrasena, string>>;

/** El orden de los campos en pantalla: el foco va al primero con error. */
export const CAMPOS_DE_CONTRASENA = ['actual', 'nueva', 'confirmacion'] as const;

export function primerCampoConError(errores: ErroresDeContrasena): CampoDeContrasena | undefined {
  return CAMPOS_DE_CONTRASENA.find((campo) => errores[campo] !== undefined);
}

export type ResultadoDeValidacion =
  { valido: true; datos: CambiarContrasenaDto } | { valido: false; errores: ErroresDeContrasena };

export function validarCambioDeContrasena({
  actual,
  nueva,
  confirmacion,
}: {
  actual: string;
  nueva: string;
  confirmacion: string;
}): ResultadoDeValidacion {
  const resultado = CambiarContrasenaSchema.safeParse({ actual, nueva });
  const campos = resultado.success ? {} : resultado.error.flatten().fieldErrors;
  const errores: ErroresDeContrasena = {
    ...(campos.actual?.[0] !== undefined && { actual: campos.actual[0] }),
    ...(campos.nueva?.[0] !== undefined && { nueva: campos.nueva[0] }),
    ...(confirmacion === ''
      ? { confirmacion: MENSAJE_CONFIRMACION_VACIA }
      : confirmacion !== nueva && { confirmacion: MENSAJE_CONFIRMACION_DISTINTA }),
  };
  if (!resultado.success || errores.confirmacion !== undefined) {
    return { valido: false, errores };
  }
  return { valido: true, datos: resultado.data };
}
