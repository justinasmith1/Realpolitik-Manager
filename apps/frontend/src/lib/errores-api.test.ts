import {
  causaDeError,
  diagnosticoDeError,
  esObjeto,
  leerCuerpoDeError,
  leerDetallesInvalidos,
  mensajeDelServidor,
} from '@/lib/errores-api';
import { ApiClientError } from '@/lib/http';

const errorHttp = (status: number) => new ApiClientError({ kind: 'http', message: 'x', status });
const sinConexion = new ApiClientError({ kind: 'network', message: 'x' });
const sinConfiguracion = new ApiClientError({ kind: 'configuration', message: 'x' });
const httpSinStatus = new ApiClientError({ kind: 'http', message: 'x' });

describe('esObjeto', () => {
  it.each([
    ['un objeto vacío', {}],
    ['un objeto con claves', { a: 1 }],
  ])('acepta %s', (_caso, valor) => {
    expect(esObjeto(valor)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['un array', []],
    ['un texto', 'x'],
    ['un número', 1],
    ['un booleano', true],
  ])('rechaza %s', (_caso, valor) => {
    expect(esObjeto(valor)).toBe(false);
  });
});

describe('leerCuerpoDeError', () => {
  it('lee code y details del formato del contrato', () => {
    const payload = { error: { code: 'CONFLICT', message: 'x', details: { motivo: 'M' } } };

    expect(leerCuerpoDeError(payload)).toEqual({ code: 'CONFLICT', details: { motivo: 'M' } });
  });

  it('sin details, los deja en undefined', () => {
    expect(leerCuerpoDeError({ error: { code: 'NOT_FOUND' } })).toEqual({
      code: 'NOT_FOUND',
      details: undefined,
    });
  });

  it.each([
    ['sin cuerpo', undefined],
    ['un texto (p. ej. el HTML de un proxy)', '<html>Bad Gateway</html>'],
    ['un objeto sin error', { code: 'CONFLICT' }],
    ['error que no es un objeto', { error: 'CONFLICT' }],
    ['error como array', { error: [] }],
    ['un array', [{ error: { code: 'X' } }]],
  ])('devuelve null con %s', (_caso, payload) => {
    expect(leerCuerpoDeError(payload)).toBeNull();
  });
});

describe('leerDetallesInvalidos', () => {
  it('extrae campo y mensaje de cada detalle', () => {
    const detalles = [
      { campo: 'nombre', mensaje: 'El nombre es obligatorio.' },
      { campo: 'periodicidad.diaLimite', mensaje: 'x' },
    ];

    expect(leerDetallesInvalidos(detalles)).toEqual(detalles);
  });

  it('un mensaje ausente o que no es texto queda en null', () => {
    expect(leerDetallesInvalidos([{ campo: 'a' }, { campo: 'b', mensaje: 3 }])).toEqual([
      { campo: 'a', mensaje: null },
      { campo: 'b', mensaje: null },
    ]);
  });

  it('descarta los detalles sin campo de texto, sin perder los demás', () => {
    const detalles = [{ mensaje: 'sin campo' }, { campo: 1 }, null, 'x', { campo: 'ok' }];

    expect(leerDetallesInvalidos(detalles)).toEqual([{ campo: 'ok', mensaje: null }]);
  });

  it.each([
    ['undefined', undefined],
    ['un objeto', { campo: 'nombre' }],
    ['un texto', 'nombre'],
  ])('con details que no es una lista (%s) devuelve []', (_caso, details) => {
    expect(leerDetallesInvalidos(details)).toEqual([]);
  });
});

describe('mensajeDelServidor', () => {
  it('devuelve el mensaje de shared, sin espacios en los bordes', () => {
    expect(mensajeDelServidor(' El nombre es obligatorio. ')).toBe('El nombre es obligatorio.');
  });

  it.each([
    ['null', null],
    ['vacío', ''],
    ['solo espacios', '   '],
    ['"Required" de Zod', 'Required'],
    ['"Expected …" de Zod', 'Expected string, received number'],
    ['"String must …" de Zod', 'String must contain at most 100 character(s)'],
  ])('descarta un mensaje %s', (_caso, mensaje) => {
    expect(mensajeDelServidor(mensaje)).toBeNull();
  });
});

describe('diagnosticoDeError', () => {
  it.each([
    ['sin respuesta del servidor', sinConexion, 'NETWORK_ERROR'],
    ['configuración inválida', sinConfiguracion, 'CONFIG_ERROR'],
    ['respuesta HTTP', errorHttp(503), 'HTTP_503'],
    ['respuesta HTTP sin status', httpSinStatus, 'HTTP_ERROR'],
    ['error de otro tipo', new Error('x'), 'ERROR_INESPERADO'],
  ])('%s', (_caso, error, esperado) => {
    expect(diagnosticoDeError(error)).toBe(esperado);
  });
});

describe('causaDeError', () => {
  it.each([
    ['sin respuesta del servidor', sinConexion, 'conexion'],
    ['configuración inválida', sinConfiguracion, 'configuracion'],
    ['una respuesta HTTP sin status', httpSinStatus, 'inesperado'],
    ['un 500', errorHttp(500), 'servidor'],
    ['un 503', errorHttp(503), 'servidor'],
    ['un 404', errorHttp(404), 'inesperado'],
    ['un 400', errorHttp(400), 'inesperado'],
    ['un error de otro tipo', new Error('x'), 'inesperado'],
  ])('%s', (_caso, error, esperado) => {
    expect(causaDeError(error)).toBe(esperado);
  });
});
