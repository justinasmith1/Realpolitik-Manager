import type { RequestHandler } from 'express';

/**
 * `Cache-Control: no-store` en TODAS las respuestas de la API (ADR-0006 §4): llevan datos de negocio
 * o de la sesión, y ninguna caché (del navegador, del CDN ni intermedia) debe guardarlas. Va primero
 * en `createApp`, así cubre también los errores (401, 403, 404, 413…) y los preflight. No depende del
 * proxy de Vercel. Las descargas de documentos la refuerzan con `private, no-store`.
 */
export const sinCache: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
