import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { AppError } from '../../../errors/app-error';
import {
  autorizar,
  crearRouter,
  esRouterProtegido,
  rutasDe,
  soloLecturaParaConsulta,
} from '../autorizacion';
import { PERMISOS, PERMISOS_POR_ROL, tienePermiso } from '../permisos';

const controlador: RequestHandler = (_req, res) => {
  res.end();
};

describe('crearRouter: denegado por defecto al registrar', () => {
  it('una ruta sin autorizar() como primer handler no se puede registrar', () => {
    const router = crearRouter();
    expect(() => router.get('/', controlador)).toThrow(/no empieza con autorizar\(PERMISO\)/);
    expect(() => router.post('/x', controlador, autorizar('clientes:editar'))).toThrow(
      /POST \/x no empieza con autorizar/,
    );
    expect(rutasDe(router)).toEqual([]);
  });

  it.each(['get', 'post', 'put', 'patch', 'delete'] as const)(
    '%s con autorizar() primero se registra con su permiso',
    (metodo) => {
      const router = crearRouter();
      router[metodo]('/:id', autorizar('rendiciones:operar'), controlador);
      expect(rutasDe(router)).toEqual([
        { metodo: metodo.toUpperCase(), ruta: '/:id', permiso: 'rendiciones:operar' },
      ]);
    },
  );

  it('use, all y route no se pueden usar (abrirían rutas sin permiso)', () => {
    const router = crearRouter();
    expect(() => router.use(controlador)).toThrow(/use\(\)/);
    expect(() => router.all('/x', controlador)).toThrow(/all\(\)/);
    expect(() => router.route('/x')).toThrow(/route\(\)/);
  });

  it('marca sus routers; uno cualquiera de express no pasa por protegido', () => {
    expect(esRouterProtegido(crearRouter())).toBe(true);
    expect(esRouterProtegido(controlador)).toBe(false);
  });
});

describe('PERMISOS_POR_ROL', () => {
  it('son exactamente los 12 permisos de la matriz', () => {
    expect(PERMISOS).toHaveLength(12);
    expect(new Set(PERMISOS).size).toBe(12);
  });

  it('se componen: CONSULTA ⊂ ADMINISTRATIVO ⊂ ADMINISTRADOR', () => {
    for (const permiso of PERMISOS_POR_ROL.CONSULTA) {
      expect(PERMISOS_POR_ROL.ADMINISTRATIVO.has(permiso)).toBe(true);
    }
    for (const permiso of PERMISOS_POR_ROL.ADMINISTRATIVO) {
      expect(PERMISOS_POR_ROL.ADMINISTRADOR.has(permiso)).toBe(true);
    }
    expect(PERMISOS_POR_ROL.ADMINISTRADOR.size).toBe(12);
  });

  it('CONSULTA solo tiene lecturas y su cuenta', () => {
    for (const permiso of PERMISOS_POR_ROL.CONSULTA) {
      expect(permiso === 'cuenta:propia' || permiso.endsWith(':ver')).toBe(true);
    }
  });

  it('solo ADMINISTRADOR administra usuarios', () => {
    expect(tienePermiso('ADMINISTRADOR', 'usuarios:administrar')).toBe(true);
    expect(tienePermiso('ADMINISTRATIVO', 'usuarios:administrar')).toBe(false);
    expect(tienePermiso('CONSULTA', 'usuarios:administrar')).toBe(false);
  });

  it('un rol desconocido no tiene ningún permiso', () => {
    expect(tienePermiso('INVENTADO' as never, 'clientes:ver')).toBe(false);
  });
});

