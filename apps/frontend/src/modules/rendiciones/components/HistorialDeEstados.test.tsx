import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HistorialDeEstados } from '@/modules/rendiciones/components/HistorialDeEstados';
import { verboDelPaso } from '@/modules/rendiciones/rendiciones.etiquetas';

// Historial de estados de una rendición (HU3.1): cada cambio con su fecha (dd/mm/aaaa, horario de
// Buenos Aires) y un verbo según el estado nuevo, en el orden en que pasaron. Es un toggle:
// cerrado solo dice "Historial (N)"; la misma fila abre y cierra la lista. Debajo de cada paso,
// quién lo registró y cuándo (HU4.6).

// Entradas sin responsable registrado (HU4.6): así llegan las anteriores a HU4.6.
const SIN_RESPONSABLE = { registradoPor: null, origen: null } as const;
/** La línea de quién y cuándo de una entrada sin responsable: la hora es la del registro. */
const sinRegistro = (fechaYHora: string) => `Sin responsable registrado · ${fechaYHora}`;

const ALTA = {
  estadoAnterior: null,
  estadoNuevo: 'EN_CURSO',
  fecha: new Date('2026-10-01T15:00:00.000Z'),
  ...SIN_RESPONSABLE,
} as const;

const HISTORIAL = [
  ALTA,
  {
    estadoAnterior: 'EN_CURSO',
    estadoNuevo: 'COMPLETA',
    fecha: new Date('2026-10-20T15:00:00.000Z'),
    ...SIN_RESPONSABLE,
  },
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'EN_CURSO',
    fecha: new Date('2026-10-21T15:00:00.000Z'),
    ...SIN_RESPONSABLE,
  },
  {
    estadoAnterior: 'EN_CURSO',
    estadoNuevo: 'COMPLETA',
    fecha: new Date('2026-10-22T15:00:00.000Z'),
    ...SIN_RESPONSABLE,
  },
  // A las 23:30 de Buenos Aires del 2/11 ya es 3/11 en UTC: la fecha que se ve es la de acá.
  {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'ENVIADA',
    fecha: new Date('2026-11-03T02:30:00.000Z'),
    ...SIN_RESPONSABLE,
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
      `01/10/2026Se abrió enEn curso${sinRegistro('01/10/2026 12:00')}`,
      `20/10/2026Pasó aCompleta${sinRegistro('20/10/2026 12:00')}`,
      `21/10/2026Volvió aEn curso${sinRegistro('21/10/2026 12:00')}`,
      `22/10/2026Pasó aCompleta${sinRegistro('22/10/2026 12:00')}`,
      `02/11/2026Pasó aEnviada${sinRegistro('02/11/2026 23:30')}`,
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
            ...SIN_RESPONSABLE,
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
    ['RECHAZADA', 'EN_CURSO', 'Se reabrió para corregir'],
  ] as const)('de %s a %s: "%s"', (estadoAnterior, estadoNuevo, texto) => {
    expect(verboDelPaso({ estadoAnterior, estadoNuevo })).toBe(texto);
  });
});

