import {
  mensajeFalloCambioDeEstado,
  mensajeFalloCorreccionDeCanal,
  mensajeFalloPropagacion,
  motivoFalloAgregado,
} from '@/modules/rendiciones/components/erroresDeRendicion';

// Los textos del fallo al cambiar el estado de una rendición (HU3.6).

describe('mensajeFalloCambioDeEstado', () => {
  it.each([
    [0, 'No se puede marcar como completa: la rendición no tiene documentos.'],
    [1, 'No se puede marcar como completa: falta 1 documento.'],
    [2, 'No se puede marcar como completa: faltan 2 documentos.'],
    [15, 'No se puede marcar como completa: faltan 15 documentos.'],
  ])('items-pendientes con %i faltantes', (faltantes, texto) => {
    expect(mensajeFalloCambioDeEstado({ tipo: 'items-pendientes', faltantes })).toBe(texto);
  });

  it('sin la cantidad (el servidor no la mandó) dice que faltan documentos', () => {
    expect(mensajeFalloCambioDeEstado({ tipo: 'items-pendientes', faltantes: null })).toBe(
      'No se puede marcar como completa: faltan documentos.',
    );
  });

  it('cubre el resto de los fallos', () => {
    expect(mensajeFalloCambioDeEstado({ tipo: 'rendicion-anulada' })).toBe(
      'La rendición está anulada: ya no se puede modificar.',
    );
    expect(mensajeFalloCambioDeEstado({ tipo: 'transicion-invalida' })).toBe(
      'Ese cambio de estado no está permitido desde el estado actual.',
    );
    expect(mensajeFalloCambioDeEstado({ tipo: 'no-existe' })).toBe(
      'La rendición ya no existe. Volvé a cargar la página.',
    );
    expect(mensajeFalloCambioDeEstado({ tipo: 'inesperado' })).toBe(
      'No pudimos cambiar el estado de la rendición. Probá de nuevo en unos segundos.',
    );
  });
});

describe('mensajeFalloCambioDeEstado al marcar como enviada (HU3.7)', () => {
  it('los faltantes dicen que no se puede marcar como enviada', () => {
    expect(mensajeFalloCambioDeEstado({ tipo: 'items-pendientes', faltantes: 1 }, 'ENVIADA')).toBe(
      'No se puede marcar como enviada: falta 1 documento.',
    );
  });

  it('una fecha rechazada muestra el mensaje del servidor o uno genérico', () => {
    expect(
      mensajeFalloCambioDeEstado(
        { tipo: 'fecha-invalida', mensaje: 'La fecha de envío no puede ser posterior a hoy.' },
        'ENVIADA',
      ),
    ).toBe('La fecha de envío no puede ser posterior a hoy.');
    expect(mensajeFalloCambioDeEstado({ tipo: 'fecha-invalida', mensaje: null }, 'ENVIADA')).toBe(
      'Revisá la fecha de envío.',
    );
  });
});

describe('una Enviada no se modifica (HU3.7)', () => {
  it('sumar un requisito, corregir y propagar el canal lo explican', () => {
    expect(motivoFalloAgregado({ tipo: 'rendicion-enviada' })).toBe('la rendición ya fue enviada');
    expect(mensajeFalloCorreccionDeCanal({ tipo: 'rendicion-enviada' })).toBe(
      'La rendición ya fue enviada: no se puede modificar.',
    );
    expect(
      mensajeFalloPropagacion(
        { tipo: 'rendicion-enviada', rendicionId: 'r1' },
        () => 'Octubre 2026',
      ),
    ).toBe(
      'El requisito quedó guardado, pero no se actualizó ninguna rendición: Octubre 2026 ya fue enviada. Destildala y probá de nuevo.',
    );
  });
});
