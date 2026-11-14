// Estado de la sesión: una única fuente de verdad, la caché de TanStack Query bajo `['sesion']`.
//
// | Estado            | En la caché                                   |
// | ----------------- | --------------------------------------------- |
// | Inicializando     | query pendiente (`GET /auth/sesion` en curso) |
// | Autenticado       | `data` = `{ usuario }` que respondió el servidor |
// | No autenticado    | `data` = `null` (401 confirmado, logout, cambio obligatorio) |
// | Error temporal    | query en error (503, red): la sesión NO se da por terminada |
//
// El usuario nunca se guarda en `localStorage` ni en otro lado: al recargar se le vuelve a
// preguntar al servidor, que es el único que sabe si la cookie sigue valiendo (y cuándo vence).
//
// Un 401 de cualquier pedido no termina la sesión en el acto: se le pregunta al servidor
// (`confirmarSesion`). El cambio voluntario de contraseña rota la cookie (HU4.2), y un pedido que
// salió antes con el token anterior, en esta pestaña o en otra, puede responder 401 después; si la
// cookie actual vale, ese 401 era atrasado y la sesión sigue. No hay otro estado de autenticación
// en paralelo: lo que se coordina acá (la confirmación en curso, las rotaciones) es transitorio.

import type { SesionActual } from '@realpolitik/shared';
import type { Query, QueryClient } from '@tanstack/react-query';

import { consultarSesionActual, type ConsultaDeSesion } from '@/modules/auth/api/auth.api';

/** Una consulta cualquiera de la caché, como la entrega `QueryCache.onError`. */
export type ConsultaDeLaCache = Query<unknown, unknown, unknown>;

export const CLAVE_SESION = ['sesion'] as const;
/** Por qué terminó la última sesión de esta pestaña; lo consume la navegación a `/login`. */
const CLAVE_SALIDA = ['sesion', 'motivo-de-salida'] as const;
/** La mutation del cambio voluntario de contraseña: mientras está en curso, la cookie rota. */
export const CLAVE_CAMBIO_DE_CONTRASENA = ['sesion', 'cambiar-contrasena'] as const;

/** Las queries y mutations de sesión se manejan a sí mismas: el manejo global las saltea. */
export const META_DE_SESION = { esDeSesion: true } as const;

/**
 * Cuánto se da por buena la sesión sin volver a preguntar al recuperar el foco de la pestaña o la
 * conexión. Cada pedido a la API la valida igual; esto solo sirve para enterarse de un cierre en
 * otra pestaña u otro equipo sin esperar al próximo pedido. Sin polling: solo con esos eventos.
 */
export const REVALIDACION_DE_SESION_MS = 60_000;

/**
 * Motivos que `/login` sabe explicar (`?motivo=`). Solo presentación: uno desconocido no muestra
 * nada.
 */
export type MotivoDeSalida = 'vencida' | 'terminada' | 'cerrada' | 'contrasena';

/** Cómo terminó la sesión. `sinGuardar`: un envío de formulario no llegó a confirmarse. */
interface SalidaDeSesion {
  motivo: MotivoDeSalida;
  sinGuardar: boolean;
}

/** La salida que deja un 401: por vencimiento o por cualquier otra causa (revocada, inexistente). */
export interface SalidaPorRechazo {
  motivo: 'vencida' | 'terminada';
  sinGuardar: boolean;
}

export function opcionesDeSesion(queryClient: QueryClient) {
  return {
    queryKey: CLAVE_SESION,
    queryFn: ({ signal }: { signal: AbortSignal }) => consultarSesion(queryClient, signal),
    staleTime: REVALIDACION_DE_SESION_MS,
    gcTime: Infinity,
    // Al volver a la pestaña o recuperar la red, si pasó `REVALIDACION_DE_SESION_MS`. Un error
    // temporal en esa consulta deja la sesión que había (la query queda en error con sus datos).
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Cada componente que mira la sesión no la vuelve a pedir al montarse.
    refetchOnMount: false,
    meta: META_DE_SESION,
  };
}

// ─── Rotación de la cookie (cambio voluntario de contraseña) ─────────────────

/** Cuántos cambios voluntarios empezaron en esta pestaña (por QueryClient). */
const rotaciones = new WeakMap<QueryClient, number>();
const rotacionesDe = (queryClient: QueryClient) => rotaciones.get(queryClient) ?? 0;

/** Lo llama el cambio voluntario de contraseña al empezar: la cookie del navegador va a rotar. */
export function marcarRotacion(queryClient: QueryClient): void {
  rotaciones.set(queryClient, rotacionesDe(queryClient) + 1);
}

