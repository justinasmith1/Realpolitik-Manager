import cors from 'cors';
import express, { json, type Express } from 'express';

import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { healthRouter } from './routes/health';

export interface AppConfig {
  corsOrigins: string[];
}

/** Arma la aplicación Express. No abre ningún puerto: de eso se ocupa server.ts. */
export function createApp({ corsOrigins }: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: corsOrigins }));
  app.use(json());

  app.use(healthRouter);

  // El orden importa: el 404 y el manejo de errores van después de todas las rutas.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
