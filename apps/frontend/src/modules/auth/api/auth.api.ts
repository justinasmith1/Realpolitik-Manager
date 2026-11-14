// Servicio HTTP de autenticación (HU4.1, ADR-0006). Usa el mismo cliente que el resto de la app
// (`http()`, con `VITE_API_URL=/api` y el proxy de mismo origen): la cookie de sesión
// `__Host-rp_sesion` es HttpOnly, la maneja solo el navegador y acá no se lee, no se guarda y no
// se transmite a mano. No hay tokens: la única prueba de la sesión es la respuesta del servidor.
//
// Nada de estas funciones registra contraseñas ni las pone en una URL: viajan solo en el cuerpo.

import {
  SesionActualSchema,
  type CambiarContrasenaDto,
  type IniciarSesionDto,
  type SesionActual,
} from '@realpolitik/shared';

import { ApiClientError, http } from '@/lib/http';
import { clasificarErrorDeAuth } from '@/modules/auth/erroresDeAuth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function leerSesion(response: Response): Promise<SesionActual> {
  return SesionActualSchema.parse(await response.json());
}

/** `POST /auth/login`. 200 con la sesión (y la cookie); rechaza con el `ApiClientError` del fallo. */
export async function iniciarSesion(credenciales: IniciarSesionDto): Promise<SesionActual> {
  const response = await http('/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(credenciales),
  });
  return leerSesion(response);
}

/**
 * Lo que respondió `GET /auth/sesion`: la sesión, o ninguna. Sin sesión, `vencida` dice si el
 * servidor la dio por vencida (`SESION_VENCIDA`: había una cookie y se le cumplió el plazo) o no
 * (`SESION_REQUERIDA`: sin cookie, revocada o desconocida).
 */
export type ConsultaDeSesion = { sesion: SesionActual } | { sesion: null; vencida: boolean };

/**
 * `GET /auth/sesion`, con el motivo cuando no hay sesión. Un 401 es un estado esperado, no un
 * error. Un 503, la red caída o cualquier otro fallo rechazan: son errores temporales y no
 * significan que la sesión terminó.
 */
export async function consultarSesionActual(signal?: AbortSignal): Promise<ConsultaDeSesion> {
  try {
    const response = await http('/auth/sesion', signal === undefined ? {} : { signal });
    return { sesion: await leerSesion(response) };
  } catch (error) {
    if (error instanceof ApiClientError && error.kind === 'http' && error.status === 401) {
      const clasificado = clasificarErrorDeAuth(error);
      return { sesion: null, vencida: clasificado.clase === 'sin-sesion' && clasificado.vencida };
    }
    throw error;
  }
}

/** `GET /auth/sesion`: la sesión, o `null` si el servidor responde 401 (ver `consultarSesionActual`). */
export async function obtenerSesionActual(signal?: AbortSignal): Promise<SesionActual | null> {
  return (await consultarSesionActual(signal)).sesion;
}

/** `POST /auth/logout`. Resuelve solo con el 204: un 503 o la red caída rechazan. */
export async function cerrarSesion(): Promise<void> {
  await http('/auth/logout', { method: 'POST' });
}

/**
 * `PUT /auth/password`. Resuelve con el 204: el servidor guardó la contraseña y revocó todas las
 * sesiones, también la del pedido. Qué pasa con la cookie lo decide el servidor, no el cliente:
 * - cambio obligatorio (contraseña temporal): la borró, hay que volver a entrar;
 * - cambio voluntario: emitió una nueva, de la sesión rotada, y el navegador sigue adentro.
 * Para saber cuál fue, se pregunta `GET /auth/sesion` (el token nunca viaja en un cuerpo).
 */
export async function cambiarContrasena(datos: CambiarContrasenaDto): Promise<void> {
  await http('/auth/password', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(datos),
  });
}
