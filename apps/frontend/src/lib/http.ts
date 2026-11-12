// Capa de transporte HTTP. Solo sabe construir la URL, hacer el fetch y distinguir
// categorías de error. No parsea respuestas exitosas, no conoce contratos de dominio y
// no produce texto de UI: esos son trabajo de los módulos que la usen.
//
// Los mensajes de error son técnicos (para logs y desarrolladores), no copy de interfaz.

import { getApiBaseUrl } from '@/lib/env';

/**
 * Categoría de un fallo del cliente:
 * - `configuration`: `VITE_API_URL` ausente o inválida.
 * - `network`: el fetch no pudo completarse (sin respuesta del servidor).
 * - `http`: el servidor respondió con un status fuera de 2xx.
 */
export type ApiClientErrorKind = 'configuration' | 'network' | 'http';

interface ApiClientErrorOptions {
  kind: ApiClientErrorKind;
  message: string;
  status?: number;
  statusText?: string;
  payload?: unknown;
  cause?: unknown;
}

/** Error normalizado del cliente HTTP. No asume ningún contrato del backend. */
export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  /** Status HTTP; solo en errores `http`. */
  readonly status: number | undefined;
  readonly statusText: string | undefined;
  /**
   * Cuerpo de la respuesta de error, sin interpretar: el JSON parseado si el
   * `Content-Type` es JSON, el texto en otro caso, o `undefined` si no hay cuerpo.
   */
  readonly payload: unknown;

  constructor({ kind, message, status, statusText, payload, cause }: ApiClientErrorOptions) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = status;
    this.statusText = statusText;
    this.payload = payload;
  }
}

function resolveBaseUrl(): string {
  try {
    return getApiBaseUrl();
  } catch (cause) {
    throw new ApiClientError({
      kind: 'configuration',
      message: cause instanceof Error ? cause.message : 'Invalid API base URL configuration.',
      cause,
    });
  }
}

// El path se une al base por concatenación (no con `new URL(path, base)`, que descartaría
// el prefijo /api/v1). Por eso se exige un path relativo al base, que no pueda saltearlo.
// Estas son las validaciones de forma; la garantía real está en `buildUrl`.
function assertValidPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError(
      'http() expects a path relative to the API base URL, starting with a single "/".',
    );
  }

  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  if (/(^|\/)(\.|%2e){1,2}(\/|$)/i.test(pathname)) {
    throw new TypeError('http() path must not contain dot segments ("." or "..").');
  }
}

// Une base y path, y comprueba contra la URL que `fetch` realmente va a pedir: el parser
// normaliza (trata "\" como "/", descarta TAB/LF/CR, resuelve "..") y por eso una lista de
// caracteres prohibidos nunca termina de cubrir los casos. Si la URL normalizada cambia de
// origin o deja de estar bajo el pathname del base, el path no es válido.
function buildUrl(base: string, path: string): string {
  const url = `${base}${path}`;

  const baseUrl = new URL(base);
  const finalUrl = new URL(url);
  const basePathname = baseUrl.pathname.replace(/\/+$/, '');
  const isUnderBase =
    finalUrl.pathname === basePathname || finalUrl.pathname.startsWith(`${basePathname}/`);

  if (finalUrl.origin !== baseUrl.origin || !isUnderBase) {
    throw new TypeError('http() path must stay under the API base URL once normalized.');
  }
  return url;
}

// Una cancelación por AbortSignal no es un fallo de red: debe llegar intacta al llamador
// (TanStack Query la reconoce por su `name`).
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text === '') {
      return undefined;
    }

    const isJson = /\bjson\b/i.test(response.headers.get('Content-Type') ?? '');
    if (!isJson) {
      return text;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text; // se anunció JSON pero no lo es: se conserva el texto original
    }
  } catch {
    return undefined; // el cuerpo no se pudo leer
  }
}

/**
 * Hace una request a la API: `VITE_API_URL` + `path`.
 *
 * Devuelve la `Response` de un 2xx sin parsear. Rechaza con:
 * - `ApiClientError` (`configuration` | `network` | `http`);
 * - el error original, sin envolver, si la request fue cancelada con un `AbortSignal`;
 * - `TypeError` si `path` no es un path relativo válido (error de programación).
 *
 * Solo agrega `Accept: application/json` (si el llamador no lo definió). No agrega
 * `Content-Type`, credenciales, timeouts ni reintentos.
 */
export async function http(path: string, init: RequestInit = {}): Promise<Response> {
  assertValidPath(path);
  const url = buildUrl(resolveBaseUrl(), path);

  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (cause) {
    if (init.signal?.aborted || isAbortError(cause)) {
      throw cause;
    }
    throw new ApiClientError({ kind: 'network', message: 'Network request failed.', cause });
  }

  if (!response.ok) {
    throw new ApiClientError({
      kind: 'http',
      message: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      status: response.status,
      statusText: response.statusText,
      payload: await readErrorPayload(response),
    });
  }

  return response;
}
