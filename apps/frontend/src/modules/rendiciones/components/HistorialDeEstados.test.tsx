import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HistorialDeEstados } from '@/modules/rendiciones/components/HistorialDeEstados';
import { verboDelPaso } from '@/modules/rendiciones/rendiciones.etiquetas';

// Historial de estados de una rendición (HU3.1): cada cambio con su fecha (dd/mm/aaaa, horario de
// Buenos Aires) y un verbo según el estado nuevo, en el orden en que pasaron. Es un toggle:
// cerrado solo dice "Historial (N)"; la misma fila abre y cierra la lista.

const ALTA = {
  estadoAnterior: null,
  estadoNuevo: 'EN_CURSO',
  fecha: new Date('2026-10-01T15:00:00.000Z'),
} as const;

const HISTORIAL = [
  ALTA,
  {
    estadoAnterior: 'EN_CURSO',
    estadoNuevo: 'COMPLETA',
    fecha: new Date('2026-10-20T15:00:00.000Z'),
  },
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'EN_CURSO',
    fecha: new Date('2026-10-21T15:00:00.000Z'),
  },
  {
    estadoAnterior: 'EN_CURSO',
    estadoNuevo: 'COMPLETA',
    fecha: new Date('2026-10-22T15:00:00.000Z'),
  },
  // A las 23:30 de Buenos Aires del 2/11 ya es 3/11 en UTC: la fecha que se ve es la de acá.
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'ENVIADA',
    fecha: new Date('2026-11-03T02:30:00.000Z'),
  },
] as const;

const seccion = () => within(screen.getByRole('region', { name: 'Historial' }));

describe('HistorialDeEstados: toggle', () => {
  it('cerrado solo muestra "Historial (N)", sin el último paso ni la lista', () => {
    render(<HistorialDeEstados historial={HISTORIAL} />);

    const fila = seccion().getByRole('button', { name: 'Historial (5)' });
    expect(fila).toHaveAttribute('aria-expanded', 'false');
    expect(seccion().queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText(/Ver todo|Ocultar/)).not.toBeInTheDocument();
    // El último paso ya está en la línea de Estado: cerrado no se repite.
    expect(screen.queryByText(/02\/11\/2026/, { ignore: 'ol *, script, style' })).toBeNull();
  });

  it('la misma fila abre la lista en orden, con los verbos, y la vuelve a cerrar', async () => {
    const user = userEvent.setup();
    render(<HistorialDeEstados historial={HISTORIAL} />);
    const fila = seccion().getByRole('button', { name: 'Historial (5)' });

    await user.click(fila);

    expect(fila).toHaveAttribute('aria-expanded', 'true');
    expect(
      seccion()
        .getAllByRole('listitem')
        .map((entrada) => entrada.textContent),
    ).toEqual([
      '01/10/2026Se abrió enEn curso',
      '20/10/2026Pasó aCompleta',
      '21/10/2026Volvió aEn curso',
      '22/10/2026Pasó aCompleta',
      '02/11/2026Pasó aEnviada',
    ]);
    expect(seccion().getAllByRole('button')).toEqual([fila]);

    await user.click(fila);
    expect(fila).toHaveAttribute('aria-expanded', 'false');
    expect(seccion().queryAllByRole('listitem')).toHaveLength(0);
  });

  it('la flecha gira al abrir, sin animación si se pide menos movimiento', async () => {
    const user = userEvent.setup();
    render(<HistorialDeEstados historial={HISTORIAL} />);
    const fila = seccion().getByRole('button', { name: 'Historial (5)' });
    const flecha = fila.querySelector('svg');
    expect(flecha).toHaveClass('transition-transform', 'motion-reduce:transition-none');
    expect(flecha).not.toHaveClass('rotate-90');

    await user.click(fila);
    expect(flecha).toHaveClass('rotate-90');
  });

  it('la fila controla la lista (aria-controls) y funciona con Enter y Espacio', async () => {
    const user = userEvent.setup();
    render(<HistorialDeEstados historial={HISTORIAL} />);
    const fila = seccion().getByRole('button', { name: 'Historial (5)' });
    const lista = document.getElementById(fila.getAttribute('aria-controls') ?? '');
    expect(lista?.tagName).toBe('OL');
    expect(lista).not.toBeVisible();

    await user.tab();
    expect(fila).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(lista).toBeVisible();
    await user.keyboard(' ');
    expect(lista).not.toBeVisible();
  });

  it('con una sola entrada también es un toggle: "Historial (1)" y adentro "Se abrió en"', async () => {
    const user = userEvent.setup();
    render(<HistorialDeEstados historial={[ALTA]} />);

    expect(screen.queryByText('Se abrió en', { ignore: 'ol *, script, style' })).toBeNull();
    await user.click(seccion().getByRole('button', { name: 'Historial (1)' }));
    expect(seccion().getByRole('listitem')).toHaveTextContent('01/10/2026Se abrió enEn curso');
  });

  it('la fecha va en un <time> con el instante exacto; en el envío, el día elegido', async () => {
    const user = userEvent.setup();
    render(
      <HistorialDeEstados
        historial={[
          ALTA,
          {
            estadoAnterior: 'EN_CURSO',
            estadoNuevo: 'ENVIADA',
            fecha: new Date('2026-11-12T12:00:00.000Z'),
            fechaEfectiva: '2026-10-05',
          },
        ]}
      />,
    );
    await user.click(seccion().getByRole('button', { name: 'Historial (2)' }));

    const [alta, envio] = seccion().getAllByRole('listitem');
    expect(alta?.querySelector('time')).toHaveAttribute('datetime', '2026-10-01T15:00:00.000Z');
    expect(envio?.querySelector('time')).toHaveAttribute('datetime', '2026-10-05');
    expect(envio).toHaveTextContent('05/10/2026');
  });
});

describe('verboDelPaso', () => {
  it.each([
    [null, 'EN_CURSO', 'Se abrió en'],
    ['EN_CURSO', 'COMPLETA', 'Pasó a'],
    ['COMPLETA', 'EN_CURSO', 'Volvió a'],
    ['COMPLETA', 'ENVIADA', 'Pasó a'],
    ['ENVIADA', 'APROBADA', 'Fue aprobada'],
    ['ENVIADA', 'RECHAZADA', 'Fue rechazada'],
  ] as const)('de %s a %s: "%s"', (estadoAnterior, estadoNuevo, texto) => {
    expect(verboDelPaso({ estadoAnterior, estadoNuevo })).toBe(texto);
  });
});
