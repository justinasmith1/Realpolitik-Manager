// La matriz de permisos (docs/security/matriz-permisos.md) contra la app real.
//
// 1. Inventario: cada ruta de negocio montada figura en la matriz con el MISMO permiso, y cada fila
//    de negocio de la matriz está montada (salvo las de historias futuras, listadas acá). Una ruta
//    nueva sin fila, o con otro permiso, hace fallar este test; una ruta sin `autorizar()` ni
//    siquiera deja crear la app.
// 2. El catálogo del código (`PERMISOS_POR_ROL`) coincide con las columnas Sí/No de la matriz.
// 3. Cada ruta, pedida como anónimo, con cada rol y con la contraseña temporal pendiente, responde
//    lo que dice la matriz. Ningún pedido denegado toca la base de negocio (solo la tabla de
//    sesiones, simulada) ni el almacenamiento.
//    Regla temporal de HU4.1: un rol de `ROLES_NO_HABILITADOS_HASTA_HU4_3` (CONSULTA) recibe 403
//    `ROL_NO_HABILITADO` en todas, aunque la matriz (y `PERMISOS_POR_ROL`, comprobado en el punto 2)
//    ya le conceda las lecturas. Al habilitarlo en HU4.3, esta prueba pasa sola a esperar la matriz.
//
// La cadena de autorización corre entera; solo la base está simulada (ver `sesionSimulada.ts`).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { RolUsuario } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp, rutasProtegidasDe } from '../../../app';
import { AlmacenamientoEnMemoria } from '../../../lib/almacenamiento/memoria';
import { ROLES_NO_HABILITADOS_HASTA_HU4_3 } from '../autorizacion';
import { PERMISOS, tienePermiso, type Permiso } from '../permisos';

import { clienteConCabeceras, clienteDePrueba, cookieDe, ORIGEN_DE_PRUEBA } from './sesionSimulada';

/** Toda tabla de negocio que se toque queda registrada (y falla: no hay datos simulados). */
const accesos = vi.hoisted(() => [] as string[]);
vi.mock('../../../lib/prisma', async () => {
  const { conSesionesSimuladas } = await import('./sesionSimulada');
  const base = new Proxy(
    {},
    {
      get: (_objetivo, clave) => {
        accesos.push(String(clave));
        return undefined;
      },
    },
  );
  return { prisma: conSesionesSimuladas(base) };
});

const MATRIZ = fileURLToPath(
  new URL('../../../../../../docs/security/matriz-permisos.md', import.meta.url),
);

interface FilaDeMatriz {
  metodo: string;
  ruta: string;
  permiso: Permiso;
  porRol: Record<RolUsuario, boolean>;
}

/** Filas de las tablas de rutas: `| \`MÉTODO /ruta\` | operación | \`permiso\` | 401 | C | A | AD |`. */
function leerMatriz(): FilaDeMatriz[] {
  const filas: FilaDeMatriz[] = [];
  for (const linea of readFileSync(MATRIZ, 'utf8').split(/\r?\n/)) {
    const celdas = linea.split('|').map((c) => c.trim());
    const ruta = /^`(GET|POST|PUT|PATCH|DELETE) (\/[^`?\s]*)/.exec(celdas[1] ?? '');
    const permiso = /^`([a-z-]+:[a-z-]+)`$/.exec(celdas[3] ?? '')?.[1];
    if (!ruta || !permiso) continue;
    expect(PERMISOS, `permiso desconocido en la matriz: ${permiso}`).toContain(permiso);
    filas.push({
      metodo: ruta[1] ?? '',
      ruta: ruta[2] ?? '',
      permiso: permiso as Permiso,
      porRol: {
        CONSULTA: celdas[5] === 'Sí',
        ADMINISTRATIVO: celdas[6] === 'Sí',
        ADMINISTRADOR: celdas[7] === 'Sí',
      },
    });
  }
  return filas;
}

const FILAS = leerMatriz();
/** `/auth/*` aplica sus propias reglas (tests de auth); el resto es negocio. */
const DE_NEGOCIO = FILAS.filter((f) => !f.ruta.startsWith('/auth'));
/** En la matriz pero sin ruta todavía: la administración de usuarios es HU4.5. */
const FUTURAS = new Set([
  'GET /usuarios',
  'POST /usuarios',
  'PATCH /usuarios/:id',
  'PATCH /usuarios/:id/estado',
  'POST /usuarios/:id/restablecer-password',
]);

const clave = (metodo: string, ruta: string) => `${metodo} ${ruta}`;