describe('HistorialDeEstados: ciclo completo con dos rechazos (HU3.9)', () => {
  it('muestra cada envío, rechazo con su motivo y reenvío, en orden y con las fechas de envío elegidas', async () => {
    const user = userEvent.setup();
    const paso = (
      estadoAnterior: 'EN_CURSO' | 'COMPLETA' | 'ENVIADA' | 'RECHAZADA' | null,
      estadoNuevo: 'EN_CURSO' | 'COMPLETA' | 'ENVIADA' | 'RECHAZADA' | 'APROBADA',
      fecha: string,
      extra: { fechaEfectiva?: string; motivo?: string } = {},
    ) => ({
      estadoAnterior,
      estadoNuevo,
      fecha: new Date(`${fecha}T15:00:00.000Z`),
      ...SIN_RESPONSABLE,
      ...extra,
    });
    render(
      <HistorialDeEstados
        historial={[
          paso(null, 'EN_CURSO', '2026-10-01'),
          paso('EN_CURSO', 'COMPLETA', '2026-10-15'),
          // Registrada el 21/10 con la fecha de envío elegida, el 20/10.
          paso('COMPLETA', 'ENVIADA', '2026-10-21', { fechaEfectiva: '2026-10-20' }),
          paso('ENVIADA', 'RECHAZADA', '2026-10-28', { motivo: 'Falta la firma' }),
          paso('RECHAZADA', 'EN_CURSO', '2026-10-29'),
          paso('EN_CURSO', 'COMPLETA', '2026-10-30'),
          paso('COMPLETA', 'ENVIADA', '2026-11-02', { fechaEfectiva: '2026-10-31' }),
          paso('ENVIADA', 'RECHAZADA', '2026-11-05', { motivo: 'La factura tiene otro CUIT' }),
          paso('RECHAZADA', 'EN_CURSO', '2026-11-06'),
          paso('EN_CURSO', 'COMPLETA', '2026-11-07'),
          paso('COMPLETA', 'ENVIADA', '2026-11-08', { fechaEfectiva: '2026-11-08' }),
          paso('ENVIADA', 'APROBADA', '2026-11-12'),
        ]}
      />,
    );

    await user.click(seccion().getByRole('button', { name: 'Historial (12)' }));

    // En los envíos, el paso dice el día elegido y la línea de abajo, cuándo se registró.
    expect(
      seccion()
        .getAllByRole('listitem')
        .map((entrada) => entrada.textContent),
    ).toEqual([
      `01/10/2026Se abrió enEn curso${sinRegistro('01/10/2026 12:00')}`,
      `15/10/2026Pasó aCompleta${sinRegistro('15/10/2026 12:00')}`,
      `20/10/2026Pasó aEnviada${sinRegistro('21/10/2026 12:00')}`,
      `28/10/2026Fue rechazadaRechazadaFalta la firma${sinRegistro('28/10/2026 12:00')}`,
      `29/10/2026Se reabrió para corregirEn curso${sinRegistro('29/10/2026 12:00')}`,
      `30/10/2026Pasó aCompleta${sinRegistro('30/10/2026 12:00')}`,
      `31/10/2026Pasó aEnviada${sinRegistro('02/11/2026 12:00')}`,
      `05/11/2026Fue rechazadaRechazadaLa factura tiene otro CUIT${sinRegistro('05/11/2026 12:00')}`,
      `06/11/2026Se reabrió para corregirEn curso${sinRegistro('06/11/2026 12:00')}`,
      `07/11/2026Pasó aCompleta${sinRegistro('07/11/2026 12:00')}`,
      `08/11/2026Pasó aEnviada${sinRegistro('08/11/2026 12:00')}`,
      `12/11/2026Fue aprobadaAprobada${sinRegistro('12/11/2026 12:00')}`,
    ]);
  });
});

describe('HistorialDeEstados: motivo (HU3.8)', () => {
  const ENVIO = {
    estadoAnterior: 'COMPLETA',
    estadoNuevo: 'ENVIADA',
    fecha: new Date('2026-10-23T15:00:00.000Z'),
    ...SIN_RESPONSABLE,
  } as const;

  it('una entrada con motivo lo muestra debajo del paso', async () => {
    const user = userEvent.setup();
    render(
      <HistorialDeEstados
        historial={[
          ALTA,
          ENVIO,
          {
            estadoAnterior: 'ENVIADA',
            estadoNuevo: 'RECHAZADA',
            fecha: new Date('2026-10-30T15:00:00.000Z'),
            ...SIN_RESPONSABLE,
            motivo: 'Faltó el CUIT 20-12345678-4',
          },
        ]}
      />,
    );

    await user.click(seccion().getByRole('button', { name: 'Historial (3)' }));

    const rechazo = seccion().getAllByRole('listitem').at(-1);
    expect(rechazo).toHaveTextContent('Fue rechazada');
    expect(within(rechazo as HTMLElement).getByText('Faltó el CUIT 20-12345678-4')).toBeVisible();
  });

  it('una entrada con motivo null no muestra texto de motivo', async () => {
    const user = userEvent.setup();
    render(
      <HistorialDeEstados
        historial={[
          ALTA,
          ENVIO,
          {
            estadoAnterior: 'ENVIADA',
            estadoNuevo: 'APROBADA',
            fecha: new Date('2026-10-30T15:00:00.000Z'),
            ...SIN_RESPONSABLE,
            motivo: null,
          },
        ]}
      />,
    );

    await user.click(seccion().getByRole('button', { name: 'Historial (3)' }));

    expect(
      seccion()
        .getAllByRole('listitem')
        .map((entrada) => entrada.textContent),
    ).toEqual([
      `01/10/2026Se abrió enEn curso${sinRegistro('01/10/2026 12:00')}`,
      `23/10/2026Pasó aEnviada${sinRegistro('23/10/2026 12:00')}`,
      `30/10/2026Fue aprobadaAprobada${sinRegistro('30/10/2026 12:00')}`,
    ]);
  });

  it('un motivo vacío o de solo espacios no deja un renglón vacío', async () => {
    const user = userEvent.setup();
    render(<HistorialDeEstados historial={[ALTA, { ...ENVIO, motivo: '   ' }]} />);

    await user.click(seccion().getByRole('button', { name: 'Historial (2)' }));

    const envio = seccion().getAllByRole('listitem').at(-1);
    expect(envio).toHaveTextContent(/^23\/10\/2026Pasó aEnviadaSin responsable registrado · /);
    // Solo la línea de quién y cuándo: ningún párrafo de motivo, ni vacío.
    expect(envio?.querySelectorAll('p')).toHaveLength(1);
  });
});