describe('autorizar(permiso)', () => {
  const ejecutar = (permiso: Parameters<typeof autorizar>[0], locals: Record<string, unknown>) => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const next = vi.fn<(error?: unknown) => void>();
    autorizar(permiso)(
      { ip: '203.0.113.1' } as Request,
      { locals } as unknown as Response,
      next as NextFunction,
    );
    return next.mock.calls[0]?.[0] as AppError | undefined;
  };
  const sesionDe = (rol: string) => ({
    sesion: { usuario: { id: '0000a000-0000-4000-8000-000000000009', rol } },
  });

  it('ADMINISTRATIVO no administra usuarios: 403 PERMISO_INSUFICIENTE', () => {
    const error = ejecutar('usuarios:administrar', sesionDe('ADMINISTRATIVO'));
    expect(error?.status).toBe(403);
    expect(error?.details).toEqual({ motivo: 'PERMISO_INSUFICIENTE' });
  });

  it('ADMINISTRADOR sí: sigue sin error', () => {
    expect(ejecutar('usuarios:administrar', sesionDe('ADMINISTRADOR'))).toBeUndefined();
  });

  it('sin sesión en res.locals (requerirSesion no corrió): 401, nunca acceso', () => {
    expect(ejecutar('clientes:ver', {})?.status).toBe(401);
  });
});

/** Ejecuta un middleware con `req` y `res.locals` mínimos y devuelve el error que pasó a `next`. */
function ejecutarMiddleware(
  handler: RequestHandler,
  metodo: string,
  locals: Record<string, unknown>,
): { llamado: boolean; error: AppError | undefined } {
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const next = vi.fn<(error?: unknown) => void>();
  handler(
    { method: metodo, ip: '203.0.113.1' } as Request,
    { locals } as unknown as Response,
    next as NextFunction,
  );
  return { llamado: next.mock.calls.length === 1, error: next.mock.calls[0]?.[0] as AppError };
}

const conRol = (rol: string) => ({
  sesion: { usuario: { id: '0000a000-0000-4000-8000-000000000009', rol } },
});

describe('CONSULTA habilitado (HU4.3): lee lo que dice la matriz, nada más', () => {
  const LECTURAS = [
    'cuenta:propia',
    'clientes:ver',
    'requisitos:ver',
    'tipos-documento:ver',
    'rendiciones:ver',
    'documentos:ver',
  ] as const;
  const OPERACIONES = PERMISOS.filter((p) => !(LECTURAS as readonly string[]).includes(p));

  it('ya no existe la regla temporal de HU4.1 que lo dejaba fuera del negocio', async () => {
    const modulo: Record<string, unknown> = await import('../autorizacion');
    expect(modulo).not.toHaveProperty('bloquearRolesNoHabilitados');
    expect(modulo).not.toHaveProperty('ROLES_NO_HABILITADOS_HASTA_HU4_3');
  });

  it('sus permisos son exactamente las 6 lecturas de la matriz', () => {
    expect([...PERMISOS_POR_ROL.CONSULTA].sort()).toEqual([...LECTURAS].sort());
    expect(OPERACIONES).toHaveLength(6);
  });

  it.each(LECTURAS)('autorizar(%s) lo deja pasar', (permiso) => {
    const { llamado, error } = ejecutarMiddleware(autorizar(permiso), 'GET', conRol('CONSULTA'));
    expect(llamado).toBe(true);
    expect(error).toBeUndefined();
  });

  it.each(OPERACIONES)(
    'autorizar(%s): 403 PERMISO_INSUFICIENTE aunque el pedido sea un GET',
    (permiso) => {
      for (const metodo of ['GET', 'HEAD', 'POST']) {
        const { error } = ejecutarMiddleware(autorizar(permiso), metodo, conRol('CONSULTA'));
        expect(error?.status).toBe(403);
        expect(error?.details).toEqual({ motivo: 'PERMISO_INSUFICIENTE' });
      }
    },
  );
});

describe('soloLecturaParaConsulta (permanente)', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('CONSULTA con %s: 403 PERMISO_INSUFICIENTE', (m) => {
    const { error } = ejecutarMiddleware(soloLecturaParaConsulta, m, conRol('CONSULTA'));
    expect(error?.status).toBe(403);
    expect(error?.details).toEqual({ motivo: 'PERMISO_INSUFICIENTE' });
  });

  it('CONSULTA con GET y ADMINISTRATIVO con POST pasan', () => {
    expect(ejecutarMiddleware(soloLecturaParaConsulta, 'GET', conRol('CONSULTA')).error).toBe(
      undefined,
    );
    expect(
      ejecutarMiddleware(soloLecturaParaConsulta, 'POST', conRol('ADMINISTRATIVO')).error,
    ).toBeUndefined();
  });
});
