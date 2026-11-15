// Autorización de la API (ADR-0006 §5): denegada por defecto, también en tiempo de ejecución.
//
// - `crearRouter()` es la única forma de declarar rutas de negocio. Cada `get`, `post`, `put`,
//   `patch` y `delete` tiene que llevar `autorizar(PERMISO)` como PRIMER handler: si no, lanza al
//   registrar la ruta, así el servidor no arranca y cualquier test que cree la app falla. `use`,
//   `all` y `route` no se pueden usar desde afuera. Cada router guarda sus rutas y permisos: el
//   test de inventario los compara con la matriz.
// - `crearRouterPublico()` es la única forma de declarar rutas sin permiso: `/health` y `/auth`.
// - Las cadenas globales (`createApp`) ya exigieron `Origin`, sesión, contraseña definitiva y, para
//   CONSULTA, solo lectura. `autorizar` decide el permiso de cada ruta con `PERMISOS_POR_ROL`.
//
// ESLint impide importar `Router` de express fuera de este archivo.

import { Router, type RequestHandler } from 'express';

import { forbidden, unauthenticated } from '../../errors/app-error';

import { tienePermiso, type Permiso } from './permisos';
import { registrarEventoDeAuth } from './registroDeEventos';
import type { SesionValidada } from './sesiones.service';

/** Lo que `requerirSesion` deja en `res.locals` para lo que viene después. */
export interface LocalsDeSesion {
  sesion: SesionValidada;
}

export const MENSAJE_SIN_SESION = 'Iniciá sesión para continuar.';
export const MENSAJE_PERMISO_INSUFICIENTE = 'No tenés permiso para esta acción.';
export const MENSAJE_CAMBIO_DE_PASSWORD_REQUERIDO =
  'Tenés que cambiar tu contraseña antes de continuar.';

const METODOS_DE_LECTURA: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** La sesión que dejó `requerirSesion`, o `undefined` si no corrió (se trata como sin sesión). */
const sesionDe = (locals: Record<string, unknown>) => (locals as Partial<LocalsDeSesion>).sesion;

const sinSesion = () => unauthenticated('SESION_REQUERIDA', MENSAJE_SIN_SESION);
const sinPermiso = () => forbidden('PERMISO_INSUFICIENTE', MENSAJE_PERMISO_INSUFICIENTE);

/**
 * Con una contraseña temporal sin cambiar, nada fuera de `/auth/*` responde: 403
 * `CAMBIO_DE_PASSWORD_REQUERIDO`. Va después de `requerirSesion` y antes de cualquier router de
 * negocio (también antes del 404 de una ruta inexistente).
 */
export const exigirPasswordDefinitiva: RequestHandler = (_req, res, next) => {
  const sesion = sesionDe(res.locals);
  if (!sesion) {
    next(sinSesion());
    return;
  }
  if (sesion.usuario.debeCambiarPassword) {
    next(forbidden('CAMBIO_DE_PASSWORD_REQUERIDO', MENSAJE_CAMBIO_DE_PASSWORD_REQUERIDO));
    return;
  }
  next();
};

/**
 * Red de seguridad global y PERMANENTE: CONSULTA nunca escribe. Rechaza sus `POST`, `PUT`,
 * `PATCH` y `DELETE` fuera de `/auth/*` aunque una ruta, por error, le concediera un permiso de
 * escritura. Corre antes de leer el cuerpo.
 *
 * Que deje pasar un `GET` no autoriza nada: el permiso de cada ruta lo decide `autorizar`. Un `GET`
 * que prepara una operación (`GET /documentos/:id/candidatos`, `GET /clientes/:id/ultima-oc`) es
 * 403 para CONSULTA aunque sea una lectura.
 */
export const soloLecturaParaConsulta: RequestHandler = (req, res, next) => {
  const sesion = sesionDe(res.locals);
  if (!sesion) {
    next(sinSesion());
    return;
  }
  if (sesion.usuario.rol === 'CONSULTA' && !METODOS_DE_LECTURA.has(req.method)) {
    registrarEventoDeAuth('auth.permiso_denegado', {
      usuarioId: sesion.usuario.id,
      motivo: 'solo-lectura',
      ip: req.ip,
    });
    next(sinPermiso());
    return;
  }
  next();
};

