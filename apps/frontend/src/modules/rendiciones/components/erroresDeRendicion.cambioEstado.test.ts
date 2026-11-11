import { mensajeFalloCambioDeEstado } from '@/modules/rendiciones/components/erroresDeRendicion';

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
