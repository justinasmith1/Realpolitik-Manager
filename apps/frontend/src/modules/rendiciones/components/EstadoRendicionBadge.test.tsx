import { EstadoRendicion } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';

import { EstadoRendicionBadge } from '@/modules/rendiciones/components/EstadoRendicionBadge';

// El badge de estado (HU3.1): solo color y texto, sin íconos, con un color propio por estado.

describe('EstadoRendicionBadge', () => {
  it.each([
    ['EN_CURSO', 'En curso'],
    ['COMPLETA', 'Completa'],
    ['ENVIADA', 'Enviada'],
    ['APROBADA', 'Aprobada'],
    ['RECHAZADA', 'Rechazada'],
  ] as const)('%s se lee "%s"', (estado, etiqueta) => {
    render(<EstadoRendicionBadge estado={estado} />);

    expect(screen.getByText(etiqueta)).toBeInTheDocument();
  });

  it('no lleva íconos: la información la da el texto', () => {
    const { container } = render(<EstadoRendicionBadge estado="ENVIADA" />);

    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('Enviada');
  });

  it('cada estado tiene su propio color, de los tokens `estado-*`, y ninguno es el de error', () => {
    const clases = EstadoRendicion.options.map((estado) => {
      const { container, unmount } = render(<EstadoRendicionBadge estado={estado} />);
      const clase = container.firstElementChild?.className ?? '';
      unmount();
      return clase;
    });

    expect(new Set(clases).size).toBe(EstadoRendicion.options.length);
    for (const clase of clases) {
      expect(clase).toMatch(/\bbg-estado-[a-z-]+-soft\b/);
      expect(clase).not.toMatch(/destructive|brand-accent/);
    }
  });
});
