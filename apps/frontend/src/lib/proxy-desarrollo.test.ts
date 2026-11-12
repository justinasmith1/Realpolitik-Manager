import {
  CLAVE_PROXY_API,
  crearProxyApi,
  DESTINO_PROXY_POR_DEFECTO,
  quitarPrefijoApi,
  validarDestinoProxy,
} from '@/lib/proxy-desarrollo';

describe('proxy /api del servidor de desarrollo', () => {
  describe('qué pedidos toma', () => {
    // Vite trata la clave como expresión regular y la compara contra la URL, query incluida.
    const toma = (url: string) => new RegExp(CLAVE_PROXY_API).test(url);

    it.each(['/api', '/api/', '/api/clientes', '/api/rendiciones/1/estado', '/api?x=1'])(
      'toma %j',
      (url) => {
        expect(toma(url)).toBe(true);
      },
    );

    it.each(['/', '/apix', '/apis/clientes', '/clientes', '/clientes/api', '/assets/app.js'])(
      'no toma %j: es de la SPA o de sus assets',
      (url) => {
        expect(toma(url)).toBe(false);
      },
    );
  });

  describe('quita el prefijo /api como el rewrite de producción', () => {
    it.each([
      ['/api/clientes', '/clientes'],
      ['/api/clientes?activo=true', '/clientes?activo=true'],
      ['/api', '/'],
      ['/api/', '/'],
      ['/api?x=1', '/?x=1'],
    ])('%j → %j', (entrada, salida) => {
      expect(quitarPrefijoApi(entrada)).toBe(salida);
    });
  });

  describe('destino', () => {
    it('usa http://localhost:3000 si API_PROXY_TARGET no está definida', () => {
      expect(validarDestinoProxy(undefined)).toBe(DESTINO_PROXY_POR_DEFECTO);
      expect(validarDestinoProxy('  ')).toBe(DESTINO_PROXY_POR_DEFECTO);
    });

    it.each([
      ['localhost con otro puerto', 'http://localhost:3999', 'http://localhost:3999'],
      ['127.0.0.1', 'http://127.0.0.1:3000/', 'http://127.0.0.1:3000'],
      ['IPv6 loopback', 'http://[::1]:3000', 'http://[::1]:3000'],
      ['el servicio de Docker Compose', 'http://backend:3000', 'http://backend:3000'],
    ])('acepta %s', (_caso, valor, esperado) => {
      expect(validarDestinoProxy(valor)).toBe(esperado);
    });

    it.each([
      ['un backend remoto por https', 'https://backend.up.railway.app'],
      ['un dominio con puntos por http', 'http://api.example.com'],
      ['https aunque sea local', 'https://localhost:3000'],
      ['credenciales', 'http://usuario:clave@localhost:3000'],
      ['un path', 'http://localhost:3000/api'],
      ['algo que no es una URL', 'localhost'],
    ])('rechaza %s', (_caso, valor) => {
      expect(() => validarDestinoProxy(valor)).toThrow(/API_PROXY_TARGET/);
    });
  });

  it('arma la opción de Vite con el destino validado, el host del backend y X-Forwarded-*', () => {
    const proxy = crearProxyApi('http://backend:3000');

    expect(Object.keys(proxy)).toEqual([CLAVE_PROXY_API]);
    expect(proxy[CLAVE_PROXY_API]).toMatchObject({
      target: 'http://backend:3000',
      changeOrigin: true,
      xfwd: true,
      rewrite: quitarPrefijoApi,
    });
  });
});
