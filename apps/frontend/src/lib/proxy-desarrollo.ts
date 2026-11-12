// Proxy `/api` del servidor de desarrollo de Vite (lo usa vite.config.ts; no forma parte del bundle).
//
// Emula el rewrite de mismo origen de producción (ADR-0006): el navegador pide `/api/...` a su propio
// origen y Vite lo reenvía al backend de desarrollo, sin el prefijo. Solo se usa con
// `VITE_API_URL=/api`; con una URL absoluta el navegador va directo al backend y el proxy no actúa.
//
// El destino sale de `API_PROXY_TARGET` (variable del proceso de Vite, no `VITE_*`: no llega al
// bundle). Solo se admiten backends locales por http, para que el proxy no pueda apuntar a
// producción por error.

import type { ProxyOptions } from 'vite';

export const DESTINO_PROXY_POR_DEFECTO = 'http://localhost:3000';

// `/api`, `/api/...` y `/api?...`, pero no `/apix`. Vite trata como expresión regular una clave que
// empieza con ^ y la compara contra la URL del pedido, query incluida.
export const CLAVE_PROXY_API = '^/api(?:[/?]|$)';

const HOSTS_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Valida el destino del proxy y devuelve su origen. Admite `http:` hacia loopback o hacia un nombre
 * sin puntos (un servicio de Docker Compose, como `backend`). Un dominio con puntos o `https:` es,
 * en la práctica, un servidor remoto: se rechaza.
 */
export function validarDestinoProxy(valor: string | undefined): string {
  const texto = valor?.trim() || DESTINO_PROXY_POR_DEFECTO;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new Error('API_PROXY_TARGET must be an absolute URL such as http://localhost:3000.');
  }

  const esLocal = HOSTS_LOOPBACK.has(url.hostname) || !url.hostname.includes('.');
  if (url.protocol !== 'http:' || !esLocal) {
    throw new Error(
      'API_PROXY_TARGET must point to a local development backend over http (localhost, 127.0.0.1, [::1] or a Docker Compose service name).',
    );
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'API_PROXY_TARGET must be only an origin, without credentials, path, query or fragment.',
    );
  }
  return url.origin;
}

/** Quita el prefijo `/api` del path; `/api` solo pasa a ser la raíz del backend. */
export function quitarPrefijoApi(path: string): string {
  const sinPrefijo = path.replace(/^\/api(?=\/|$|\?)/, '');
  return sinPrefijo.startsWith('/') ? sinPrefijo : `/${sinPrefijo}`;
}

/** Configuración de `server.proxy` (y de `preview.proxy`, que la hereda) para Vite. */
export function crearProxyApi(destino: string | undefined): Record<string, ProxyOptions> {
  return {
    [CLAVE_PROXY_API]: {
      target: validarDestinoProxy(destino),
      // Como el rewrite de Vercel: el backend recibe su propio host y los X-Forwarded-* del original.
      changeOrigin: true,
      xfwd: true,
      rewrite: quitarPrefijoApi,
    },
  };
}