let almacenamiento: AlmacenamientoEnMemoria;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  almacenamiento = new AlmacenamientoEnMemoria();
  app = createApp({ corsOrigins: [ORIGEN_DE_PRUEBA], documentos: { almacenamiento } });
  accesos.length = 0;
  // Los pedidos permitidos llegan al servicio y fallan contra la base vacía (500): no interesa acá.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inventario: rutas montadas ↔ matriz', () => {
  it('lee una matriz con las 44 rutas de negocio implementadas más las de usuarios (HU4.5)', () => {
    expect(DE_NEGOCIO).toHaveLength(44 + FUTURAS.size);
  });

  it('cada ruta montada figura en la matriz con el mismo permiso', () => {
    const enMatriz = new Map(DE_NEGOCIO.map((f) => [clave(f.metodo, f.ruta), f.permiso]));
    const montadas = rutasProtegidasDe(app);
    expect(montadas).toHaveLength(44);
    for (const ruta of montadas) {
      expect(enMatriz.get(clave(ruta.metodo, ruta.ruta)), clave(ruta.metodo, ruta.ruta)).toBe(
        ruta.permiso,
      );
    }
  });

  it('cada fila de negocio de la matriz está montada, salvo las de historias futuras', () => {
    const montadas = new Set(rutasProtegidasDe(app).map((r) => clave(r.metodo, r.ruta)));
    const sinMontar = DE_NEGOCIO.map((f) => clave(f.metodo, f.ruta)).filter(
      (c) => !montadas.has(c),
    );
    expect(new Set(sinMontar)).toEqual(FUTURAS);
  });

  it('PERMISOS_POR_ROL coincide con las columnas Sí/No de cada fila', () => {
    for (const fila of FILAS.filter((f) => PERMISOS.includes(f.permiso))) {
      for (const rol of ['CONSULTA', 'ADMINISTRATIVO', 'ADMINISTRADOR'] as const) {
        expect(tienePermiso(rol, fila.permiso), `${rol} en ${fila.metodo} ${fila.ruta}`).toBe(
          fila.porRol[rol],
        );
      }
    }
  });
});

const UUID = '0b0b0b0b-0000-4000-8000-000000000001';
const concreta = (ruta: string) => ruta.replace(/:[A-Za-z]+/g, UUID);
const IMPLEMENTADAS = DE_NEGOCIO.filter((f) => !FUTURAS.has(clave(f.metodo, f.ruta)));

type Pedido = ReturnType<typeof clienteDePrueba>;
const pedir = (cliente: Pedido, fila: FilaDeMatriz) =>
  cliente[fila.metodo.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](
    concreta(fila.ruta),
  );

describe.each(IMPLEMENTADAS.map((f) => [clave(f.metodo, f.ruta), f] as const))(
  '%s',
  (_nombre, fila) => {
    it('anónimo (con Origin válido): 401 SESION_REQUERIDA, sin tocar la base', async () => {
      const res = await pedir(clienteConCabeceras(app, { Origin: ORIGEN_DE_PRUEBA }), fila);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { details: { motivo: 'SESION_REQUERIDA' } } });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(accesos).toEqual([]);
    });

    it('token desconocido: 401 y borra la cookie', async () => {
      const res = await pedir(
        clienteConCabeceras(app, {
          Origin: ORIGEN_DE_PRUEBA,
          Cookie: '__Host-rp_sesion=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        }),
        fila,
      );

      expect(res.status).toBe(401);
      expect(String(res.headers['set-cookie'])).toContain('__Host-rp_sesion=;');
      expect(accesos).toEqual([]);
    });

    it('contraseña temporal pendiente: 403 CAMBIO_DE_PASSWORD_REQUERIDO, sin tocar la base', async () => {
      const res = await pedir(clienteDePrueba(app, 'CAMBIO_PENDIENTE'), fila);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error: { code: 'FORBIDDEN', details: { motivo: 'CAMBIO_DE_PASSWORD_REQUERIDO' } },
      });
      expect(accesos).toEqual([]);
    });

    it.each(['CONSULTA', 'ADMINISTRATIVO', 'ADMINISTRADOR'] as const)(
      '%s: lo que dice la matriz',
      async (rol) => {
        const res = await pedir(clienteDePrueba(app, rol), fila);

        expect(res.headers['cache-control']).toMatch(/no-store/);
        if (ROLES_NO_HABILITADOS_HASTA_HU4_3.has(rol)) {
          expect(res.status).toBe(403);
          expect(res.body).toEqual({
            error: {
              code: 'FORBIDDEN',
              message: 'Tu cuenta todavía no tiene acceso al sistema.',
              details: { motivo: 'ROL_NO_HABILITADO' },
            },
          });
          expect(accesos).toEqual([]);
        } else if (fila.porRol[rol]) {
          expect([401, 403]).not.toContain(res.status);
        } else {
          expect(res.status).toBe(403);
          expect(res.body).toEqual({
            error: {
              code: 'FORBIDDEN',
              message: 'No tenés permiso para esta acción.',
              details: { motivo: 'PERMISO_INSUFICIENTE' },
            },
          });
          expect(accesos).toEqual([]);
        }
      },
    );

    if (fila.metodo !== 'GET') {
      it('escritura sin Origin, con una sesión que podría hacerla: 403 ORIGEN_NO_PERMITIDO', async () => {
        const res = await clienteConCabeceras(app, { Cookie: cookieDe('ADMINISTRADOR') })[
          fila.metodo.toLowerCase() as 'post'
        ](concreta(fila.ruta));

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ error: { details: { motivo: 'ORIGEN_NO_PERMITIDO' } } });
        expect(accesos).toEqual([]);
      });
    }
  },
);