// HU4.6: quién registró cada cambio, con su nombre actual, y cuándo (la hora del registro, en
// Buenos Aires). "Automático" marca la vuelta que hizo el sistema; su responsable sigue siendo la
// persona que sumó el requisito.
describe('HistorialDeEstados: responsable y fecha del registro (HU4.6)', () => {
  const MARIA = { id: 'a1b2c3d4-0000-4000-8000-000000000001', nombre: 'María González' };
  const JUAN = { id: 'a1b2c3d4-0000-4000-8000-000000000002', nombre: 'Juan Pérez' };
  const ALTA_DE_MARIA = {
    estadoAnterior: null,
    estadoNuevo: 'EN_CURSO',
    fecha: new Date('2026-11-16T17:32:00.000Z'),
    registradoPor: MARIA,
    origen: 'MANUAL',
  } as const;

  /** La línea de quién y cuándo de un paso (el último `<p>` de la entrada). */
  const lineaDeRegistro = (entrada: HTMLElement | undefined) =>
    entrada?.querySelector('p:last-of-type') ?? null;

  const abrir = async (n: number) => {
    await userEvent.setup().click(seccion().getByRole('button', { name: `Historial (${n})` }));
    return seccion().getAllByRole('listitem');
  };

  it('muestra el nombre del responsable y la fecha y hora del registro, sin "Manual"', async () => {
    render(<HistorialDeEstados historial={[ALTA_DE_MARIA]} />);

    const [alta] = await abrir(1);

    const linea = lineaDeRegistro(alta);
    expect(linea).toHaveTextContent(/^Registrado por María González · 16\/11\/2026 14:32$/);
    // "Registrado por" es solo para lectores de pantalla; a la vista: nombre · fecha y hora.
    expect(within(linea as HTMLElement).getByText('Registrado por')).toHaveClass('sr-only');
    expect(alta).not.toHaveTextContent(/Manual|Automático/);
  });

  it('el nombre es texto: sin enlaces, sin el id ni otros datos de la cuenta', async () => {
    render(<HistorialDeEstados historial={[ALTA_DE_MARIA]} />);

    const [alta] = await abrir(1);

    expect(within(alta as HTMLElement).queryAllByRole('link')).toHaveLength(0);
    expect(alta).not.toHaveTextContent(MARIA.id);
    expect(lineaDeRegistro(alta)).toHaveClass('wrap-anywhere');
  });

  it('una entrada anterior a HU4.6 dice "Sin responsable registrado", sin origen', async () => {
    render(<HistorialDeEstados historial={[ALTA]} />);

    const [alta] = await abrir(1);

    expect(lineaDeRegistro(alta)).toHaveTextContent(
      /^Sin responsable registrado · 01\/10\/2026 12:00$/,
    );
    expect(alta).not.toHaveTextContent(/Registrado por|Automático|Manual/);
  });

  it('la vuelta automática a En curso conserva su motivo y marca "Automático" con su responsable', async () => {
    render(
      <HistorialDeEstados
        historial={[
          ALTA_DE_MARIA,
          {
            estadoAnterior: 'COMPLETA',
            estadoNuevo: 'EN_CURSO',
            fecha: new Date('2026-11-17T13:05:00.000Z'),
            motivo: 'Revertida a En curso al agregar requisito',
            registradoPor: MARIA,
            origen: 'AUTOMATICO',
          },
        ]}
      />,
    );

    const [, vuelta] = await abrir(2);

    expect(vuelta?.textContent).toBe(
      '17/11/2026Volvió aEn cursoRevertida a En curso al agregar requisito' +
        'Registrado por María González · 17/11/2026 10:05 · Automático',
    );
    expect(vuelta).not.toHaveTextContent('Sistema');
  });

  it('un rechazo muestra su motivo y, debajo, quién lo registró', async () => {
    render(
      <HistorialDeEstados
        historial={[
          {
            estadoAnterior: 'ENVIADA',
            estadoNuevo: 'RECHAZADA',
            fecha: new Date('2026-11-05T18:00:00.000Z'),
            motivo: 'Falta la firma',
            registradoPor: JUAN,
            origen: 'MANUAL',
          },
        ]}
      />,
    );

    const [rechazo] = await abrir(1);

    const [motivo, linea] = Array.from(rechazo?.querySelectorAll('p') ?? []);
    expect(motivo).toHaveTextContent(/^Falta la firma$/);
    expect(linea).toHaveTextContent(/^Registrado por Juan Pérez · 05\/11\/2026 15:00$/);
  });

  it('la hora es la de Buenos Aires: un instante del 3/11 en UTC se registró el 2/11 a las 23:30', async () => {
    render(
      <HistorialDeEstados
        historial={[{ ...ALTA_DE_MARIA, fecha: new Date('2026-11-03T02:30:00.000Z') }]}
      />,
    );

    const [alta] = await abrir(1);

    const instante = lineaDeRegistro(alta)?.querySelector('time');
    expect(instante).toHaveAttribute('datetime', '2026-11-03T02:30:00.000Z');
    expect(instante).toHaveTextContent(/^02\/11\/2026 23:30$/);
  });

  it('en un envío, el paso lleva el día elegido y la línea de abajo, el instante del registro', async () => {
    render(
      <HistorialDeEstados
        historial={[
          {
            estadoAnterior: 'COMPLETA',
            estadoNuevo: 'ENVIADA',
            fecha: new Date('2026-11-12T12:00:00.000Z'),
            fechaEfectiva: '2026-10-05',
            registradoPor: MARIA,
            origen: 'MANUAL',
          },
        ]}
      />,
    );

    const [envio] = await abrir(1);

    const [delPaso, delRegistro] = Array.from(envio?.querySelectorAll('time') ?? []);
    expect(delPaso).toHaveAttribute('datetime', '2026-10-05');
    expect(delPaso).toHaveTextContent(/^05\/10\/2026$/);
    expect(delRegistro).toHaveAttribute('datetime', '2026-11-12T12:00:00.000Z');
    expect(delRegistro).toHaveTextContent(/^12\/11\/2026 09:00$/);
  });

  it('un historial con varias personas muestra a cada una en su paso, en orden', async () => {
    render(
      <HistorialDeEstados
        historial={[
          ALTA_DE_MARIA,
          {
            estadoAnterior: 'EN_CURSO',
            estadoNuevo: 'COMPLETA',
            fecha: new Date('2026-11-17T12:00:00.000Z'),
            registradoPor: JUAN,
            origen: 'MANUAL',
          },
          {
            estadoAnterior: 'COMPLETA',
            estadoNuevo: 'EN_CURSO',
            fecha: new Date('2026-11-18T12:00:00.000Z'),
            motivo: 'Revertida a En curso al agregar requisito',
            registradoPor: MARIA,
            origen: 'AUTOMATICO',
          },
        ]}
      />,
    );

    const entradas = await abrir(3);

    expect(entradas.map((entrada) => lineaDeRegistro(entrada)?.textContent)).toEqual([
      'Registrado por María González · 16/11/2026 14:32',
      'Registrado por Juan Pérez · 17/11/2026 09:00',
      'Registrado por María González · 18/11/2026 09:00 · Automático',
    ]);
    // Solo lectura: el único control es la fila que abre y cierra.
    expect(seccion().getAllByRole('button')).toEqual([
      seccion().getByRole('button', { name: 'Historial (3)' }),
    ]);
  });
});
