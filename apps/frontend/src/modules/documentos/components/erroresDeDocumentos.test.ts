import {
  mensajeFalloAplicacion,
  mensajeFalloAsociacion,
  mensajeFalloReemplazo,
} from '@/modules/documentos/components/erroresDeDocumentos';

// Una rendición Enviada o Aprobada no se modifica: el servidor responde RENDICION_ENVIADA en los
// dos casos (HU3.7 y HU3.8), así que el texto no dice "enviada".

describe('RENDICION_ENVIADA (una Enviada o una Aprobada)', () => {
  it('aplicar a varios ítems nombra la rendición y dice que ya no se puede modificar', () => {
    const texto = mensajeFalloAplicacion(
      { tipo: 'rechazado', motivo: 'RENDICION_ENVIADA', itemId: 'i1' },
      () => 'Muni Ejemplo, A 00001-00000001',
    );

    expect(texto).toBe(
      'La rendición de Muni Ejemplo, A 00001-00000001 ya no se puede modificar. No se aplicó a ninguno.',
    );
  });

  it('asociar un documento a un ítem', () => {
    expect(
      mensajeFalloAsociacion({ tipo: 'rechazado', motivo: 'RENDICION_ENVIADA', itemId: null }),
    ).toBe('La rendición ya no se puede modificar.');
  });

  it('reemplazar el documento de un ítem', () => {
    expect(mensajeFalloReemplazo({ tipo: 'rechazado', motivo: 'RENDICION_ENVIADA' })).toBe(
      'La rendición ya no se puede modificar.',
    );
  });
});
