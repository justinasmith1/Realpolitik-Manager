import { render, screen, within } from '@testing-library/react';

import { HistorialDeEstados } from '@/modules/rendiciones/components/HistorialDeEstados';

// Historial de estados de una rendición (HU3.1): cada cambio con su fecha (dd/mm/aaaa, horario de
// Buenos Aires), en el orden en que pasaron.

const HISTORIAL = [
  { estadoAnterior: null, estadoNuevo: 'EN_CURSO', fecha: new Date('2026-10-01T15:00:00.000Z') },
  {
    estadoAnterior: 'EN_CURSO',
    estadoNuevo: 'COMPLETA',
    fecha: new Date('2026-10-20T15:00:00.000Z'),
  },
  // A las 23:30 de Buenos Aires del 2/11 ya es 3/11 en UTC: la fecha que se ve es la de acá.
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'ENVIADA',
    fecha: new Date('2026-11-03T02:30:00.000Z'),
  },
] as const;

describe('HistorialDeEstados', () => {
  it('muestra cada cambio en orden, del más viejo al más nuevo, con su fecha', () => {
    render(<HistorialDeEstados historial={HISTORIAL} />);

    const seccion = screen.getByRole('region', { name: 'Historial' });
    const entradas = within(seccion).getAllByRole('listitem');
    expect(entradas.map((entrada) => entrada.textContent)).toEqual([
      '01/10/2026Se abrió enEn curso',
      '20/10/2026De En curso aCompleta',
      '02/11/2026De Completa aEnviada',
    ]);
  });

  it('la fecha va en un <time> con el instante exacto', () => {
    render(<HistorialDeEstados historial={HISTORIAL} />);

    const [primera] = screen.getAllByRole('listitem');
    expect(primera?.querySelector('time')).toHaveAttribute('datetime', '2026-10-01T15:00:00.000Z');
  });
});
