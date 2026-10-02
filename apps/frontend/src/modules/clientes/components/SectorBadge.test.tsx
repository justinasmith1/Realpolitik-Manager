import type { ClienteSector } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { SectorBadge } from '@/modules/clientes/components/SectorBadge';

describe('SectorBadge', () => {
  it.each([
    ['PUBLICO', 'Público'],
    ['PRIVADO', 'Privado'],
  ] as const)('muestra el sector %s como el texto "%s"', (sector, texto) => {
    render(<SectorBadge sector={sector} />);

    expect(screen.getByText(texto)).toBeVisible();
  });

  it('distingue los dos sectores por su texto, no solo por el estilo', () => {
    render(
      <>
        <SectorBadge sector="PUBLICO" />
        <SectorBadge sector="PRIVADO" />
      </>,
    );

    expect(screen.getByText('Público')).toBeVisible();
    expect(screen.getByText('Privado')).toBeVisible();
  });

  it('acepta únicamente un ClienteSector', () => {
    expectTypeOf<ComponentProps<typeof SectorBadge>['sector']>().toEqualTypeOf<ClienteSector>();
  });
});
