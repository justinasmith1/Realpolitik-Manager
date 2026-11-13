import type { RendicionDelMes } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { RendicionDelMesFila } from '@/modules/rendiciones/components/RendicionDelMesFila';

// Una fila de la pantalla Rendiciones (HU3.2): cliente, factura, tipo de cliente, pendientes, estado,
// avance y, solo si ya salió hacia el organismo, la fecha de su último paso. Tocarla abre su panel
// de resumen (HU3.5).

const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION_ID = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const PANEL = { search: `?rendicion=${RENDICION_ID}` };

function fila(cambios: Partial<RendicionDelMes> = {}): RendicionDelMes {
  return {
    id: RENDICION_ID,
    clienteId: CLIENTE_ID,
    cliente: { denominacion: 'Muni La Plata', sector: 'PUBLICO', subtipo: 'MUNICIPAL' },
    numeroFactura: 'B 00002-00001482',
    estado: 'EN_CURSO',
    avance: { reunidos: 2, total: 5, faltantes: 3 },
    ultimoPaso: null,
    atrasada: false,
    cobro: null,
    ...cambios,
  };
}

function renderFila(rendicion: RendicionDelMes, abierta = false) {
  return render(
    <MemoryRouter>
      <RendicionDelMesFila rendicion={rendicion} destino={PANEL} abierta={abierta} />
    </MemoryRouter>,
  );
}

// La segunda línea: "<tipo de cliente> · <pendientes> · <estado>".
const pendientes = () => screen.getByText(/pendiente/, { selector: 'p > span' });
const segundaLinea = () => pendientes().closest('p');

