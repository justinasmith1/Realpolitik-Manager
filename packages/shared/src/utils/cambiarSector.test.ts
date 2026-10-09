import { describe, expect, it } from 'vitest';

import { cambiarSector } from './cambiarSector.js';

describe('cambiarSector', () => {
  it('de PUBLICO a PRIVADO descarta el subtipo', () => {
    expect(cambiarSector({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' }, 'PRIVADO')).toEqual({
      sector: 'PRIVADO',
      subtipo: undefined,
    });
  });

  it('de PRIVADO a PUBLICO deja el subtipo sin elegir', () => {
    expect(cambiarSector({ sector: 'PRIVADO', subtipo: undefined }, 'PUBLICO')).toEqual({
      sector: 'PUBLICO',
      subtipo: undefined,
    });
  });

  it('conserva el subtipo si se vuelve a elegir el mismo sector', () => {
    expect(cambiarSector({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' }, 'PUBLICO')).toEqual({
      sector: 'PUBLICO',
      subtipo: 'MUNICIPAL',
    });
  });

  it('al quitar el sector descarta el subtipo', () => {
    expect(cambiarSector({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' }, undefined)).toEqual({
      sector: undefined,
      subtipo: undefined,
    });
  });

  it('un subtipo huérfano (sin sector previo) no sobrevive a un sector nuevo inválido', () => {
    expect(cambiarSector({ sector: undefined, subtipo: 'MUNICIPAL' }, 'PRIVADO').subtipo).toBe(
      undefined,
    );
  });
});
