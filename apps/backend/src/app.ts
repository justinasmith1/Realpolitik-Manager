import cors from 'cors';
import express, { json, type Express } from 'express';

import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { clientesRouter } from './modules/clientes/clientes.routes';
import { healthRouter } from './routes/health';

/**
 * Tamaño máximo del cuerpo JSON. Es el default de Express, declarado para dejar la intención
 * explícita: el pedido legítimo más grande (un cliente con todos sus campos al máximo, o la lista
 * completa de contactos) queda muy por debajo. Pasarlo responde 413 `PAYLOAD_TOO_LARGE`.
 */
export const LIMITE_CUERPO_JSON = '100kb';

export interface AppConfig {
  corsOrigins: string[];
}

/** Arma la aplicación Express. No abre ningún puerto: de eso se ocupa server.ts. */
export function createApp({ corsOrigins }: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: corsOrigins }));
  app.use(json({ limit: LIMITE_CUERPO_JSON }));

  app.use(healthRouter);
  app.use('/clientes', clientesRouter);

  // El orden importa: el 404 y el manejo de errores van después de todas las rutas.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
