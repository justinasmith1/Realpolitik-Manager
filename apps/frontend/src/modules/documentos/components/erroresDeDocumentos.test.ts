import type { FalloDeDescarga } from '@/modules/documentos/api/documentos.api';
import {
  mensajeFalloAplicacion,
  mensajeFalloAsociacion,
  mensajeFalloCarga,
  mensajeFalloDescarga,
  mensajeFalloReemplazo,
  mensajeFalloVistaPrevia,
} from '@/modules/documentos/components/erroresDeDocumentos';

// ─── Acceso (HU4.4, CA12) ─────────────────────────────────────────────────────

describe('mensajeFalloDescarga', () => {
  it.each<[FalloDeDescarga['tipo'], string]>([
    ['sin-permiso', 'No tenés permiso para descargar a.pdf.'],
    ['no-existe', 'a.pdf ya no está disponible. Actualizá la información y probá de nuevo.'],
    [
      'no-disponible',
      'El servicio de documentos no está disponible en este momento: no se descargó a.pdf. Probá de nuevo en unos minutos.',
    ],
    [
      'conexion',
      'No pudimos conectarnos con el servidor: no se descargó a.pdf. Revisá tu conexión y probá de nuevo.',
    ],
    [
      'configuracion',
      'No se pudo descargar a.pdf: la aplicación no tiene bien configurada la dirección del servidor.',
    ],
    // Solo se avisa si la sesión sigue (un 401 atrasado): no dice que terminó.
    ['sin-sesion', 'No se pudo descargar a.pdf. Probá de nuevo.'],
    ['inesperado', 'No se pudo descargar a.pdf. Probá de nuevo.'],
  ])('%s', (tipo, texto) => {
    expect(mensajeFalloDescarga('a.pdf', { tipo })).toBe(texto);
  });
});

describe('mensajeFalloVistaPrevia', () => {
  it.each<[FalloDeDescarga['tipo'], string]>([
    ['sin-permiso', 'No tenés permiso para ver a.pdf.'],
    ['no-existe', 'a.pdf ya no está disponible. Actualizá la información y probá de nuevo.'],
    [
      'no-disponible',
      'El servicio de documentos no está disponible en este momento: no pudimos mostrar a.pdf. Probá de nuevo en unos minutos.',
    ],
    [
      'conexion',
      'No pudimos conectarnos con el servidor para mostrar a.pdf. Revisá tu conexión y probá de nuevo.',
    ],
    ['inesperado', 'No pudimos mostrar a.pdf. Podés descargarlo para verlo en tu equipo.'],
  ])('%s', (tipo, texto) => {
    expect(mensajeFalloVistaPrevia('a.pdf', { tipo })).toBe(texto);
  });

  it('sin fallo de la API (una imagen que el navegador no pudo dibujar) ofrece descargarlo', () => {
    expect(mensajeFalloVistaPrevia('a.png', null)).toBe(
      'No pudimos mostrar a.png. Podés descargarlo para verlo en tu equipo.',
    );
  });
});

describe('403 de permiso en las operaciones', () => {
  it('cada operación dice que no está permitida y que no cambió nada', () => {
    expect(mensajeFalloCarga({ tipo: 'sin-permiso' })).toBe(
      'No tenés permiso para cargar documentos. No se guardó nada.',
    );
    expect(mensajeFalloAplicacion({ tipo: 'sin-permiso' }, () => null)).toBe(
      'No tenés permiso para aplicar documentos. No se aplicó a ninguno.',
    );
    expect(mensajeFalloAsociacion({ tipo: 'sin-permiso' })).toBe(
      'No tenés permiso para asociar documentos. No se asoció.',
    );
    expect(mensajeFalloReemplazo({ tipo: 'sin-permiso' })).toBe(
      'No tenés permiso para reemplazar documentos. No se reemplazó.',
    );
  });
});

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
