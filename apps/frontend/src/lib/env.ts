// Lectura y validación de las variables de entorno públicas del frontend.
// Toda variable VITE_* termina en el bundle del navegador: no es secreta.
//
// Los mensajes de error son técnicos, para quien configura el entorno; no son texto de UI.

/**
 * URL base de la API (`VITE_API_URL`), validada y sin barras finales.
 *
 * Se valida de forma lazy, al usarla (no al cargar la app), así el shell arranca aunque
 * todavía no haya API. No hay fallback: una mala configuración tiene que ser explícita.
 *
 * @throws {Error} si falta, no es una URL absoluta http(s), o incluye credenciales,
 *   query o fragmento.
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();

  if (!raw) {
    throw new Error(
      'VITE_API_URL is not set. Define it in apps/frontend/.env.local (see .env.example).',
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_API_URL must be an absolute http(s) URL.');
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
