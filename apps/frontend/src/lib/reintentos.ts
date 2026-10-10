// Política de reintentos de las queries (lecturas). Los defaults de TanStack Query reintentan
// 3 veces con esperas de 1 s, 2 s y 4 s: con el backend caído, el aviso de error tardaba ~7 s en
// aparecer, y además se reintentaban errores que no se arreglan solos (un 404, un 400, la
// configuración). Acá se reintenta UNA vez y rápido, y solo lo que puede ser transitorio.
//
// Las mutations no se reintentan nunca: repetir un POST/PATCH lo decide la persona.

import { ApiClientError } from '@/lib/http';

/** Reintentos como máximo después del primer fallo. */
export const MAX_REINTENTOS = 1;

/** Espera antes del reintento: lo justo para que un corte de un instante se recupere. */
export const DEMORA_DEL_REINTENTO_MS = 400;

/**
 * ¿Vale la pena reintentar? `fallos` es la cantidad de reintentos ya hechos (TanStack Query
 * pasa 0 tras el primer fallo).
 *
 * - Sin conexión (`network`) o error del servidor (5xx): puede ser transitorio → una vez.
 * - 4xx (400, 404…): la respuesta va a ser la misma → no.
 * - Configuración (`VITE_API_URL` inválida): no se arregla sola → no.
 * - Cualquier otro error (p. ej. una respuesta que no cumple el schema): tampoco.
 */
export function debeReintentar(fallos: number, error: unknown): boolean {
  if (fallos >= MAX_REINTENTOS || !(error instanceof ApiClientError)) {
    return false;
  }
  switch (error.kind) {
    case 'network':
      return true;
    case 'http':
      return (error.status ?? 0) >= 500;
    case 'configuration':
      return false;
  }
}
