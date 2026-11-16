import { z } from 'zod';

import {
  booleanoDeQuery,
  emailNormalizado,
  exigirAlgunCampo,
  sinCaracteresDeControl,
} from './campos.js';

// ─── Usuarios y acceso (épica 4, ADR-0006) ────────────────────────────────────

/**
 * Rol fijo de negocio (aprobado). Isomorfo con el enum `RolUsuario` de Prisma. No depende del área
 * de la persona: el modelo no tiene un campo de área que influya en los permisos.
 * - `ADMINISTRADOR`: todo lo operativo y la administración de usuarios.
 * - `ADMINISTRATIVO`: todo lo operativo.
 * - `CONSULTA`: lectura de todo, sin modificar datos.
 */
export const RolUsuario = z.enum(['ADMINISTRADOR', 'ADMINISTRATIVO', 'CONSULTA']);

export type RolUsuario = z.infer<typeof RolUsuario>;

// ─── Política de contraseñas (ADR-0006 §2) ────────────────────────────────────
//
// Una sola definición para el frontend (validación mientras se escribe) y el backend (la que
// decide). La lista de contraseñas comunes y las palabras del contexto viven solo en el backend.
//
// Cómo se cuenta: puntos de código Unicode después de normalizar a NFC, igual que el hash
// (apps/backend/src/modules/auth/contrasenas.ts). "é" cuenta 1 aunque se escriba descompuesta,
// y un emoji como 🔑 cuenta 1 aunque ocupe dos unidades UTF-16. Los emojis compuestos (por
// ejemplo, una familia o una bandera) cuentan varios puntos de código.
//
// Lo que NO se hace: recortar espacios (`trim`), truncar, ni exigir mayúsculas, números o
// símbolos. Los espacios y cualquier carácter imprimible Unicode valen.

/**
 * Largo mínimo de una contraseña elegida por la persona: **8, decidido por el usuario** (P5; la
 * propuesta técnica era 15, por ser la contraseña el único factor de autenticación, NIST SP
 * 800-63B-4: con 8 la defensa contra contraseñas previsibles descansa en la lista de bloqueo, la
 * demora por cuenta y el contexto). Cambiarlo no exige migración, pero sí regenerar la lista de
 * contraseñas comunes (`apps/backend/scripts/generar-lista-contrasenas-comunes.mjs`): su test lo
 * exige.
 */
export const CONTRASENA_LARGO_MINIMO = 8;

/**
 * Largo máximo de una contraseña, en puntos de código Unicode después de normalizar a NFC. Se
 * rechaza más antes de calcular un hash. Es un tope técnico (ADR-0006 §2); cumple con permitir al
 * menos 64.
 */
export const CONTRASENA_LARGO_MAXIMO = 128;

export const MENSAJE_CONTRASENA_CORTA = `La contraseña tiene que tener al menos ${CONTRASENA_LARGO_MINIMO} caracteres.`;
export const MENSAJE_CONTRASENA_LARGA = `La contraseña puede tener como máximo ${CONTRASENA_LARGO_MAXIMO} caracteres.`;
export const MENSAJE_CONTRASENA_CARACTERES =
  'La contraseña tiene caracteres que no se pueden usar, como saltos de línea o tabulaciones.';
/** Un solo mensaje para la lista de bloqueo, el contexto y los patrones: no dice qué regla falló. */
export const MENSAJE_CONTRASENA_PREVISIBLE =
  'Esa contraseña es muy común o fácil de adivinar. Elegí otra.';

/**
 * Cantidad de caracteres de una contraseña tal como la cuenta la política: puntos de código
 * después de NFC. Sirve también para el contador de la interfaz.
 */
export function contarCaracteresDeContrasena(contrasena: string): number {
  return [...contrasena.normalize('NFC')].length;
}

/**
 * `false` si el texto tiene sustitutos UTF-16 sueltos (una mitad de un emoji, por ejemplo). Al
 * pasarlo a bytes se convierten en U+FFFD, así que dos contraseñas distintas darían el mismo hash.
 */
export function esUnicodeBienFormado(texto: string): boolean {
  return !/\p{Cs}/u.test(texto);
}

/**
 * Contraseña NUEVA (la que una persona elige): caracteres válidos y largo. No transforma el valor:
 * devuelve exactamente lo que recibió. Informa un solo problema, el primero, para no repetir
 * mensajes. Ningún mensaje incluye la contraseña.
 *
 * No incluye la lista de contraseñas comunes ni las palabras del contexto: las agrega el backend.
 * Para verificar una contraseña existente no se usa este schema (ver `verificarContrasena`).
 */
