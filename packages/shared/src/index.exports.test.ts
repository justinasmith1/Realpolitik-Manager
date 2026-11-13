import { describe, expect, it } from 'vitest';

import {
  COBRO_NOTA_MAX,
  ESTADOS_COBRABLES,
  esEstadoCobrable,
  MENSAJE_ESTADO_ACTUALIZABLE,
  MENSAJE_MOTIVO_OBLIGATORIO,
  MENSAJE_MOTIVO_SIN_RECHAZO,
  MENSAJE_FECHA_COBRO_FUTURA,
  MENSAJE_FECHA_COBRO_INVALIDA,
  MENSAJE_NOTA_COBRO,
  MOTIVO_RECHAZO_MAX,
  problemaDeFechaCobro,
  RegistrarCobroSchema,
} from './index.js';

// El frontend y el backend importan `@realpolitik/shared` por su index: lo que no esté exportado
// ahí no existe para ellos. Las constantes de la respuesta del cliente (HU3.8) viven en el schema
// de la rendición, pero se consumen desde el index.

describe('index: constantes de la respuesta del cliente (HU3.8)', () => {
  it('exporta los mensajes y el tope del motivo', () => {
    expect(MENSAJE_ESTADO_ACTUALIZABLE).toBe(
      'El estado debe ser EN_CURSO, COMPLETA, ENVIADA, APROBADA o RECHAZADA.',
    );
    expect(MENSAJE_MOTIVO_OBLIGATORIO).toBe('Indicá qué pidió corregir el cliente.');
    expect(MENSAJE_MOTIVO_SIN_RECHAZO).toBe('El motivo solo se indica al rechazar la rendición.');
    expect(MOTIVO_RECHAZO_MAX).toBe(500);
  });
});

describe('index: cobro informado por el cliente (HU3.10)', () => {
  it('exporta los estados cobrables, el tope de la nota, los mensajes y las reglas', () => {
    expect([...ESTADOS_COBRABLES]).toEqual(['ENVIADA', 'APROBADA']);
    expect(esEstadoCobrable('ENVIADA')).toBe(true);
    expect(COBRO_NOTA_MAX).toBe(300);
    expect(MENSAJE_FECHA_COBRO_INVALIDA).toBeTypeOf('string');
    expect(MENSAJE_FECHA_COBRO_FUTURA).toBeTypeOf('string');
    expect(MENSAJE_NOTA_COBRO).toBeTypeOf('string');
    expect(problemaDeFechaCobro('2020-01-01')).toBeNull();
    expect(RegistrarCobroSchema).toBeDefined();
  });
});
