// Estado de la sesión: una única fuente de verdad, la caché de TanStack Query bajo `['sesion']`.
//
// | Estado            | En la caché                                   |
// | ----------------- | --------------------------------------------- |
// | Inicializando     | query pendiente (`GET /auth/sesion` en curso) |
// | Autenticado       | `data` = `{ usuario }` que respondió el servidor |
// | No autenticado    | `data` = `null` (401, logout, cambio de contraseña) |
// | Error temporal    | query en error (503, red): la sesión NO se da por terminada |
//
// El usuario nunca se guarda en `localStorage` ni en otro lado: al recargar se le vuelve a
// preguntar al servidor, que es el único que sabe si la cookie sigue valiendo.

import type { SesionActual } from '@realpolitik/shared';
import type { QueryClient } from '@tanstack/react-query';

import { obtenerSesionActual } from '@/modules/auth/api/auth.api';

export const CLAVE_SESION = ['sesion'] as const;
/** Por qué terminó la última sesión de esta pestaña; lo consume la navegación a `/login`. */
const CLAVE_MOTIVO = ['sesion', 'motivo-de-salida'] as const;

/** Las queries y mutations de sesión se manejan a sí mismas: el manejo global las saltea. */
export const META_DE_SESION = { esDeSesion: true } as const;

/**
 * Motivos que `/login` sabe explicar (`?motivo=`). Solo presentación: uno desconocido no muestra
 * nada.
 */
export type MotivoDeSalida = 'vencida' | 'terminada' | 'cerrada' | 'contrasena';

export function opcionesDeSesion() {
  return {
    queryKey: CLAVE_SESION,
    queryFn: ({ signal }: { signal: AbortSignal }) => obtenerSesionActual(signal),
    // La sesión no "envejece" sola: cada pedido a la API la valida, y un 401 la termina acá.
    staleTime: Infinity,
    gcTime: Infinity,
    meta: META_DE_SESION,
  };
}

/** Deja la sesión que respondió el servidor (login correcto). */
export function establecerSesion(queryClient: QueryClient, sesion: SesionActual): void {
  queryClient.removeQueries({ queryKey: CLAVE_MOTIVO });
  queryClient.setQueryData(CLAVE_SESION, sesion);
}

/** Descarta todo lo que se trajo con la sesión: nada de lo anterior queda en memoria. */
function descartarDatos(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== CLAVE_SESION[0] });
  queryClient.getMutationCache().clear();
}

/**
 * La sesión terminó (401, logout confirmado, cambio de contraseña): estado "no autenticado" y
 * sin datos en memoria. La guarda de rutas reacciona y lleva a `/login`.
 */
export function terminarSesion(queryClient: QueryClient, motivo?: MotivoDeSalida): void {
  void queryClient.cancelQueries({ queryKey: CLAVE_SESION, exact: true });
  if (motivo === undefined) {
    queryClient.removeQueries({ queryKey: CLAVE_MOTIVO });
  } else {
    queryClient.setQueryData(CLAVE_MOTIVO, motivo);
  }
  queryClient.setQueryData(CLAVE_SESION, null);
  descartarDatos(queryClient);
}

/**
 * La sesión sigue, pero cambió lo que puede hacer (contraseña temporal, rol): se descartan los
 * datos y se le vuelve a preguntar al servidor quién es.
 */
export function revalidarSesion(queryClient: QueryClient, { descartar = true } = {}): void {
  if (descartar) {
    descartarDatos(queryClient);
  }
  void queryClient.invalidateQueries({ queryKey: CLAVE_SESION, exact: true });
}

// ─── Navegación ──────────────────────────────────────────────────────────────

export const RUTA_LOGIN = '/login';
export const RUTA_CAMBIAR_CONTRASENA = '/cambiar-contrasena';
export const RUTA_DE_ENTRADA = '/rendiciones';

/**
 * `volverA` solo si es una ruta interna: empieza con una sola `/`, sin `//` ni `\` (que el
 * navegador trata como `/`), sin caracteres de control, y no es una pantalla de acceso. Cualquier
 * otra cosa se ignora en silencio: no hay redirecciones abiertas.
 */
export function volverAValido(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string' || !valor.startsWith('/') || valor.startsWith('//')) {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(valor)) {
    return null;
  }
  const pathname = valor.split(/[?#]/, 1)[0] ?? '';
  if (
    pathname === RUTA_LOGIN ||
    pathname === RUTA_CAMBIAR_CONTRASENA ||
    pathname.startsWith(`${RUTA_LOGIN}/`) ||
    pathname.startsWith(`${RUTA_CAMBIAR_CONTRASENA}/`)
  ) {
    return null;
  }
  return valor;
}

/** A dónde ir después de entrar: `volverA` si es válido, o la pantalla de entrada. */
export function destinoDespuesDeEntrar(volverA: string | null | undefined): string {
  return volverAValido(volverA) ?? RUTA_DE_ENTRADA;
}

function conParametros(ruta: string, parametros: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor) {
      query.set(clave, valor);
    }
  }
  const texto = query.toString();
  return texto === '' ? ruta : `${ruta}?${texto}`;
}

/** `/login`, con el motivo de la salida (si lo hay) y la ruta a la que volver (si es válida). */
export function urlDeLogin(queryClient: QueryClient, volverA: string | null | undefined): string {
  const motivo = queryClient.getQueryData<MotivoDeSalida>(CLAVE_MOTIVO);
  const destino = volverAValido(volverA);
  return conParametros(RUTA_LOGIN, {
    motivo,
    // Volver a la pantalla de entrada es lo que pasa de todos modos: no hace falta decirlo.
    volverA: destino === RUTA_DE_ENTRADA ? null : destino,
  });
}

export function urlDeCambioDeContrasena(volverA: string | null | undefined): string {
  const destino = volverAValido(volverA);
  return conParametros(RUTA_CAMBIAR_CONTRASENA, {
    volverA: destino === RUTA_DE_ENTRADA ? null : destino,
  });
}
