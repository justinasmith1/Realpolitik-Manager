import { ApiClientError } from '@/lib/http';
import {
  avisoDeErrorDeAuth,
  clasificarErrorDeAuth,
  mensajeDeEspera,
} from '@/modules/auth/erroresDeAuth';

const http = (status: number, code: string, details?: unknown, retryAfterSegundos?: number) =>
  new ApiClientError({
    kind: 'http',
    message: `HTTP ${status}`,
    status,
    payload: { error: { code, message: 'texto interno del servidor', details } },
    retryAfterSegundos,
  });

describe('clasificarErrorDeAuth', () => {
  it.each([
    ['SESION_REQUERIDA', { clase: 'sin-sesion', vencida: false }],
    ['SESION_VENCIDA', { clase: 'sin-sesion', vencida: true }],
    ['CREDENCIALES_INVALIDAS', { clase: 'credenciales' }],
  ])('401 %s', (motivo, esperado) => {
    expect(clasificarErrorDeAuth(http(401, 'UNAUTHENTICATED', { motivo }))).toEqual(esperado);
  });

  it('un 401 sin cuerpo del contrato es "sin sesión", nunca credenciales', () => {
    const error = new ApiClientError({ kind: 'http', message: 'HTTP 401', status: 401 });
    expect(clasificarErrorDeAuth(error)).toEqual({ clase: 'sin-sesion', vencida: false });
  });

  it.each([
    ['CAMBIO_DE_PASSWORD_REQUERIDO', 'cambio-requerido'],
    ['ROL_NO_HABILITADO', 'rol-no-habilitado'],
    ['PERMISO_INSUFICIENTE', 'permiso-insuficiente'],
    ['ORIGEN_NO_PERMITIDO', 'origen'],
    ['OTRO_MOTIVO', 'permiso-insuficiente'],
  ])('403 %s → %s: hay sesión, no es un 401', (motivo, clase) => {
    expect(clasificarErrorDeAuth(http(403, 'FORBIDDEN', { motivo }))).toEqual({ clase });
  });

  it('429 lleva la espera de Retry-After y distingue el intento en curso', () => {
    expect(
      clasificarErrorDeAuth(http(429, 'TOO_MANY_REQUESTS', { motivo: 'DEMASIADOS_INTENTOS' }, 90)),
    ).toEqual({ clase: 'demasiados-intentos', enCurso: false, esperaSegundos: 90 });
    expect(
      clasificarErrorDeAuth(http(429, 'TOO_MANY_REQUESTS', { motivo: 'INTENTO_EN_CURSO' }, 1)),
    ).toEqual({ clase: 'demasiados-intentos', enCurso: true, esperaSegundos: 1 });
  });

  it('503, 502/504 del proxy sin cuerpo y la red caída NO son "sin sesión"', () => {
    expect(clasificarErrorDeAuth(http(503, 'SERVICE_UNAVAILABLE'))).toEqual({
      clase: 'no-disponible',
    });
    for (const status of [500, 502, 504]) {
      const error = new ApiClientError({ kind: 'http', message: 'x', status, payload: '<html>' });
      expect(clasificarErrorDeAuth(error)).toEqual({ clase: 'no-disponible' });
    }
    expect(clasificarErrorDeAuth(new ApiClientError({ kind: 'network', message: 'x' }))).toEqual({
      clase: 'red',
    });
  });

  it('400 de validación entrega los campos; lo desconocido es "inesperado"', () => {
    const detalles = [{ campo: 'actual', mensaje: 'La contraseña actual no es correcta.' }];
    expect(clasificarErrorDeAuth(http(400, 'VALIDATION_ERROR', detalles))).toEqual({
      clase: 'validacion',
      detalles,
    });
    expect(clasificarErrorDeAuth(new Error('x'))).toEqual({ clase: 'inesperado' });
    expect(clasificarErrorDeAuth(http(404, 'NOT_FOUND'))).toEqual({ clase: 'inesperado' });
  });
});

describe('textos', () => {
  it.each([
    [1, 'Demasiados intentos. Probá de nuevo en 1 segundo.'],
    [59, 'Demasiados intentos. Probá de nuevo en 59 segundos.'],
    [60, 'Demasiados intentos. Probá de nuevo en un minuto.'],
    [61, 'Demasiados intentos. Probá de nuevo en 2 minutos.'],
    [undefined, 'Demasiados intentos. Probá de nuevo en unos minutos.'],
  ])('espera de %s segundos', (segundos, texto) => {
    expect(mensajeDeEspera(segundos)).toBe(texto);
  });

  it('ningún aviso muestra el mensaje interno del servidor', () => {
    for (const error of [
      http(401, 'UNAUTHENTICATED', { motivo: 'CREDENCIALES_INVALIDAS' }),
      http(403, 'FORBIDDEN', { motivo: 'ORIGEN_NO_PERMITIDO' }),
      http(429, 'TOO_MANY_REQUESTS', { motivo: 'DEMASIADOS_INTENTOS' }, 30),
      http(503, 'SERVICE_UNAVAILABLE'),
      http(500, 'INTERNAL_ERROR'),
      new Error('stack interno'),
    ]) {
      const { texto } = avisoDeErrorDeAuth(clasificarErrorDeAuth(error));
      expect(texto).not.toMatch(/interno/);
    }
  });

  it('la espera es una advertencia; el resto, un error', () => {
    expect(
      avisoDeErrorDeAuth({ clase: 'demasiados-intentos', enCurso: true, esperaSegundos: 1 }),
    ).toEqual({
      variante: 'warning',
      texto: 'Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo.',
    });
    expect(avisoDeErrorDeAuth({ clase: 'red' }).variante).toBe('destructive');
  });
});
