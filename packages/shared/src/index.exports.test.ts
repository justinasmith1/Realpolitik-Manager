import { describe, expect, it } from 'vitest';

import {
  MENSAJE_ESTADO_ACTUALIZABLE,
  MENSAJE_MOTIVO_OBLIGATORIO,
  MENSAJE_MOTIVO_SIN_RECHAZO,
  MOTIVO_RECHAZO_MAX,
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
