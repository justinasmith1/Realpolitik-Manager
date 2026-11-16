// Endpoints de la administración de usuarios (HU4.5). Conoce el contrato de `/usuarios` (rutas,
// cuerpos, motivos de error) y valida cada respuesta con los schemas de shared, pero no produce
// texto de interfaz: eso lo deciden los componentes.
//
// Las respuestas del alta y del restablecimiento traen una contraseña temporal: estas funciones la
// devuelven a quien las llama y no la guardan en ningún lado (ver `hooks/useContrasenaTemporal`).

import {
  ContrasenaRestablecidaSchema,
  EstadoDeUsuarioCambiadoSchema,
  UsuarioAdministradoSchema,
  UsuarioCreadoSchema,
  UsuarioModificadoSchema,
  type ActualizarUsuarioDto,
  type ContrasenaRestablecida,
  type CrearUsuarioDto,
  type EstadoDeUsuarioCambiado,
  type RolUsuarioType,
  type UsuarioAdministrado,
  type UsuarioCreado,
  type UsuarioModificado,
} from '@realpolitik/shared';

import {
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  type DetalleInvalido,
} from '@/lib/errores-api';
import { ApiClientError, http } from '@/lib/http';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Prefijo de todas las queries de usuarios: cualquier escritura lo invalida. */
export const usuariosQueryKey = ['usuarios'] as const;

/** Filtros del listado, como los usa la interfaz. */
export interface FiltrosUsuarios {
  q?: string | undefined;
  rol?: RolUsuarioType | undefined;
  incluirDesactivados?: boolean | undefined;
}

/**
 * Filtros normalizados: la búsqueda recortada (vacía = sin búsqueda) y el filtro de estado como
 * booleano. Dos filtros que piden lo mismo dan la misma key y un solo pedido.
 */
function normalizar({ q, rol, incluirDesactivados }: FiltrosUsuarios = {}) {
  const busqueda = q?.trim() ?? '';
  return {
    q: busqueda === '' ? null : busqueda,
    rol: rol ?? null,
    incluirDesactivados: incluirDesactivados === true,
  };
}

export const listaUsuariosQueryKey = (filtros: FiltrosUsuarios = {}) =>
  [...usuariosQueryKey, 'lista', normalizar(filtros)] as const;

/**
 * `GET /usuarios`. Solo los parámetros que filtran: sin búsqueda, sin rol y sin desactivados no
 * viaja ninguno. El orden (por nombre y después por email) lo resuelve el backend.
 */
export async function listarUsuarios(
  filtros: FiltrosUsuarios = {},
  signal?: AbortSignal,
): Promise<UsuarioAdministrado[]> {
  const { q, rol, incluirDesactivados } = normalizar(filtros);
  const params = new URLSearchParams();
  if (q !== null) params.set('q', q);
  if (rol !== null) params.set('rol', rol);
  if (incluirDesactivados) params.set('incluirDesactivados', 'true');
  const query = params.toString();
  const response = await http(query === '' ? '/usuarios' : `/usuarios?${query}`, {
    ...(signal && { signal }),
  });
  return UsuarioAdministradoSchema.array().parse(await response.json());
}

/** `POST /usuarios`. Solo nombre, email y rol: la contraseña temporal la genera el servidor. */
export async function crearUsuario({
  nombre,
  email,
  rol,
}: CrearUsuarioDto): Promise<UsuarioCreado> {
  const response = await http('/usuarios', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ nombre, email, rol }),
  });
  return UsuarioCreadoSchema.parse(await response.json());
}

/**
 * `PATCH /usuarios/:id`. Envía solo los campos presentes en `cambios`: reenviar el rol sin
 * haberlo tocado podría pisar el que otra persona eligió mientras tanto.
 */
