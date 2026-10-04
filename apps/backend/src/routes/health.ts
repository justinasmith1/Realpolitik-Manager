import { Router } from 'express';

// No toca la base de datos a propósito: indica que el proceso está vivo.
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