export const ContrasenaNuevaSchema = z.string().superRefine((contrasena, ctx) => {
  if (!esUnicodeBienFormado(contrasena) || !sinCaracteresDeControl(contrasena)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_CONTRASENA_CARACTERES });
    return;
  }
  const largo = contarCaracteresDeContrasena(contrasena);
  if (largo < CONTRASENA_LARGO_MINIMO) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_CONTRASENA_CORTA });
  } else if (largo > CONTRASENA_LARGO_MAXIMO) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_CONTRASENA_LARGA });
  }
});

// ─── Inicio de sesión y sesión actual (HU4.1, ADR-0006) ──────────────────────

/**
 * Cuerpo de `POST /auth/login`. El email se normaliza como en el resto del sistema (sin espacios
 * en los bordes y en minúsculas). La contraseña NO se recorta ni se valida contra la política de
 * contraseñas nuevas: se verifica tal como llega (las temporales y las anteriores a un cambio de
 * política tienen que seguir sirviendo). Solo se exige que no esté vacía y que no supere el máximo,
 * para no calcular un hash de una entrada imposible.
 */
/**
 * Una contraseña EXISTENTE, para verificarla: no vacía y sin superar el máximo (no se calcula un hash
 * de una entrada imposible). No se recorta ni pasa por la política de contraseñas nuevas.
 */
const contrasenaAVerificar = (vacia: string) =>
  z
    .string({ required_error: vacia })
    .min(1, { message: vacia })
    .refine((valor) => contarCaracteresDeContrasena(valor) <= CONTRASENA_LARGO_MAXIMO, {
      message: MENSAJE_CONTRASENA_LARGA,
    });

export const IniciarSesionSchema = z.object({
  email: emailNormalizado({
    formato: 'Ingresá un email válido.',
    largo: 'El email es demasiado largo.',
  }),
  password: contrasenaAVerificar('Ingresá la contraseña.'),
});

export type IniciarSesionDto = z.infer<typeof IniciarSesionSchema>;

export const MENSAJE_CONTRASENA_REPETIDA =
  'La contraseña nueva tiene que ser distinta de la actual.';

/**
 * Cuerpo de `PUT /auth/password` (cambio de la propia contraseña; obligatorio en el primer acceso).
 * `actual` se verifica tal como llega, igual que en el login. `nueva` pasa por la política de
 * contraseñas nuevas (acá el formato y el largo; la lista de bloqueo y el contexto, en el backend) y
 * no puede ser la actual: se comparan después de NFC, como las compara el hash.
 */
export const CambiarContrasenaSchema = z
  .object({
    actual: contrasenaAVerificar('Ingresá tu contraseña actual.'),
    nueva: ContrasenaNuevaSchema,
  })
  .refine(({ actual, nueva }) => actual.normalize('NFC') !== nueva.normalize('NFC'), {
    message: MENSAJE_CONTRASENA_REPETIDA,
    path: ['nueva'],
  });

export type CambiarContrasenaDto = z.infer<typeof CambiarContrasenaSchema>;

/**
 * Datos públicos de la persona con sesión, leídos del servidor en cada consulta (nunca de lo que
 * guardó el navegador). Sin hash, tokens, ids de sesión ni contadores. Los permisos se suman con la
 * infraestructura de permisos (HU4.3 o HU4.5).
 */
export const UsuarioDeSesionSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  nombre: z.string(),
  rol: RolUsuario,
  /** Contraseña temporal sin cambiar: solo `/auth/*` responde hasta cambiarla. */
  debeCambiarPassword: z.boolean(),
});

export type UsuarioDeSesion = z.infer<typeof UsuarioDeSesionSchema>;

/** Respuesta de `POST /auth/login` y de `GET /auth/sesion`. */
export const SesionActualSchema = z.object({ usuario: UsuarioDeSesionSchema });

export type SesionActual = z.infer<typeof SesionActualSchema>;

// ─── Administración de usuarios (HU4.5, ADR-0006 §5) ─────────────────────────
//
// Las reglas de cada campo viven acá una sola vez: las usan la API (`/usuarios`), el dominio del
// backend (`modules/usuarios/validacionDeUsuarios.ts`, que no confía en que la API haya validado)
// y la pantalla de administración. Las reglas de negocio (email único, autoprotección, último
// administrador) son del backend.
//
// A diferencia de otros cuerpos de la API, una clave que no corresponde NO se descarta: es un
// error de validación en esa clave. Descartar en silencio una `password` o un `activo` le haría
// creer a quien administra que eligió una contraseña o un estado.