describe('documentos: multer y almacenamiento solo después de autorizar', () => {
  const ONCE_MB = Buffer.alloc(11 * 1024 * 1024, 1);

  // Un multipart roto: si multer lo leyera, respondería 400 "formulario mal formado".
  const MULTIPART_ROTO = [
    '--limite',
    'Content-Disposition: form-data; name="archivo"',
    '',
    'bas',
  ].join('\r\n');
  const PDF_CHICO = Buffer.from('%PDF-1.4 contenido de prueba');

  it.each([
    ['anónimo', 401],
    ['CONSULTA', 403],
    ['contraseña pendiente', 403],
  ] as const)('carga como %s: %i antes de multer, y nada se guarda', async (caso, estado) => {
    const guardar = vi.spyOn(almacenamiento, 'guardar');
    const cliente =
      caso === 'anónimo'
        ? clienteConCabeceras(app, { Origin: ORIGEN_DE_PRUEBA })
        : clienteDePrueba(app, caso === 'CONSULTA' ? 'CONSULTA' : 'CAMBIO_PENDIENTE');

    const roto = await cliente
      .post('/documentos')
      .set('Content-Type', 'multipart/form-data; boundary=limite')
      .send(MULTIPART_ROTO);
    const valido = await cliente
      .post('/documentos')
      .field('anio', '2026')
      .attach('archivo', PDF_CHICO, { filename: 'a.pdf', contentType: 'application/pdf' });

    expect(roto.status).toBe(estado);
    expect(valido.status).toBe(estado);
    expect(guardar).not.toHaveBeenCalled();
    expect(almacenamiento.cantidad).toBe(0);
    expect(accesos).toEqual([]);
  });

  it('control: con permiso, el multipart roto SÍ llega a multer (400)', async () => {
    const res = await clienteDePrueba(app, 'ADMINISTRATIVO')
      .post('/documentos')
      .set('Content-Type', 'multipart/form-data; boundary=limite')
      .send(MULTIPART_ROTO);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { details: [{ campo: 'body' }] } });
  });

  it('control: con permiso, el mismo archivo SÍ llega a multer (413 por tamaño)', async () => {
    const res = await clienteDePrueba(app, 'ADMINISTRATIVO')
      .post('/documentos')
      .attach('archivo', ONCE_MB, { filename: 'grande.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
  });

  it.each([
    ['anónimo', 401],
    ['contraseña pendiente', 403],
  ] as const)('descarga como %s: %i sin leer el almacenamiento', async (caso, estado) => {
    const obtener = vi.spyOn(almacenamiento, 'obtener');
    const cliente =
      caso === 'anónimo' ? clienteConCabeceras(app, {}) : clienteDePrueba(app, 'CAMBIO_PENDIENTE');

    const res = await cliente.get(`/documentos/${UUID}/archivo`);

    expect(res.status).toBe(estado);
    expect(obtener).not.toHaveBeenCalled();
    expect(accesos).toEqual([]);
  });
});

describe('fuera de las rutas de negocio', () => {
  it('un preflight OPTIONS responde 204 sin datos y sin pasar por la sesión', async () => {
    const res = await request(app)
      .options('/clientes')
      .set('Origin', ORIGEN_DE_PRUEBA)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(accesos).toEqual([]);
  });

  it('/health es público y no revela nada de la infraestructura', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('una ruta no registrada: 401 sin sesión, 403 con contraseña pendiente, 404 con sesión', async () => {
    expect((await request(app).get('/usuarios')).status).toBe(401);
    expect((await clienteDePrueba(app, 'CAMBIO_PENDIENTE').get('/usuarios')).status).toBe(403);
    expect((await clienteDePrueba(app, 'ADMINISTRADOR').get('/usuarios')).status).toBe(404);
  });

  it('el rol del cliente no cuenta: una cabecera o un cuerpo con "rol" no cambian nada', async () => {
    const res = await clienteDePrueba(app, 'CONSULTA')
      .post('/clientes')
      .set('X-Rol', 'ADMINISTRADOR')
      .send({ rol: 'ADMINISTRADOR' });

    expect(res.status).toBe(403);
  });
});
