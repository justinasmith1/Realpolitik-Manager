import { crearRouterPublico } from '../modules/auth/autorizacion';

// Público y sin sesión. No toca la base de datos a propósito: indica que el proceso está vivo, sin
// datos de infraestructura, versiones ni estado de la base.
export const healthRouter = crearRouterPublico();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