/** Espera a que no quede ningún cambio voluntario de contraseña en curso en esta pestaña. */
function esperarRotaciones(queryClient: QueryClient): Promise<void> {
  const enCurso = () => queryClient.isMutating({ mutationKey: CLAVE_CAMBIO_DE_CONTRASENA }) > 0;
  if (!enCurso()) {
    return Promise.resolve();
  }
  return new Promise((resolver) => {
    const dejar = queryClient.getMutationCache().subscribe(() => {
      if (!enCurso()) {
        dejar();
        resolver();
      }
    });
  });
}

/**
 * `GET /auth/sesion` sin confundir una rotación con una pérdida: primero espera a que termine
 * cualquier cambio voluntario de contraseña en curso (la cookie está por cambiar) y, si sin
 * sesión y mientras se preguntaba empezó otro, vuelve a preguntar: esa respuesta pudo salir con
 * el token anterior.
 */
async function consultarSinRotacion(
  queryClient: QueryClient,
  signal?: AbortSignal,
): Promise<ConsultaDeSesion> {
  for (let intento = 1; ; intento += 1) {
    await esperarRotaciones(queryClient);
    const rotacion = rotacionesDe(queryClient);
    const respuesta = await consultarSesionActual(signal);
    if (respuesta.sesion !== null || rotacionesDe(queryClient) === rotacion || intento === 3) {
      return respuesta;
    }
  }
}

// ─── Estado ──────────────────────────────────────────────────────────────────

/**
 * La query de sesión. Si el servidor dice que no hay sesión:
 * - y en esta pestaña la había, terminó en otro lado (logout en otra pestaña, cambio de contraseña
 *   en otro equipo, vencimiento): se descartan los datos y `/login` dice si venció o terminó;
 * - y no la había (primera carga), solo se avisa si venció: había una cookie en este navegador.
 *   Quien entra por primera vez, o sin cookie, no ve ningún aviso.
 */
async function consultarSesion(
  queryClient: QueryClient,
  signal: AbortSignal,
): Promise<SesionActual | null> {
  const anterior = queryClient.getQueryData<SesionActual | null>(CLAVE_SESION);
  const respuesta = await consultarSinRotacion(queryClient, signal);
  if (respuesta.sesion !== null) {
    if (anterior && anterior.usuario.id !== respuesta.sesion.usuario.id) {
      // Otra cuenta entró en otra pestaña: nada de la anterior queda en memoria.
      descartarDatos(queryClient);
    }
    return respuesta.sesion;
  }
  if (anterior) {
    registrarSalida(queryClient, {
      motivo: respuesta.vencida ? 'vencida' : 'terminada',
      sinGuardar: false,
    });
    descartarDatos(queryClient);
  } else if (respuesta.vencida) {
    registrarSalida(queryClient, { motivo: 'vencida', sinGuardar: false });
  }
  return null;
}

/** Guarda el motivo de salida, sin pisar uno que ya esté (el primero es el que vale). */
function registrarSalida(queryClient: QueryClient, salida: SalidaDeSesion): void {
  if (queryClient.getQueryData(CLAVE_SALIDA) === undefined) {
    queryClient.setQueryData(CLAVE_SALIDA, salida);
  }
}

/** Deja la sesión que respondió el servidor; si es de otra cuenta, descarta lo de la anterior. */
function aplicarSesion(queryClient: QueryClient, sesion: SesionActual): void {
  const anterior = queryClient.getQueryData<SesionActual | null>(CLAVE_SESION);
  if (anterior && anterior.usuario.id !== sesion.usuario.id) {
    descartarDatos(queryClient);
  }
  queryClient.setQueryData(CLAVE_SESION, sesion);
}

/** Deja la sesión que respondió el servidor (login correcto, sesión rotada). */
export function establecerSesion(queryClient: QueryClient, sesion: SesionActual): void {
  queryClient.removeQueries({ queryKey: CLAVE_SALIDA });
  aplicarSesion(queryClient, sesion);
}

/** Descarta todo lo que se trajo con la sesión: nada de lo anterior queda en memoria. */
function descartarDatos(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== CLAVE_SESION[0] });
  queryClient.getMutationCache().clear();
}

/**
 * La sesión terminó (401 confirmado, logout confirmado, cambio obligatorio): estado "no
 * autenticado" y sin datos en memoria. La guarda de rutas reacciona y lleva a `/login`.
 */
