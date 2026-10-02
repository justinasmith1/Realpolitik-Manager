import { getApiBaseUrl } from '@/lib/env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getApiBaseUrl', () => {
  describe('rechaza una configuración ausente', () => {
    it('cuando VITE_API_URL no está definida', () => {
      vi.stubEnv('VITE_API_URL', undefined);

      expect(() => getApiBaseUrl()).toThrow(/VITE_API_URL is not set/);
    });

    it.each([
      ['vacía', ''],
      ['solo espacios', '   '],
    ])('cuando VITE_API_URL está %s', (_descripcion, valor) => {
      vi.stubEnv('VITE_API_URL', valor);

      expect(() => getApiBaseUrl()).toThrow(/VITE_API_URL is not set/);
    });
  });

  describe('rechaza una URL inválida', () => {
    it.each([
      ['un protocolo ftp', 'ftp://example.com/api', /http or https/],
      ['un protocolo file', 'file:///tmp/api', /http or https/],
      ['un esquema javascript', 'javascript:alert(1)', /http or https/],
      ['un host con puerto sin esquema', 'localhost:3000', /http or https/],
      ['un path relativo', '/api/v1', /absolute http\(s\) URL/],
      ['un host sin esquema', 'example.com/api', /absolute http\(s\) URL/],
      ['credenciales embebidas', 'https://usuario:clave@example.com/api', /credentials/],
      ['una query string', 'https://example.com/api?x=1', /query string or fragment/],
      ['un fragmento', 'https://example.com/api#seccion', /query string or fragment/],
    ])('con %s', (_descripcion, valor, mensaje) => {
      vi.stubEnv('VITE_API_URL', valor);

      expect(() => getApiBaseUrl()).toThrow(mensaje);
    });

    it('no repite el valor configurado en el mensaje (podría contener credenciales)', () => {
      vi.stubEnv('VITE_API_URL', 'https://usuario:clave-secreta@example.com/api');

      let mensaje = '';
      try {
        getApiBaseUrl();
      } catch (error) {
        mensaje = error instanceof Error ? error.message : '';
      }

      expect(mensaje).toMatch(/credentials/); // sí falló, y por la razón correcta
      expect(mensaje).not.toContain('clave-secreta');
      expect(mensaje).not.toContain('usuario');
    });
  });

  describe('devuelve la URL base normalizada', () => {
    it.each([
      ['una URL válida sin cambios', 'https://api.example.com', 'https://api.example.com'],
      [
        'sin barra final cuando es solo el origen',
        'https://api.example.com/',
        'https://api.example.com',
      ],
      ['con http y puerto', 'http://localhost:8080', 'http://localhost:8080'],
      [
        'conservando el prefijo /api/v1',
        'https://example.com/api/v1',
        'https://example.com/api/v1',
      ],
      [
        'quitando varias barras finales sin tocar el prefijo',
        'https://example.com/api/v1///',
        'https://example.com/api/v1',
      ],
      [
        'recortando los espacios alrededor',
        '  https://example.com/api/v1/  ',
        'https://example.com/api/v1',
      ],
    ])('%s', (_descripcion, valor, esperado) => {
      vi.stubEnv('VITE_API_URL', valor);

      expect(getApiBaseUrl()).toBe(esperado);
    });
  });
});