const PERMISO_DEL_HANDLER = Symbol('permisoDelHandler');

type HandlerAutorizador = RequestHandler & { readonly [PERMISO_DEL_HANDLER]: Permiso };

/**
 * Primer handler obligatorio de toda ruta de negocio. Sin sesión: 401. Sin el permiso: 403
 * `PERMISO_INSUFICIENTE`, sin detalles del recurso ni de la validación (no se llegó a mirarlos).
 */
export function autorizar(permiso: Permiso): RequestHandler {
  const handler: RequestHandler = (req, res, next) => {
    const sesion = sesionDe(res.locals);
    if (!sesion) {
      next(sinSesion());
      return;
    }
    if (!tienePermiso(sesion.usuario.rol, permiso)) {
      registrarEventoDeAuth('auth.permiso_denegado', {
        usuarioId: sesion.usuario.id,
        permiso,
        ip: req.ip,
      });
      next(sinPermiso());
      return;
    }
    next();
  };
  return Object.assign(handler, { [PERMISO_DEL_HANDLER]: permiso }) satisfies HandlerAutorizador;
}

function permisoDe(handler: unknown): Permiso | undefined {
  return typeof handler === 'function'
    ? (handler as Partial<HandlerAutorizador>)[PERMISO_DEL_HANDLER]
    : undefined;
}

export type MetodoProtegido = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Una ruta registrada con su permiso. `ruta` es relativa al router (o absoluta, una vez montado). */
export interface RutaProtegida {
  metodo: MetodoProtegido;
  ruta: string;
  permiso: Permiso;
}

const ROUTER_PROTEGIDO = Symbol('routerProtegido');

export interface RouterProtegido extends Router {
  readonly [ROUTER_PROTEGIDO]: readonly RutaProtegida[];
}

const METODOS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Router de negocio: cada ruta empieza con `autorizar(PERMISO)` o el registro lanza. */
export function crearRouter(): RouterProtegido {
  const router = Router();
  const rutas: RutaProtegida[] = [];
  // Los métodos de express registran la ruta con `this.route(...)`: solo ellos pueden usarlo.
  let registrando = false;

  const route = router.route.bind(router);
  router.route = (ruta: string) => {
    if (!registrando) throw new Error('crearRouter(): `route()` no se usa; declará cada método.');
    return route(ruta);
  };

  for (const metodo of METODOS) {
    const original = router[metodo].bind(router) as (...args: unknown[]) => Router;
    router[metodo] = ((ruta: unknown, ...handlers: unknown[]) => {
      const etiqueta = `${metodo.toUpperCase()} ${String(ruta)}`;
      if (typeof ruta !== 'string') {
        throw new Error(`crearRouter(): ${etiqueta}: la ruta tiene que ser un texto.`);
      }
      const permiso = permisoDe(handlers[0]);
      if (permiso === undefined) {
        throw new Error(
          `crearRouter(): ${etiqueta} no empieza con autorizar(PERMISO). Toda ruta de negocio declara su permiso (docs/security/matriz-permisos.md).`,
        );
      }
      registrando = true;
      try {
        original(ruta, ...handlers);
      } finally {
        registrando = false;
      }
      rutas.push({ metodo: metodo.toUpperCase() as MetodoProtegido, ruta, permiso });
      return router;
    }) as Router[typeof metodo];
  }

  for (const prohibido of ['use', 'all'] as const) {
    router[prohibido] = (() => {
      throw new Error(`crearRouter(): \`${prohibido}()\` no se usa en un router de negocio.`);
    }) as never;
  }

  return Object.assign(router, { [ROUTER_PROTEGIDO]: rutas });
}

export function esRouterProtegido(router: unknown): router is RouterProtegido {
  return (
    typeof router === 'function' &&
    Array.isArray((router as Partial<RouterProtegido>)[ROUTER_PROTEGIDO])
  );
}

export function rutasDe(router: RouterProtegido): readonly RutaProtegida[] {
  return router[ROUTER_PROTEGIDO];
}

/** Router sin permisos: SOLO `/health` y `/auth`, que aplican sus propias reglas. */
export function crearRouterPublico(): Router {
  return Router();
}