export function terminarSesion(
  queryClient: QueryClient,
  motivo?: MotivoDeSalida,
  { sinGuardar = false }: { sinGuardar?: boolean } = {},
): void {
  void queryClient.cancelQueries({ queryKey: CLAVE_SESION, exact: true });
  if (motivo === undefined) {
    queryClient.removeQueries({ queryKey: CLAVE_SALIDA });
  } else {
    queryClient.setQueryData<SalidaDeSesion>(CLAVE_SALIDA, { motivo, sinGuardar });
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

// ─── Confirmación de un 401 ──────────────────────────────────────────────────

interface Confirmacion {
  salida: SalidaPorRechazo;
  /** Consultas que fallaron con 401 mientras tanto: si la sesión sigue, se vuelven a pedir. */
  consultas: Set<ConsultaDeLaCache>;
  promesa: Promise<boolean>;
}

/** La confirmación en curso, una por QueryClient: varios 401 a la vez comparten la misma. */
const confirmaciones = new WeakMap<QueryClient, Confirmacion>();

/**
 * Por consulta, cuántas veces había traído datos cuando se la volvió a pedir tras un 401 que
 * resultó atrasado. Si vuelve a dar 401 sin haber traído nada desde entonces, ese 401 no era
 * atrasado (el servidor la rechaza con una sesión válida): no se insiste, sin bucles.
 */
const reintentadas = new WeakMap<ConsultaDeLaCache, number>();

function volverAPedir(queryClient: QueryClient, consulta: ConsultaDeLaCache): void {
  if (reintentadas.get(consulta) === consulta.state.dataUpdateCount) {
    return;
  }
  reintentadas.set(consulta, consulta.state.dataUpdateCount);
  void queryClient.invalidateQueries({ queryKey: consulta.queryKey, exact: true });
}

async function resolverConfirmacion(
  queryClient: QueryClient,
  confirmacion: Confirmacion,
): Promise<boolean> {
  let respuesta: ConsultaDeSesion;
  try {
    respuesta = await consultarSinRotacion(queryClient);
  } catch {
    // Sin respuesta del servidor (503, red) no se sabe si terminó: una falla de infraestructura no
    // es una pérdida de sesión, y el 401 pudo ser atrasado. La sesión local sigue; no da acceso a
    // nada (la API rechaza por su cuenta) y el próximo 401 vuelve a preguntar.
    return true;
  } finally {
    confirmaciones.delete(queryClient);
  }

  if (respuesta.sesion) {
    aplicarSesion(queryClient, respuesta.sesion);
    for (const consulta of confirmacion.consultas) {
      volverAPedir(queryClient, consulta);
    }
    return true;
  }
  // Ya sin sesión (otro camino la terminó primero): no se pisa el motivo ni se repite el trabajo.
  if (queryClient.getQueryData(CLAVE_SESION) !== null) {
    const { motivo, sinGuardar } = confirmacion.salida;
    // El 401 de un vencimiento borra la cookie: la confirmación puede responder "sin sesión" a
    // secas. El motivo original no se pisa; solo se suma el vencimiento si el servidor lo dice.
    terminarSesion(queryClient, respuesta.vencida ? 'vencida' : motivo, { sinGuardar });
  }
  return false;
}

/**
 * Un pedido respondió 401. Antes de dar la sesión por terminada se le pregunta al servidor con la
 * cookie actual (esperando a que termine un cambio de contraseña en curso):
 * - si la sesión vale, el 401 era de un pedido que salió con el token anterior a una rotación: la
 *   sesión sigue y la consulta que falló (si la hay) se vuelve a pedir;
 * - si no, termina UNA vez, con el motivo del primer 401 (más el vencimiento si alguno lo dijo) y
 *   `sinGuardar` si algún envío de formulario quedó sin confirmar.
 *
 * Si la confirmación no tiene respuesta (503, red), la sesión no se da por terminada.
 *
 * Varios 401 a la vez comparten la misma confirmación: un solo `GET /auth/sesion`, una sola
 * limpieza y una sola navegación (la de la guarda, que conserva la ruta en `volverA`). Devuelve si
 * la sesión sigue (o no se pudo saber).
 */
export function confirmarSesion(
  queryClient: QueryClient,
  salida: SalidaPorRechazo,
  consulta?: ConsultaDeLaCache,
): Promise<boolean> {
  const enCurso = confirmaciones.get(queryClient);
  if (enCurso) {
    enCurso.salida = {
      motivo: enCurso.salida.motivo === 'vencida' ? 'vencida' : salida.motivo,
      sinGuardar: enCurso.salida.sinGuardar || salida.sinGuardar,
    };
    if (consulta) {
      enCurso.consultas.add(consulta);
    }
    return enCurso.promesa;
  }
  const confirmacion: Confirmacion = {
    salida,
    consultas: new Set(consulta ? [consulta] : []),
    promesa: Promise.resolve(false),
  };
  confirmaciones.set(queryClient, confirmacion);
  confirmacion.promesa = resolverConfirmacion(queryClient, confirmacion);
  return confirmacion.promesa;
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

/**
 * `/login`, con el motivo de la salida (si lo hay), `sinGuardar=1` si un envío quedó sin
 * confirmar, y la ruta a la que volver (si es válida).
 */
export function urlDeLogin(queryClient: QueryClient, volverA: string | null | undefined): string {
  const salida = queryClient.getQueryData<SalidaDeSesion>(CLAVE_SALIDA);
  const destino = volverAValido(volverA);
  return conParametros(RUTA_LOGIN, {
    motivo: salida?.motivo,
    sinGuardar: salida?.sinGuardar === true ? '1' : null,
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
