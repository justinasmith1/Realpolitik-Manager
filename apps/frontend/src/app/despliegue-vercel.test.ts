// Invariantes de vercel.json (raíz del repo) que el frontend necesita para el proxy de mismo origen
// (ADR-0006): el fallback de la SPA no toca /api ni /assets, las respuestas de /api no se cachean en
// el CDN y, cuando se agregue el rewrite hacia Railway, tenga la forma segura. No reemplaza la
// verificación en Vercel: el motor de patrones real es el suyo.

import type { RouteObject } from 'react-router';

import { routes } from '@/app/router';

import vercelJsonTexto from '../../../../vercel.json?raw';

interface Condicion {
  type: string;
  key?: string;
  value?: string;
}
interface Rewrite {
  source: string;
  destination: string;
  has?: Condicion[];
  missing?: Condicion[];
}
interface ReglaCabeceras {
  source: string;
  headers: { key: string; value: string }[];
}
interface ConfigVercel {
  rewrites?: Rewrite[];
  headers?: ReglaCabeceras[];
  [clave: string]: unknown;
}

const config = JSON.parse(vercelJsonTexto) as ConfigVercel;
const FUENTE_API = '/api/:path*';

/**
 * Compila los dos formatos de `source` que usa este archivo: `/api/:path*` y `/(<regex>)`. Otro
 * formato hace fallar el test a propósito: hay que agregarlo acá a conciencia.
 */
function compilar(source: string): RegExp {
  if (source === FUENTE_API) return /^\/api(?:\/.*)?$/;
  const grupo = /^\/\((.*)\)$/.exec(source);
  if (grupo) return new RegExp(`^/(${grupo[1] ?? ''})$`);
  throw new Error(`Formato de source no contemplado por este test: ${source}`);
}

const fallback = () => {
  const rewrite = config.rewrites?.find((candidato) => candidato.destination === '/index.html');
  if (!rewrite) throw new Error('vercel.json no tiene el fallback de la SPA');
  return rewrite;
};

/** Paths de ejemplo de todas las rutas de React Router (los parámetros, con valores ficticios). */
function pathsDeLaSpa(rutas: RouteObject[], padre = ''): string[] {
  return rutas.flatMap((ruta) => {
    if (ruta.path === '*') return [];
    const propio =
      ruta.path === undefined
        ? padre
        : `${padre.replace(/\/$/, '')}/${ruta.path.replace(/^\//, '')}`;
    const path = propio.replace(/:[A-Za-z]+/g, '1') || '/';
    return [
      ...(ruta.index || ruta.path ? [path] : []),
      ...pathsDeLaSpa(ruta.children ?? [], propio),
    ];
  });
}

/** Problemas de un rewrite hacia un origen externo (el del proxy hacia Railway). */
function problemasDelProxy(cfg: ConfigVercel): string[] {
  const rewrites = cfg.rewrites ?? [];
  const indiceFallback = rewrites.findIndex((rewrite) => rewrite.destination === '/index.html');
  return rewrites.flatMap((rewrite, indice) => {
    if (!/^[a-z]+:\/\//i.test(rewrite.destination)) return [];
    const problemas: string[] = [];
    const destino = new URL(rewrite.destination.replace(':path*', 'x'));
    if (rewrite.source !== FUENTE_API)
      problemas.push(`source ${rewrite.source} (debe ser ${FUENTE_API})`);
    if (destino.protocol !== 'https:') problemas.push('destino sin https');
    if (rewrite.destination !== `${destino.origin}/:path*`)
      problemas.push('el destino debe ser https://<host>/:path* (sin prefijo, sin query)');
    if (destino.hostname.endsWith('.vercel.app')) problemas.push('destino en vercel.app (bucle)');
    if (indiceFallback !== -1 && indice > indiceFallback)
      problemas.push('está después del fallback de la SPA');
    // Sin condición de host, cada Preview mandaría sus pedidos (también escrituras) al backend de producción.
    if (!rewrite.has?.some((condicion) => condicion.type === 'host' && condicion.value)) {
      problemas.push('sin condición has: host (los Previews llegarían al backend de producción)');
    }
    return problemas;
  });
}

describe('vercel.json', () => {
  describe('fallback de la SPA', () => {
    it('cubre todas las rutas de React Router y la raíz', () => {
      const patron = compilar(fallback().source);
      const paths = pathsDeLaSpa(routes);

      expect(paths).toEqual(
        expect.arrayContaining(['/', '/clientes', '/rendiciones', '/clientes/1/rendiciones/1']),
      );
      for (const path of paths) {
        expect({ path, cubierto: patron.test(path) }).toEqual({ path, cubierto: true });
      }
    });

    it.each([
      '/api',
      '/api/',
      '/api/clientes',
      '/api/rendiciones/1/estado',
      '/assets/index-abc.js',
      '/assets/',
    ])('no devuelve index.html para %j', (path) => {
      expect(compilar(fallback().source).test(path)).toBe(false);
    });

    it('sigue cubriendo rutas que solo empiezan parecido (/apix, /assetsx)', () => {
      const patron = compilar(fallback().source);

      expect(patron.test('/apix')).toBe(true);
      expect(patron.test('/assetsx')).toBe(true);
    });

    it('ninguna ruta de la SPA vive bajo /api ni /assets', () => {
      for (const path of pathsDeLaSpa(routes)) {
        expect(path).not.toMatch(/^\/(api|assets)(\/|$)/);
      }
    });
  });

  it('desactiva la caché del CDN en /api: interruptor de rewrites externos y no-store', () => {
    const regla = config.headers?.find((candidata) => candidata.source === FUENTE_API);
    const cabeceras = Object.fromEntries(
      (regla?.headers ?? []).map(({ key, value }) => [key.toLowerCase(), value]),
    );

    expect(cabeceras).toMatchObject({
      'x-vercel-enable-rewrite-caching': '0',
      'cache-control': 'no-store',
    });
  });

  it('no usa Functions, middleware ni routes (el proxy es solo un rewrite)', () => {
    for (const clave of ['functions', 'routes', 'builds', 'middleware', 'crons']) {
      expect(config).not.toHaveProperty(clave);
    }
  });

  describe('rewrite hacia el backend (se agrega al activar el proxy)', () => {
    it('si existe, tiene la forma segura', () => {
      expect(problemasDelProxy(config)).toEqual([]);
    });

    it('la guarda detecta un rewrite sin condición de host, sin https o después del fallback', () => {
      const inseguro: ConfigVercel = {
        rewrites: [
          { source: '/((?!api/|api$|assets/).*)', destination: '/index.html' },
          { source: FUENTE_API, destination: 'http://backend.example/api/:path*' },
        ],
      };

      expect(problemasDelProxy(inseguro)).toEqual([
        'destino sin https',
        'el destino debe ser https://<host>/:path* (sin prefijo, sin query)',
        'está después del fallback de la SPA',
        'sin condición has: host (los Previews llegarían al backend de producción)',
      ]);
    });

    it('la guarda acepta la forma esperada', () => {
      const seguro: ConfigVercel = {
        rewrites: [
          {
            source: FUENTE_API,
            destination: 'https://backend.example/:path*',
            has: [{ type: 'host', value: 'app.example' }],
          },
          { source: '/((?!api/|api$|assets/).*)', destination: '/index.html' },
        ],
      };

      expect(problemasDelProxy(seguro)).toEqual([]);
    });
  });
});