export async function actualizarUsuario(
  id: string,
  cambios: ActualizarUsuarioDto,
): Promise<UsuarioModificado> {
  const response = await http(`/usuarios/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(cambios),
  });
  return UsuarioModificadoSchema.parse(await response.json());
}

/** `PATCH /usuarios/:id/estado`. Desactiva (`false`) o reactiva (`true`) una cuenta. */
export async function cambiarEstadoUsuario(
  id: string,
  activo: boolean,
): Promise<EstadoDeUsuarioCambiado> {
  const response = await http(`/usuarios/${encodeURIComponent(id)}/estado`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ activo }),
  });
  return EstadoDeUsuarioCambiadoSchema.parse(await response.json());
}

/** `POST /usuarios/:id/restablecer-password`, sin cuerpo. */
export async function restablecerContrasena(id: string): Promise<ContrasenaRestablecida> {
  const response = await http(`/usuarios/${encodeURIComponent(id)}/restablecer-password`, {
    method: 'POST',
  });
  return ContrasenaRestablecidaSchema.parse(await response.json());
}

// ─── Fallos ───────────────────────────────────────────────────────────────────

/** Operaciones sobre la propia cuenta que el servidor rechaza. */
export type OperacionPropia = 'cambiar-rol' | 'desactivar' | 'restablecer-password';

/**
 * Por qué no se pudo escribir, en términos del contrato. Solo `no-confirmado` deja la duda de si
 * se guardó: todos los demás son respuestas definitivas en las que no cambió nada.
 */
export type FalloDeUsuario =
  | { tipo: 'datos-invalidos'; detalles: DetalleInvalido[] }
  | { tipo: 'email-en-uso' }
  | { tipo: 'cuenta-propia'; operacion: OperacionPropia | null }
  | { tipo: 'ultimo-administrador' }
  | { tipo: 'concurrencia' }
  | { tipo: 'no-existe' }
  | { tipo: 'sin-permiso' }
  | { tipo: 'sin-sesion' }
  /** 503 por capacidad: el servidor no llegó a escribir. Se puede reintentar enseguida. */
  | { tipo: 'ocupado' }
  /**
   * No se sabe si se guardó: `RESULTADO_NO_CONFIRMADO`, la red cayó con el pedido en vuelo, otro
   * 5xx o un 502/504 del proxy. Hay que volver a leer el listado antes de repetir.
   */
  | { tipo: 'no-confirmado' }
  /** Un rechazo que el contrato no define (otro 4xx, la configuración): no se escribió nada. */
  | { tipo: 'inesperado' };

const OPERACIONES_PROPIAS: readonly string[] = [
  'cambiar-rol',
  'desactivar',
  'restablecer-password',
] satisfies OperacionPropia[];

const motivoDe = (details: unknown) =>
  esObjeto(details) && typeof details.motivo === 'string' ? details.motivo : null;

function fallo409(details: unknown): FalloDeUsuario {
  switch (motivoDe(details)) {
    case 'EMAIL_EN_USO':
      return { tipo: 'email-en-uso' };
    case 'OPERACION_SOBRE_CUENTA_PROPIA': {
      const operacion = esObjeto(details) ? details.operacion : null;
      return {
        tipo: 'cuenta-propia',
        operacion:
          typeof operacion === 'string' && OPERACIONES_PROPIAS.includes(operacion)
            ? (operacion as OperacionPropia)
            : null,
      };
    }
    case 'ULTIMO_ADMINISTRADOR':
      return { tipo: 'ultimo-administrador' };
    case 'CONFLICTO_DE_CONCURRENCIA':
      return { tipo: 'concurrencia' };
    default:
      // Un 409 que el contrato no define: no se sabe qué pasó, pero tampoco que se haya guardado.
      return { tipo: 'inesperado' };
  }
}

/**
 * Traduce el error de cualquier escritura de usuarios. Ante la duda, `no-confirmado`: es preferible
 * pedir que se revise el listado a afirmar que no se guardó nada.
 */
export function interpretarFalloDeUsuario(error: unknown): FalloDeUsuario {
  // Sin un error HTTP, el pedido pudo llegar: la red cayó en vuelo, o el servidor respondió 2xx
  // con algo que no cumple el contrato (no se puede leer qué se guardó).
  if (!(error instanceof ApiClientError) || error.kind === 'network') {
    return { tipo: 'no-confirmado' };
  }
  if (error.kind !== 'http' || error.status === undefined) {
    return { tipo: 'inesperado' };
  }
  const cuerpo = leerCuerpoDeError(error.payload);
  const status = error.status;
  if (status >= 500) {
    const definitivo =
      status === 503 &&
      cuerpo?.code === 'SERVICE_UNAVAILABLE' &&
      motivoDe(cuerpo.details) !== 'RESULTADO_NO_CONFIRMADO';
    return definitivo ? { tipo: 'ocupado' } : { tipo: 'no-confirmado' };
  }
  switch (status) {
    case 400:
      return cuerpo?.code === 'VALIDATION_ERROR'
        ? { tipo: 'datos-invalidos', detalles: leerDetallesInvalidos(cuerpo.details) }
        : { tipo: 'inesperado' };
    case 401:
      return { tipo: 'sin-sesion' };
    case 403:
      return { tipo: 'sin-permiso' };
    case 404:
      return cuerpo?.code === 'NOT_FOUND' ? { tipo: 'no-existe' } : { tipo: 'inesperado' };
    case 409:
      return cuerpo?.code === 'CONFLICT' ? fallo409(cuerpo.details) : { tipo: 'inesperado' };
    default:
      return { tipo: 'inesperado' };
  }
}

/**
 * ¿Después de este fallo el listado puede estar mostrando algo que ya no es cierto? Sí si quizá se
 * guardó, si la cuenta ya no existe o si el servidor la ve distinta (un conflicto). No ante datos
 * inválidos, falta de capacidad o de permiso (la sesión se revalida por su cuenta).
 */
export function hayQueReleerElListado(fallo: FalloDeUsuario): boolean {
  switch (fallo.tipo) {
    case 'no-confirmado':
    case 'no-existe':
    case 'cuenta-propia':
    case 'ultimo-administrador':
    case 'concurrencia':
    case 'email-en-uso':
      return true;
    default:
      return false;
  }
}
