import cors from 'cors';
import express, { json, type Express } from 'express';

import type { AlmacenamientoDocumentos } from './lib/almacenamiento/almacenamiento';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { sinCache } from './middleware/sinCache';
import { requerirSesion } from './modules/auth/auth.controller';
import { crearAuthRouter } from './modules/auth/auth.routes';
import {
  bloquearRolesNoHabilitados,
  esRouterProtegido,
  exigirPasswordDefinitiva,
  rutasDe,
  soloLecturaParaConsulta,
  type RouterProtegido,
  type RutaProtegida,
} from './modules/auth/autorizacion';
import { ProteccionDeLogin } from './modules/auth/proteccionDeLogin';
import { verificarOrigen } from './modules/auth/verificarOrigen';
import { clientesRouter } from './modules/clientes/clientes.routes';
import { requisitosRouter } from './modules/clientes/requisitos.routes';
import {
  crearDocumentosRouter,
  documentosDeItemsRouter,
} from './modules/documentos/documentos.routes';
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
  /**
   * Cuántos proxies delante del backend se consideran confiables para `req.ip` (`trust proxy` de
   * Express). 0 (por defecto): la IP del socket. Nunca `true`: se fija en la cantidad exacta de
   * saltos medida en la activación (ADR-0006 §4). Lo usa el límite por origen del login.
   */
  saltosDeProxyConfiables?: number;
  /** Estado de la protección del login. Por defecto, uno nuevo por app (los tests inyectan su reloj). */
  proteccionDeLogin?: ProteccionDeLogin;
}

const RUTAS_PROTEGIDAS = 'rutasProtegidas';

/** Las rutas de negocio montadas, con su ruta absoluta y su permiso (para el test de inventario). */
export function rutasProtegidasDe(app: Express): readonly RutaProtegida[] {
  return (app.locals[RUTAS_PROTEGIDAS] as RutaProtegida[] | undefined) ?? [];
}

const unirRuta = (prefijo: string, ruta: string) => (ruta === '/' ? prefijo : `${prefijo}${ruta}`);

/**
 * Arma la aplicación Express. No abre ningún puerto: de eso se ocupa server.ts.
 *
 * Orden (ADR-0006 §5): sin caché → CORS (preflight) → `Origin` en toda escritura → rutas públicas
 * (`/health`, `/auth`) → sesión obligatoria (401 / 503) → contraseña definitiva (403) → roles no
 * habilitados todavía (403, temporal de HU4.1: CONSULTA) → CONSULTA solo lee (403) → cuerpo JSON → routers de negocio, cada ruta con `autorizar(PERMISO)` primero (y
 * recién después multer o la validación) → 404 → errores. Ningún cuerpo se lee, ningún archivo se
 * recibe y ninguna operación corre antes de saber quién pide y si puede.
 */
export function createApp({
  corsOrigins,
  documentos,
  saltosDeProxyConfiables = 0,
  proteccionDeLogin = new ProteccionDeLogin(),
}: AppConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  if (saltosDeProxyConfiables > 0) app.set('trust proxy', saltosDeProxyConfiables);

  app.use(sinCache);
  // El preflight (`OPTIONS`) termina acá con 204, sin datos: no llega a la sesión ni a las rutas.
  app.use(cors({ origin: corsOrigins }));
  // CSRF: `Origin` exacto en TODO método que escribe, antes de leer cualquier cuerpo.
  app.use(verificarOrigen(corsOrigins));

  // Públicas: el healthcheck y `/auth`, que aplica sus propias reglas de sesión.
  app.use(healthRouter);
  app.use(
    '/auth',
    json({ limit: LIMITE_CUERPO_JSON }),
    crearAuthRouter({ proteccion: proteccionDeLogin }),
  );

  // Desde acá, TODO exige sesión, también una ruta inexistente (401 para un anónimo).
  app.use(requerirSesion);
  app.use(exigirPasswordDefinitiva);
  // TEMPORAL (HU4.1): CONSULTA no usa el negocio hasta HU4.3. Se borra esta línea al habilitarlo.
  app.use(bloquearRolesNoHabilitados);
  app.use(soloLecturaParaConsulta);
  app.use(json({ limit: LIMITE_CUERPO_JSON }));

  const rutasProtegidas: RutaProtegida[] = [];
  app.locals[RUTAS_PROTEGIDAS] = rutasProtegidas;
  const montar = (prefijo: string, router: RouterProtegido) => {
    // Solo routers de `crearRouter()`: cada ruta declaró su permiso al registrarse.
    if (!esRouterProtegido(router)) {
      throw new Error(`createApp: ${prefijo} no es un router de crearRouter().`);
    }
    app.use(prefijo, router);
    for (const ruta of rutasDe(router)) {
      rutasProtegidas.push({ ...ruta, ruta: unirRuta(prefijo, ruta.ruta) });
    }
  };

  montar('/clientes', clientesRouter);
  montar('/clientes', rendicionesDeClienteRouter);
  montar('/requisitos', requisitosRouter);
  montar('/rendiciones', rendicionesRouter);
  montar('/tipos-documento', tiposDocumentoRouter);
  if (documentos) {
    montar('/documentos', crearDocumentosRouter(documentos.almacenamiento));
    montar('/rendiciones', documentosDeItemsRouter);
  }

  // El orden importa: el 404 y el manejo de errores van después de todas las rutas.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
