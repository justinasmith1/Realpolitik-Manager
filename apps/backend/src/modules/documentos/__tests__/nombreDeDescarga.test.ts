import { describe, expect, it } from 'vitest';

import { contentDispositionDeDescarga } from '../nombreDeDescarga';

describe('contentDispositionDeDescarga', () => {
  it('siempre es attachment, con el nombre en ASCII y en UTF-8', () => {
    expect(contentDispositionDeDescarga('constancia.pdf')).toBe(
      `attachment; filename="constancia.pdf"; filename*=UTF-8''constancia.pdf`,
    );
  });

  it('conserva acentos y ñ en filename*, y los quita en la versión ASCII', () => {
    expect(contentDispositionDeDescarga('Constancia año 2026 — octubre.pdf')).toBe(
      `attachment; filename="Constancia ano 2026 _ octubre.pdf"; ` +
        `filename*=UTF-8''Constancia%20a%C3%B1o%202026%20%E2%80%94%20octubre.pdf`,
    );
  });

  it('no deja cerrar las comillas, agregar parámetros ni partir la cabecera', () => {
    const cabecera = contentDispositionDeDescarga('a";\r\nSet-Cookie: x=1;b\\c.pdf');
    expect(cabecera).not.toMatch(/[\r\n]/);
    expect(cabecera.split('filename=')[1]?.split(';')[0]).toBe('"a__Set-Cookie_ x_1_b_c.pdf"');
    expect(cabecera).toContain(`filename*=UTF-8''a%22%3BSet-Cookie%3A%20x%3D1%3Bb%5Cc.pdf`);
  });

  it("codifica los caracteres que RFC 8187 no admite sin escapar (' ( ) *)", () => {
    expect(contentDispositionDeDescarga("o'brien (1)*.pdf")).toContain(
      `filename*=UTF-8''o%27brien%20%281%29%2A.pdf`,
    );
  });

  it('usa un nombre de respaldo si no queda nada legible', () => {
    // La ñ se descompone (n + tilde) y queda la n.
    expect(contentDispositionDeDescarga('ñññ')).toContain('filename="nnn"');
    expect(contentDispositionDeDescarga('   ')).toBe(
      `attachment; filename="documento"; filename*=UTF-8''documento`,
    );
    expect(contentDispositionDeDescarga('…')).toContain('filename="documento"');
  });
});