/** Largo máximo del nombre de una persona: el `VarChar(150)` de la columna. */
export const NOMBRE_USUARIO_MAX = 150;

/** Largo máximo de la búsqueda del listado de usuarios (el del nombre). */
export const MAX_BUSQUEDA_USUARIOS = 150;

export const MENSAJE_NOMBRE_USUARIO_VACIO = 'Ingresá el nombre.';
export const MENSAJE_NOMBRE_USUARIO_LARGO = `El nombre puede tener como máximo ${NOMBRE_USUARIO_MAX} caracteres.`;
export const MENSAJE_NOMBRE_USUARIO_CARACTERES =
  'El nombre tiene caracteres que no se pueden usar.';
export const MENSAJE_EMAIL_USUARIO_VACIO = 'Ingresá el email.';
export const MENSAJE_ROL_INVALIDO = 'Elegí un rol válido.';
export const MENSAJE_DATO_NO_PERMITIDO = 'Este dato no se puede enviar.';

/**
 * Nombre de una persona: obligatorio, sin espacios en los bordes, hasta `NOMBRE_USUARIO_MAX`
 * caracteres (puntos de código, como cuenta PostgreSQL) y sin caracteres de control ni texto
 * Unicode mal formado. Un solo mensaje, el del primer problema.
 */
export const NombreDeUsuarioSchema = z
  .string({
    required_error: MENSAJE_NOMBRE_USUARIO_VACIO,
    invalid_type_error: MENSAJE_NOMBRE_USUARIO_VACIO,
  })
  .trim()
  .superRefine((nombre, ctx) => {
    const mensaje =
      nombre === ''
        ? MENSAJE_NOMBRE_USUARIO_VACIO
        : !esUnicodeBienFormado(nombre) || !sinCaracteresDeControl(nombre)
          ? MENSAJE_NOMBRE_USUARIO_CARACTERES
          : [...nombre].length > NOMBRE_USUARIO_MAX
            ? MENSAJE_NOMBRE_USUARIO_LARGO
            : null;
    if (mensaje !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensaje });
  });

/** Email de una cuenta: el mismo que acepta y normaliza el inicio de sesión. */
export const EmailDeUsuarioSchema = z
  .string({
    required_error: MENSAJE_EMAIL_USUARIO_VACIO,
    invalid_type_error: MENSAJE_EMAIL_USUARIO_VACIO,
  })
  .pipe(IniciarSesionSchema.shape.email);

/** Uno de los tres roles; cualquier otro valor (también en minúsculas) es inválido. */
export const RolDeUsuarioSchema = z.enum(RolUsuario.options, {
  errorMap: () => ({ message: MENSAJE_ROL_INVALIDO }),
});

/** Búsqueda del listado: recortada, hasta `MAX_BUSQUEDA_USUARIOS`, sin caracteres de control. */
export const BusquedaDeUsuariosSchema = z
  .string({ invalid_type_error: 'La búsqueda debe ser un texto.' })
  .trim()
  .max(MAX_BUSQUEDA_USUARIOS, {
    message: `La búsqueda puede tener como máximo ${MAX_BUSQUEDA_USUARIOS} caracteres.`,
  })
  .refine((texto) => esUnicodeBienFormado(texto) && sinCaracteresDeControl(texto), {
    message: 'La búsqueda tiene caracteres que no se pueden usar.',
  });

/**
 * Un objeto con exactamente las claves de `shape`: cada clave de más es un error en esa clave
 * (`MENSAJE_DATO_NO_PERMITIDO`), informado junto con los errores de los demás campos.
 */
function soloEstosCampos<T extends z.ZodRawShape>(shape: T) {
  const permitidos = new Set(Object.keys(shape));
  return z.preprocess((datos, ctx) => {
    if (typeof datos === 'object' && datos !== null && !Array.isArray(datos)) {
      for (const clave of Object.keys(datos)) {
        if (!permitidos.has(clave)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [clave],
            message: MENSAJE_DATO_NO_PERMITIDO,
          });
        }
      }
    }
    return datos;
  }, z.object(shape));
}

/**
 * Parámetros de `GET /usuarios` (query string).
 * - `q`: busca en el nombre y el email, sin distinguir mayúsculas; vacío equivale a no enviarlo.
 * - `rol`: uno de los tres roles.
 * - `incluirDesactivados`: `'true'` o `'false'`; sin el parámetro, solo las cuentas activas.
 */
