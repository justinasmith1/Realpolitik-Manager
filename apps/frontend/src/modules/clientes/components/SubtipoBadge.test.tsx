import { render, screen } from '@testing-library/react';

import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';

describe('SubtipoBadge', () => {
  it.each([
    ['MUNICIPAL', 'Municipio'],
    ['PROVINCIAL_ORGANISMO', 'Provincial u organismo público'],
    ['SINDICAL_OBRA_SOCIAL', 'Sindicato u obra social'],
  ] as const)('muestra el subtipo %s como "%s"', (subtipo, texto) => {
    render(<SubtipoBadge subtipo={subtipo} />);

    expect(screen.getByText(texto)).toBeVisible();
  });

  it('cada subtipo tiene colores distintos, sin íconos', () => {
    const { container } = render(
      <>
        <SubtipoBadge subtipo="MUNICIPAL" />
        <SubtipoBadge subtipo="PROVINCIAL_ORGANISMO" />
        <SubtipoBadge subtipo="SINDICAL_OBRA_SOCIAL" />
      </>,
    );

    const clases = ['Municipio', 'Provincial u organismo público', 'Sindicato u obra social'].map(
      (texto) => screen.getByText(texto).className,
    );
    expect(new Set(clases).size).toBe(3);
    expect(container.querySelector('svg')).toBeNull();
  });
});
