import { ApiClientError } from '@/lib/http';
import { interpretarFalloCobro } from '@/modules/rendiciones/api/rendiciones.api';
import { mensajeFalloCobro } from '@/modules/rendiciones/components/erroresDeRendicion';

// Los fallos de registrar o quitar el cobro (HU3.10).

const falloHttp = (status: number, code: string, details?: unknown) =>
  new ApiClientError({
    kind: 'http',
    message: 'x',
    status,
    payload: { error: { code, message: 'x', ...(details === undefined ? {} : { details }) } },
  });

const conflicto = (motivo: string, extra: Record<string, unknown> = {}) =>
  falloHttp(409, 'CONFLICT', { motivo, ...extra });

describe('interpretarFalloCobro', () => {
  it('409 RENDICION_ANULADA', () => {
    expect(interpretarFalloCobro(conflicto('RENDICION_ANULADA'))).toEqual({
      tipo: 'rendicion-anulada',
    });
  });

  it('409 COBRO_ESTADO_INVALIDO', () => {
    expect(
      interpretarFalloCobro(conflicto('COBRO_ESTADO_INVALIDO', { estadoActual: 'EN_CURSO' })),
    ).toEqual({ tipo: 'estado-invalido' });
  });

  it('404 NOT_FOUND', () => {
    expect(interpretarFalloCobro(falloHttp(404, 'NOT_FOUND'))).toEqual({ tipo: 'no-existe' });
  });

  it('400 VALIDATION_ERROR con el campo y el mensaje del servidor', () => {
    const fallo = interpretarFalloCobro(
      falloHttp(400, 'VALIDATION_ERROR', [
        { campo: 'fecha', mensaje: 'La fecha del cobro no puede ser posterior a hoy.' },
      ]),
    );
    expect(fallo).toEqual({
      tipo: 'datos-invalidos',
      detalles: [{ campo: 'fecha', mensaje: 'La fecha del cobro no puede ser posterior a hoy.' }],
    });
  });

  it('cualquier otra cosa es inesperada', () => {
    expect(interpretarFalloCobro(new Error('red'))).toEqual({ tipo: 'inesperado' });
    expect(interpretarFalloCobro(conflicto('OTRO'))).toEqual({ tipo: 'inesperado' });
  });
});

describe('mensajeFalloCobro', () => {
  it('estado inválido: el texto acordado', () => {
    expect(mensajeFalloCobro({ tipo: 'estado-invalido' })).toEqual({
      general: 'Solo se puede registrar el cobro de una rendición enviada, aprobada o rechazada.',
    });
  });

  it('anulada y no existe', () => {
    expect(mensajeFalloCobro({ tipo: 'rendicion-anulada' }).general).toBe(
      'La rendición está anulada: ya no se puede modificar.',
    );
    expect(mensajeFalloCobro({ tipo: 'no-existe' }).general).toBe(
      'Esta rendición ya no existe. Volvé a cargar la página.',
    );
  });

  it('datos inválidos: el mensaje del servidor queda en su campo', () => {
    expect(
      mensajeFalloCobro({
        tipo: 'datos-invalidos',
        detalles: [{ campo: 'fecha', mensaje: 'La fecha del cobro no puede ser posterior a hoy.' }],
      }),
    ).toMatchObject({ campos: { fecha: 'La fecha del cobro no puede ser posterior a hoy.' } });
  });

  it('datos inválidos de un campo desconocido: mensaje general', () => {
    expect(
      mensajeFalloCobro({ tipo: 'datos-invalidos', detalles: [{ campo: 'otro', mensaje: 'x' }] })
        .general,
    ).toBe('No pudimos guardar el cobro. Probá de nuevo en unos segundos.');
  });

  it('inesperado', () => {
    expect(mensajeFalloCobro({ tipo: 'inesperado' }).general).toBe(
      'No pudimos guardar el cobro. Probá de nuevo en unos segundos.',
    );
  });
});