describe('RendicionDelMesFila', () => {
  it('muestra el cliente, la factura, el tipo, los pendientes, el estado y el avance', () => {
    renderFila(fila());

    expect(screen.getByText('MP')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Muni La Plata/ })).toBeInTheDocument();
    expect(screen.getByText('B 00002-00001482')).toHaveClass('font-mono');
    expect(segundaLinea()).toHaveTextContent(/^Municipio · 3 pendientes · En curso$/);
    const barra = screen.getByRole('progressbar', { name: 'Avance de Muni La Plata' });
    expect(barra).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('el estado es texto en el color de su estado, igual que el porcentaje (no un badge)', () => {
    renderFila(fila({ estado: 'ENVIADA' }));

    expect(screen.getByText('Enviada')).toHaveClass('text-estado-enviada');
    expect(screen.getByText('40%')).toHaveClass('text-estado-enviada');
    expect(document.querySelector('[data-slot="badge"]')).toBeNull();
  });

  it('toda la fila abre el panel de resumen: la misma pantalla, con la rendición en la URL', () => {
    renderFila(fila());

    expect(screen.getByRole('link', { name: /Muni La Plata/ })).toHaveAttribute(
      'href',
      `/?rendicion=${RENDICION_ID}`,
    );
    // Un solo enlace por fila, con la factura en su nombre para distinguir dos del mismo cliente.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAccessibleName(
      'Muni La Plata, factura B 00002-00001482',
    );
  });

  it.each([
    ['la flecha', () => document.querySelector('svg.lucide-chevron-right')],
    ['el porcentaje', () => screen.getByText('40%')],
    ['la línea del estado', () => screen.getByText('En curso')],
    ['el monograma', () => screen.getByText('MP')],
  ])(
    'tocar %s abre el panel: la flecha es un indicador dentro de la fila, no un botón',
    async (_parte, elemento) => {
      const router = createMemoryRouter(
        [
          {
            path: '/rendiciones',
            element: <RendicionDelMesFila rendicion={fila()} destino={PANEL} abierta={false} />,
          },
        ],
        { initialEntries: ['/rendiciones?anio=2026&mes=10'] },
      );
      render(<RouterProvider router={router} />);
      expect(screen.queryByRole('button')).toBeNull();

      const destino = elemento();
      expect(destino).not.toBeNull();
      await userEvent.setup().click(destino as Element);

      expect(router.state.location.pathname).toBe('/rendiciones');
      expect(router.state.location.search).toBe(`?rendicion=${RENDICION_ID}`);
    },
  );

  it('la rendición abierta en el panel queda marcada, con un fondo suave', () => {
    renderFila(fila(), true);

    const enlace = screen.getByRole('link', { name: /Muni La Plata/ });
    expect(enlace).toHaveAttribute('aria-current', 'true');
    expect(enlace).toHaveClass('aria-[current]:bg-seleccion');
  });

  it('sin abrir, no está marcada', () => {
    renderFila(fila());

    expect(screen.getByRole('link', { name: /Muni La Plata/ })).not.toHaveAttribute('aria-current');
  });

  it('el monograma va en el color del estado', () => {
    renderFila(fila({ estado: 'APROBADA' }));

    expect(screen.getByText('MP')).toHaveClass('bg-estado-aprobada-soft', 'text-estado-aprobada');
  });

  it('el enlace describe el tipo, los pendientes, el estado, el avance y la fecha', () => {
    renderFila(
      fila({
        estado: 'ENVIADA',
        ultimoPaso: { estado: 'ENVIADA', fecha: new Date('2026-11-08T15:00:00.000Z') },
      }),
    );

    expect(screen.getByRole('link')).toHaveAccessibleDescription(
      'Municipio · 3 pendientes · Enviada. Avance 40 %, Enviada 08/11',
    );
  });

  it('la segunda línea no se parte: si no entra, se recorta solo el tipo de cliente', () => {
    renderFila(
      fila({
        cliente: { denominacion: 'IPS', sector: 'PUBLICO', subtipo: 'PROVINCIAL_ORGANISMO' },
      }),
    );

    expect(segundaLinea()).toHaveClass('whitespace-nowrap');
    const tipo = screen.getByText('Provincial u organismo público');
    expect(tipo).toHaveClass('truncate', 'min-w-0');
    expect(tipo).toHaveAttribute('title', 'Provincial u organismo público');
    // Los pendientes y el estado no se achican.
    expect(pendientes()).toHaveClass('shrink-0');
    expect(pendientes()).toContainElement(screen.getByText('En curso'));
  });

  it('un cliente privado dice "Privado", sin subtipo', () => {
    renderFila(
      fila({ cliente: { denominacion: 'Zeta Producciones', sector: 'PRIVADO', subtipo: null } }),
    );

    expect(segundaLinea()).toHaveTextContent(/^Privado · /);
  });

  it('sin faltantes dice "Sin pendientes" y la barra llega al 100 %', () => {
    renderFila(fila({ estado: 'COMPLETA', avance: { reunidos: 4, total: 4, faltantes: 0 } }));

    expect(segundaLinea()).toHaveTextContent('Municipio · Sin pendientes · Completa');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('con un solo faltante dice "1 pendiente"', () => {
    renderFila(fila({ avance: { reunidos: 3, total: 4, faltantes: 1 } }));

    expect(segundaLinea()).toHaveTextContent(' 1 pendiente ');
  });

  describe('fecha del último paso', () => {
    it.each(['EN_CURSO', 'COMPLETA'] as const)('%s: sin fecha', (estado) => {
      const { container } = renderFila(fila({ estado, ultimoPaso: null }));

      expect(container.textContent).not.toMatch(/\d{2}\/\d{2}/);
    });

    it.each([
      ['ENVIADA', 'Enviada 03/11'],
      ['APROBADA', 'Aprobada 03/11'],
      ['RECHAZADA', 'Rechazada 03/11'],
    ] as const)('%s: "%s", en horario de Buenos Aires', (estado, texto) => {
      // 03:30 UTC del 4/11 es todavía el 3/11 en Buenos Aires.
      renderFila(
        fila({ estado, ultimoPaso: { estado, fecha: new Date('2026-11-04T02:30:00.000Z') } }),
      );

      expect(screen.getByText(texto)).toBeInTheDocument();
    });
  });

  it('la barra va en el color de su estado', () => {
    renderFila(fila({ estado: 'RECHAZADA' }));

    const relleno = screen.getByRole('progressbar').firstElementChild;
    expect(relleno).toHaveClass('bg-estado-rechazada');
    expect(relleno).toHaveStyle({ width: '40%' });
  });

  describe('marca de atrasada (HU3.4)', () => {
    it('en el lugar de la fecha dice "Atrasada", en rojo; el estado sigue siendo el suyo', () => {
      renderFila(fila({ estado: 'COMPLETA', atrasada: true }));

      expect(screen.getByText('Atrasada')).toHaveClass('text-atrasada');
      expect(screen.getByText('Completa')).toBeInTheDocument();
      expect(screen.getByRole('link')).toHaveAccessibleDescription(/Atrasada$/);
    });

    it('con su período (vista de atrasadas) dice "Atrasada · Septiembre 2026"', () => {
      render(
        <MemoryRouter>
          <RendicionDelMesFila
            rendicion={fila({ atrasada: true })}
            periodo={{ anio: 2026, mes: 9 }}
            destino={PANEL}
            abierta={false}
          />
        </MemoryRouter>,
      );

      expect(screen.getByText('Atrasada · Septiembre 2026')).toHaveClass('text-atrasada');
    });

    it('sin la marca no dice "Atrasada"', () => {
      renderFila(fila({ atrasada: false }));

      expect(screen.queryByText(/Atrasada/)).toBeNull();
    });
  });
});

// HU3.10: una rendición cobrada se distingue con ícono y texto y muestra el día. Con el listado ancho
// la marca va en la columna derecha, bajo la fecha del último paso (la segunda línea de la izquierda
// queda como antes); con el listado angosto, esa columna se apila y la marca vuelve a la segunda línea.
describe('RendicionDelMesFila: cobro informado por el cliente (HU3.10)', () => {
  const cobrada = (dia = '2026-11-10', estado: RendicionDelMes['estado'] = 'APROBADA') =>
    fila({
      estado,
      cobro: { fecha: dia },
      ultimoPaso: { estado: 'APROBADA', fecha: new Date('2026-11-05T15:00:00.000Z') },
    });

  /** La marca de la columna derecha (listado ancho) y la de la segunda línea (listado angosto). */
  const marcaDerecha = () => document.querySelector('[data-cobro="columna"]');
  const marcaIzquierda = () => document.querySelector('[data-cobro="linea"]');
  const columnaDeFecha = () => document.querySelector('[data-columna="fecha"]');

  it('sin cobro, no hay marca de cobrada en ninguna parte', () => {
    renderFila(fila({ estado: 'ENVIADA' }));

    expect(screen.queryByText(/Cobrada/)).not.toBeInTheDocument();
    expect(marcaDerecha()).toBeNull();
    expect(marcaIzquierda()).toBeNull();
  });

  it('con cobro, la segunda línea de la izquierda sigue siendo "tipo · pendientes · estado"', () => {
    renderFila(cobrada());

    expect(pendientes()).toHaveTextContent(/^· 3 pendientes · Aprobada$/);
    expect(pendientes()).toHaveClass('shrink-0');
    expect(pendientes()).not.toHaveTextContent(/Cobrada/);
  });

  it('con el listado ancho, la marca va en la columna derecha, apilada bajo la fecha del último paso', () => {
    renderFila(cobrada());

    const marca = marcaDerecha();
    expect(marca).toHaveTextContent('Cobrada 10/11');
    expect(columnaDeFecha()).toContainElement(marca as HTMLElement);
    expect(columnaDeFecha()?.firstElementChild).toHaveTextContent('Aprobada 05/11');
    // Solo con el listado ancho; apilada, la columna no la muestra.
    expect(marca).toHaveClass('hidden', '@min-[46rem]:inline-flex', 'text-xs');
    expect(columnaDeFecha()).toHaveClass('flex', 'flex-col', '@min-[46rem]:items-end');
  });

  it('con el listado angosto, la marca vuelve a la segunda línea, fuera del grupo que no se recorta', () => {
    renderFila(cobrada());

    const marca = marcaIzquierda();
    expect(marca).toHaveTextContent('Cobrada 10/11');
    expect(segundaLinea()).toContainElement(marca as HTMLElement);
    expect(pendientes()).not.toContainElement(marca as HTMLElement);
    // Si no entra, es la que se recorta (con el texto completo en el title), y solo con el listado angosto.
    expect(marca).toHaveClass('@min-[46rem]:hidden', 'truncate', 'min-w-0');
    expect(marca).toHaveAttribute('title', 'Cobrada 10/11');
    expect(segundaLinea()).toHaveTextContent(/^Municipio · 3 pendientes · AprobadaCobrada 10\/11$/);
  });

  it('las dos marcas usan los tokens de éxito y llevan un ícono (no depende del color)', () => {
    renderFila(cobrada());

    for (const marca of [marcaDerecha(), marcaIzquierda()]) {
      expect(marca).toHaveClass('text-success');
      expect(marca?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it.each([
    [
      'sin cobro',
      () =>
        fila({
          estado: 'ENVIADA',
          ultimoPaso: { estado: 'ENVIADA', fecha: new Date('2026-11-08T15:00:00.000Z') },
        }),
    ],
    ['con cobro', () => cobrada()],
    ['atrasada', () => fila({ atrasada: true })],
  ])('la columna de la fecha tiene el mismo ancho fijo: %s', (_caso, hacer) => {
    renderFila(hacer());

    // Ancho fijo con el listado ancho; apilada, en su propia línea, debajo de la barra (así la barra y el
    // porcentaje no dependen de cuánto mida la fecha).
    expect(columnaDeFecha()).toHaveClass(
      '@min-[46rem]:w-28',
      '@min-[46rem]:shrink-0',
      'order-last',
      'w-full',
    );
    expect(columnaDeFecha()?.className).not.toMatch(/min-w-/);
  });

  it('apilada, una columna sin nada que mostrar no ocupa una línea vacía (con el listado ancho sigue reservando su ancho)', () => {
    renderFila(fila());

    expect(columnaDeFecha()).toHaveClass('@max-[46rem]:hidden', '@min-[46rem]:w-28');
  });

  it('con algo que mostrar (fecha, "Atrasada" o cobro), la columna apilada se ve', () => {
    renderFila(fila({ atrasada: true }));

    expect(columnaDeFecha()).not.toHaveClass('@max-[46rem]:hidden');
  });

  it('en la vista de atrasadas, la columna del mes también tiene ancho fijo (no mínimo)', () => {
    render(
      <MemoryRouter>
        <RendicionDelMesFila
          rendicion={fila({ atrasada: true })}
          periodo={{ anio: 2026, mes: 9 }}
          destino={PANEL}
          abierta={false}
        />
      </MemoryRouter>,
    );

    expect(columnaDeFecha()).toHaveTextContent('Atrasada · Septiembre 2026');
    expect(columnaDeFecha()).toHaveClass('@min-[46rem]:w-44');
    expect(columnaDeFecha()?.className).not.toMatch(/min-w-/);
  });

  it('el día no se corre por la zona horaria: el 01/01 se lee 01/01', () => {
    renderFila(cobrada('2026-01-01'));

    expect(marcaDerecha()).toHaveTextContent('Cobrada 01/01');
    expect(marcaIzquierda()).toHaveTextContent('Cobrada 01/01');
  });

  it('la descripción del enlace dice que está cobrada, después del avance y la fecha', () => {
    renderFila(cobrada());

    expect(screen.getByRole('link')).toHaveAccessibleDescription(
      'Municipio · 3 pendientes · Aprobada. Avance 40 %, Aprobada 05/11. Cobrada 10/11',
    );
  });

  it('el lector de pantalla anuncia la marca una sola vez: la que no se ve no cuenta', () => {
    renderFila(cobrada());

    // Cada marca se oculta con CSS (`hidden` / `@min-[46rem]:hidden`) según el ancho: nunca están las dos.
    expect(marcaDerecha()?.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(marcaIzquierda()?.className).toMatch(/@min-\[46rem\]:hidden/);
  });
});
