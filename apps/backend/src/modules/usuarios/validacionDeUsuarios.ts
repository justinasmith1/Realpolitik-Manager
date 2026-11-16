// Validación de los datos de la administración de usuarios (HU4.5). Es la del dominio: la API valida
// antes con los schemas de `@realpolitik/shared`, pero el servicio no confía en que lo haya hecho.
//
// Las reglas de cada campo son las de shared (una sola definición para la API, el dominio y la
// pantalla):
// - Nombre (`NombreDeUsuarioSchema`): obligatorio, sin espacios en los bordes, hasta 150 caracteres
//   (puntos de código, como cuenta PostgreSQL el `VarChar(150)`), sin caracteres de control ni
//   texto Unicode mal formado. Son las mismas reglas que el alta del primer administrador
//   (`auth/primerAdministrador.ts`), que no se modifica.
// - Email (`EmailDeUsuarioSchema`): el del inicio de sesión: sin espacios en los bordes, en
//   minúsculas y con formato válido. Lo que se guarda es lo que el login busca.
// - Rol (`RolDeUsuarioSchema`): uno de los tres de `RolUsuario`. Nada más.
// - Edición: solo `nombre` y `rol`. Cualquier otra clave (email, contraseña, estado, fechas…) es un
//   error de validación, no se ignora en silencio: esas propiedades tienen su propia operación o no
//   se modifican en HU4.5.
//
// Ningún mensaje repite el valor recibido.

import {
  BusquedaDeUsuariosSchema,
  EmailDeUsuarioSchema,
  NombreDeUsuarioSchema,
  RolDeUsuarioSchema,
  type RolUsuarioType,
} from '@realpolitik/shared';
import { z } from 'zod';

export type CampoDeUsuario =
  'nombre' | 'email' | 'rol' | 'activo' | 'busqueda' | 'incluirDesactivados';

export interface ErrorDeCampo {
  /** El campo del pedido. Para una clave que no se puede modificar, esa misma clave. */
  campo: CampoDeUsuario | (string & {});
  mensaje: string;
}

export const MENSAJE_CAMPO_NO_MODIFICABLE = 'Este dato no se puede modificar.';
export const MENSAJE_SIN_CAMBIOS = 'Enviá el nombre o el rol para modificar.';

const UsuarioNuevoSchema = z.object({
  nombre: NombreDeUsuarioSchema,
  email: EmailDeUsuarioSchema,
  rol: RolDeUsuarioSchema,
});

const CambiosSchema = z
  .object({ nombre: NombreDeUsuarioSchema.optional(), rol: RolDeUsuarioSchema.optional() })
  .strict();

const FiltrosSchema = z
  .object({
    busqueda: BusquedaDeUsuariosSchema.optional(),
    rol: RolDeUsuarioSchema.optional(),
    incluirDesactivados: z
      .boolean({ invalid_type_error: 'Indicá si se incluyen los desactivados.' })
      .optional(),
  })
  .strict();

export type ResultadoDeValidacion<T> =
  { ok: true; datos: T } | { ok: false; errores: ErrorDeCampo[] };

/** Un error por campo (el primero), en el orden en que Zod los informa. Sin repetir valores. */
function erroresDe(error: z.ZodError): ErrorDeCampo[] {
  const errores: ErrorDeCampo[] = [];
  const vistos = new Set<string>();
  const agregar = (campo: string, mensaje: string) => {
    if (vistos.has(campo)) return;
    vistos.add(campo);
    errores.push({ campo, mensaje });
  };
  for (const issue of error.issues) {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      for (const clave of issue.keys) agregar(clave, MENSAJE_CAMPO_NO_MODIFICABLE);
    } else {
      agregar(String(issue.path[0] ?? ''), issue.message);
    }
  }
  return errores;
}

function validar<T>(schema: z.ZodType<T>, datos: unknown): ResultadoDeValidacion<T> {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    return { ok: false, errores: [{ campo: '', mensaje: 'Los datos enviados no son válidos.' }] };
  }
  const resultado = schema.safeParse(datos);
  return resultado.success
    ? { ok: true, datos: resultado.data }
    : { ok: false, errores: erroresDe(resultado.error) };
}

export interface UsuarioNuevoValidado {
  nombre: string;
  email: string;
  rol: RolUsuarioType;
}

/** Nombre, email y rol de una cuenta nueva, normalizados. */
export function validarUsuarioNuevo(datos: unknown): ResultadoDeValidacion<UsuarioNuevoValidado> {
  return validar(UsuarioNuevoSchema, datos);
}

export interface CambiosValidados {
  nombre?: string | undefined;
  rol?: RolUsuarioType | undefined;
}

/** Los cambios de una edición: solo `nombre` y `rol`, al menos uno. */
export function validarCambiosDeUsuario(cambios: unknown): ResultadoDeValidacion<CambiosValidados> {
  const resultado = validar(CambiosSchema, cambios);
  if (resultado.ok && resultado.datos.nombre === undefined && resultado.datos.rol === undefined) {
    return { ok: false, errores: [{ campo: '', mensaje: MENSAJE_SIN_CAMBIOS }] };
  }
  return resultado;
}

export interface FiltrosValidados {
  /** Texto recortado; `undefined` si no se busca (también si llegó vacío). */
  busqueda?: string;
  rol?: RolUsuarioType;
  incluirDesactivados: boolean;
}

/** Filtros del listado. Sin filtros: todas las cuentas activas. */
export function validarFiltrosDeUsuarios(
  filtros: unknown = {},
): ResultadoDeValidacion<FiltrosValidados> {
  const resultado = validar(FiltrosSchema, filtros);
  if (!resultado.ok) return resultado;
  const { busqueda, rol, incluirDesactivados = false } = resultado.datos;
  return {
    ok: true,
    datos: {
      ...(busqueda ? { busqueda } : {}),
      ...(rol ? { rol } : {}),
      incluirDesactivados,
    },
  };
}
