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

  it('colorea distinto cada sector, con tokens del tema y sin los colores de estado o error', () => {
    render(
      <>
        <SectorBadge sector="PUBLICO" />
        <SectorBadge sector="PRIVADO" />
      </>,
    );

    const publico = screen.getByText('Público').className;
    const privado = screen.getByText('Privado').className;
    expect(publico).not.toBe(privado);
    for (const clase of [publico, privado]) {
      expect(clase).not.toMatch(/success|warning|destructive/);
    }
  });

  it('acepta únicamente un ClienteSector', () => {
    expectTypeOf<ComponentProps<typeof SectorBadge>['sector']>().toEqualTypeOf<ClienteSector>();
  });
});