export const ListarUsuariosQuerySchema = z.object({
  q: BusquedaDeUsuariosSchema.optional().transform((valor) => (valor === '' ? undefined : valor)),
  rol: RolDeUsuarioSchema.optional(),
  incluirDesactivados: booleanoDeQuery('incluirDesactivados')
    .optional()
    .transform((valor) => valor ?? false),
});

export type ListarUsuariosQuery = z.infer<typeof ListarUsuariosQuerySchema>;

/**
 * Cuerpo de `POST /usuarios`. La contraseña temporal la genera el servidor: una `password` (o
 * `activo`, `debeCambiarPassword`, `id`…) es un error.
 */
export const CrearUsuarioSchema = soloEstosCampos({
  nombre: NombreDeUsuarioSchema,
  email: EmailDeUsuarioSchema,
  rol: RolDeUsuarioSchema,
});

export type CrearUsuarioDto = z.infer<typeof CrearUsuarioSchema>;

/**
 * Cuerpo de `PATCH /usuarios/:id`: `nombre` y/o `rol`, al menos uno. El email no se modifica en
 * HU4.5; el estado y la contraseña tienen su propia ruta.
 */
export const ActualizarUsuarioSchema = soloEstosCampos({
  nombre: NombreDeUsuarioSchema.optional(),
  rol: RolDeUsuarioSchema.optional(),
}).superRefine(exigirAlgunCampo);

export type ActualizarUsuarioDto = z.infer<typeof ActualizarUsuarioSchema>;

/** Cuerpo de `PATCH /usuarios/:id/estado`: `activo` obligatorio y booleano (nunca un texto). */
export const ActualizarEstadoUsuarioSchema = soloEstosCampos({
  activo: z.boolean({
    required_error: 'Indicá si la cuenta queda activa o desactivada.',
    invalid_type_error: 'activo debe ser true o false.',
  }),
});

export type ActualizarEstadoUsuarioDto = z.infer<typeof ActualizarEstadoUsuarioSchema>;

/**
 * Cuerpo de `POST /usuarios/:id/restablecer-password`: ninguno. Sin cuerpo o `{}`; cualquier clave
 * (una contraseña elegida, un actor) es un error.
 */
export const RestablecerContrasenaSchema = soloEstosCampos({}).optional();

/** Una cuenta tal como la ve la administración. Nunca hash, sesiones ni contadores. */
export const UsuarioAdministradoSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string(),
  email: z.string(),
  rol: RolUsuario,
  activo: z.boolean(),
  /** Contraseña temporal sin cambiar (cuenta nueva o restablecida). */
  debeCambiarPassword: z.boolean(),
  ultimoAccesoEn: z.coerce.date().nullable(),
});

export type UsuarioAdministrado = z.infer<typeof UsuarioAdministradoSchema>;

/**
 * Respuesta de `POST /usuarios` (201). `contrasenaTemporal` está solo acá, una vez, y solo si el
 * alta quedó confirmada: ninguna otra respuesta la vuelve a dar.
 */
export const UsuarioCreadoSchema = z.object({
  usuario: UsuarioAdministradoSchema,
  contrasenaTemporal: z.string(),
});

export type UsuarioCreado = z.infer<typeof UsuarioCreadoSchema>;

/**
 * Respuesta de `PATCH /usuarios/:id`. `modificados` dice qué cambió de verdad (vacío: nada era
 * distinto y no se escribió); solo un cambio de rol revoca sesiones.
 */
export const UsuarioModificadoSchema = z.object({
  usuario: UsuarioAdministradoSchema,
  modificados: z.array(z.enum(['nombre', 'rol'])),
  sesionesRevocadas: z.number().int().nonnegative(),
});

export type UsuarioModificado = z.infer<typeof UsuarioModificadoSchema>;

/**
 * Respuesta de `PATCH /usuarios/:id/estado`. `cambio: false`: la cuenta ya estaba en ese estado y
 * no se escribió nada.
 */
export const EstadoDeUsuarioCambiadoSchema = z.object({
  usuario: UsuarioAdministradoSchema,
  cambio: z.boolean(),
  sesionesRevocadas: z.number().int().nonnegative(),
});

export type EstadoDeUsuarioCambiado = z.infer<typeof EstadoDeUsuarioCambiadoSchema>;

/** Respuesta de `POST /usuarios/:id/restablecer-password`: la contraseña temporal nueva, una vez. */
export const ContrasenaRestablecidaSchema = z.object({
  usuario: UsuarioAdministradoSchema,
  contrasenaTemporal: z.string(),
  sesionesRevocadas: z.number().int().nonnegative(),
});

export type ContrasenaRestablecida = z.infer<typeof ContrasenaRestablecidaSchema>;
