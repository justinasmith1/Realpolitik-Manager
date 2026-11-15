// Tabla y tarjetas según las acciones que recibe (HU4.3): el menú muestra solo esas, y sin
// ninguna no queda ni el botón ni la columna "Acciones". Las acciones las decide la página con
// los permisos de la sesión (ver `ClientesPage.permisos.test.tsx`).

import { ClienteSchema } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CLIENTES_COLUMNAS_DEFAULT } from '@/modules/clientes/clientes.columnas';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';

const cliente = ClienteSchema.parse({
  id: '55555555-5555-4555-a555-555555555555',
  razonSocial: 'Activa S.A.',
  denominacion: 'Activa',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'activa@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
});

/** Lo que la página le pasa a CONSULTA: solo lecturas. */
const accionesDeLectura = {
  onVerFicha: vi.fn(),
  onVerContactos: vi.fn(),
  onVerMatriz: vi.fn(),
};

function simularViewportCompacto() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

afterEach(() => vi.restoreAllMocks());

const opciones = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

const sinPreparar = (): void => undefined;

describe.each([
  ['tabla', sinPreparar],
  ['tarjetas', simularViewportCompacto],
] as const)('ClientesTabla (%s) con acciones de lectura', (_vista, preparar: () => void) => {
  it('el menú ofrece Ver ficha, Ver contactos y Ver requisitos, y cada una avisa con su cliente', async () => {
    preparar();
    render(
      <ClientesTabla
        clientes={[cliente]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
        {...accionesDeLectura}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Acciones de Activa S.A.' }));
    const menu = within(await screen.findByRole('menu'));

    expect(opciones()).toEqual(['Ver ficha', 'Ver contactos', 'Ver requisitos']);
    expect(menu.queryByRole('separator')).not.toBeInTheDocument();
    await userEvent.click(menu.getByRole('menuitem', { name: 'Ver ficha' }));
    expect(accionesDeLectura.onVerFicha).toHaveBeenCalledWith(cliente);
  });
});

describe('ClientesTabla sin ninguna acción', () => {
  it('en la tabla no hay botón de menú ni columna "Acciones"', () => {
    render(
      <ClientesTabla
        clientes={[cliente]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).not.toContain(
      'Acciones',
    );
    // Cada fila tiene tantas celdas como columnas opcionales: ninguna vacía de más.
    const fila = screen.getByRole('row', { name: /Activa S\.A\./ });
    expect(within(fila).getAllByRole('cell')).toHaveLength(CLIENTES_COLUMNAS_DEFAULT.length);
  });

  it('en las tarjetas no queda el botón del menú', () => {
    simularViewportCompacto();
    render(
      <ClientesTabla
        clientes={[cliente]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
      />,
    );

    expect(screen.getByRole('list', { name: 'Clientes' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
