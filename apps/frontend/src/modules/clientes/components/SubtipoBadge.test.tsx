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
});
