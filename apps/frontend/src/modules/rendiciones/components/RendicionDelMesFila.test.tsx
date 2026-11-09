import type { RendicionDelMes } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { RendicionDelMesFila } from '@/modules/rendiciones/components/RendicionDelMesFila';

// Una fila de la pantalla Rendiciones (HU3.2): cliente, factura, tipo de cliente, pendientes, estado,
// avance y, solo si ya salió hacia el organismo, la fecha de su último paso.

const CLIENTE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const RENDICION_ID = 'e1f2a3b4-c5d6-4789-8abc-def012345678';

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
    ...cambios,
  };
}

function renderFila(rendicion: RendicionDelMes) {
  return render(
    <MemoryRouter>
      <RendicionDelMesFila rendicion={rendicion} />
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

  it('toda la fila lleva al detalle de la rendición', () => {
    renderFila(fila());

    expect(screen.getByRole('link', { name: /Muni La Plata/ })).toHaveAttribute(
      'href',
      `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
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
    'tocar %s abre el detalle: la flecha es un indicador dentro de la fila, no un botón',
    async (_parte, elemento) => {
      const router = createMemoryRouter(
        [
          { path: '/rendiciones', element: <RendicionDelMesFila rendicion={fila()} /> },
          { path: '/clientes/:clienteId/rendiciones/:rendicionId', element: <h1>Detalle</h1> },
        ],
        { initialEntries: ['/rendiciones'] },
      );
      render(<RouterProvider router={router} />);
      expect(screen.queryByRole('button')).toBeNull();

      const destino = elemento();
      expect(destino).not.toBeNull();
      await userEvent.setup().click(destino as Element);

      expect(router.state.location.pathname).toBe(
        `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
      );
      expect(screen.getByRole('heading', { name: 'Detalle' })).toBeInTheDocument();
    },
  );

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
