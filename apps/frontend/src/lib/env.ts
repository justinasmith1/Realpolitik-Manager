// Lectura y validación de las variables de entorno públicas del frontend.
// Toda variable VITE_* termina en el bundle del navegador: no es secreta.
//
// Los mensajes de error son técnicos, para quien configura el entorno; no son texto de UI.

// Base de mismo origen: uno o más segmentos de caracteres seguros (p. ej. /api o /api/v1). Sin
// barras dobles, barras invertidas, query, fragmento ni codificaciones (%): lo que no se puede
// leer a simple vista no se acepta como prefijo de la API.
const BASE_RELATIVA = /^(?:\/[A-Za-z0-9._~-]+)+\/*$/;

/**
 * URL base de la API (`VITE_API_URL`), validada y sin barras finales.
 *
 * Admite dos formas:
 * - **Path de mismo origen** (p. ej. `/api`): el navegador pide a su propio origen y un proxy (el
 *   rewrite de Vercel en producción, el de Vite en desarrollo) reenvía al backend. Es la forma que
 *   permite una cookie de sesión de primera parte (ADR-0006). No puede ser la raíz (`/`): la API
 *   compartiría las rutas de la SPA.
 * - **URL absoluta http(s)**: el navegador pide directo a ese origen (desarrollo sin proxy, tests).
 *
 * Se valida de forma lazy, al usarla (no al cargar la app), así el shell arranca aunque
 * todavía no haya API. No hay fallback: una mala configuración tiene que ser explícita.
 *
 * @throws {Error} si falta, o no es ni un path de mismo origen válido ni una URL absoluta http(s)
 *   sin credenciales, query ni fragmento.
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();

  if (!raw) {
    throw new Error(
      'VITE_API_URL is not set. Define it in apps/frontend/.env.local (see .env.example).',
    );
  }

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return getRelativeBase(raw);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'VITE_API_URL must be an absolute http(s) URL or a same-origin path like /api.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`VITE_API_URL must use http or https, but uses "${url.protocol}".`);
  }

  // Las VITE_* son públicas: una URL con usuario/clave filtraría credenciales al bundle.
  if (url.username !== '' || url.password !== '') {
    throw new Error('VITE_API_URL must not include credentials.');
  }

  // Una query o un fragmento rompen la unión con el path de cada request.
  if (raw.includes('?') || raw.includes('#')) {
    throw new Error('VITE_API_URL must not include a query string or fragment.');
  }

  // Solo se normalizan las barras finales; el path del base (p. ej. /api/v1) se conserva.
  return raw.replace(/\/+$/, '');
}

function getRelativeBase(raw: string): string {
  if (!BASE_RELATIVA.test(raw)) {
    throw new Error(
      'VITE_API_URL as a same-origin path must be like /api: at least one segment, only letters, digits and . _ ~ -, without query, fragment or encoded characters.',
    );
  }

  const base = raw.replace(/\/+$/, '');
  if (base.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('VITE_API_URL as a same-origin path must not contain dot segments.');
  }
  return base;
}
