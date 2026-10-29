import cors from 'cors';
import express, { json, type Express } from 'express';

import type { AlmacenamientoDocumentos } from './lib/almacenamiento/almacenamiento';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { clientesRouter } from './modules/clientes/clientes.routes';
import { requisitosRouter } from './modules/clientes/requisitos.routes';
import { crearDocumentosRouter } from './modules/documentos/documentos.routes';
import {
  rendicionesDeClienteRouter,
  rendicionesRouter,
} from './modules/rendiciones/rendiciones.routes';
import { tiposDocumentoRouter } from './modules/tipos-documento/tipos-documento.routes';
import { healthRouter } from './routes/health';

/**
 * Tamaño máximo del cuerpo JSON. Es el default de Express, declarado para dejar la intención
 * explícita: el pedido legítimo más grande (un cliente con todos sus campos al máximo, o la lista
 * completa de contactos) queda muy por debajo. Pasarlo responde 413 `PAYLOAD_TOO_LARGE`.
 */
export const LIMITE_CUERPO_JSON = '100kb';

export interface AppConfig {
  corsOrigins: string[];
  /**
   * Los endpoints de documentos (HU2.8) y el almacenamiento que usan. Sin esto, `/documentos` no
   * se monta y responde 404 como cualquier ruta inexistente: es como quedan en producción mientras
   * no haya una protección efectiva (ver `DOCUMENTOS_HABILITADOS` en src/config/env.ts).
   */
  documentos?: { almacenamiento: AlmacenamientoDocumentos } | null;
}

/** Arma la aplicación Express. No abre ningún puerto: de eso se ocupa server.ts. */
export function createApp({ corsOrigins, documentos }: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({ origin: corsOrigins }));
  app.use(json({ limit: LIMITE_CUERPO_JSON }));

  app.use(healthRouter);
  app.use('/clientes', clientesRouter);
  app.use('/clientes', rendicionesDeClienteRouter);
  app.use('/requisitos', requisitosRouter);
  app.use('/rendiciones', rendicionesRouter);
  app.use('/tipos-documento', tiposDocumentoRouter);
  if (documentos) {
    app.use('/documentos', crearDocumentosRouter(documentos.almacenamiento));
  }

  // El orden importa: el 404 y el manejo de errores van después de todas las rutas.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
