import type { RequestHandler } from 'express';

/**
 * Cabeceras de seguridad de TODAS las respuestas de la API. La API solo devuelve JSON (y las
 * descargas de documentos), nunca HTML: estas políticas no restringen nada que use.
 *
 * - `X-Content-Type-Options: nosniff`: el navegador respeta el `Content-Type` y no interpreta un JSON
 *   como HTML o script.
 * - `Referrer-Policy: no-referrer`: un documento abierto desde la API no envía su URL a nadie.
 * - `X-Frame-Options: DENY` y `frame-ancestors 'none'`: ninguna respuesta se puede mostrar en un
 *   marco (clickjacking). La vista previa del frontend no se ve afectada: descarga el archivo con
 *   `fetch` y lo muestra desde una URL `blob:` propia.
 * - `Content-Security-Policy: default-src 'none'`: si una respuesta se abriera en el navegador, no
 *   carga ni ejecuta nada. La descarga de documentos la reemplaza por la suya, que suma `sandbox`.
 * - `Strict-Transport-Security`: Railway no la agrega (Vercel sí, en el frontend). El navegador la
 *   ignora en HTTP, así que no afecta el desarrollo local. Sin `includeSubDomains` ni `preload`: el
 *   dominio del backend puede ser uno compartido del proveedor.
 *
 * Va primero en `createApp`, como `sinCache`: cubre también los errores y los preflight.
 */
export const CABECERAS_DE_SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000',
} as const;

export const cabecerasDeSeguridad: RequestHandler = (_req, res, next) => {
  res.set(CABECERAS_DE_SEGURIDAD);
  next();
};
