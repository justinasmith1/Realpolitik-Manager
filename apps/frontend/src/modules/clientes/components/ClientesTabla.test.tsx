import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';

// Datos ficticios, validados con el schema compartido como los que devuelve la API.
const base = {
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const cliente = (id: string, razonSocial: string, periodicidad: unknown): Cliente =>
  ClienteSchema.parse({ ...base, id, razonSocial, periodicidad });

const clientes = [
  cliente('11111111-1111-4111-a111-111111111111', 'Sin Periodicidad S.A.', null),
  cliente('22222222-2222-4222-a222-222222222222', 'Mensual S.A.', {
    tipo: 'MENSUAL',
    diaLimite: 10,
    mesInicioCiclo: null,
  }),
  cliente('33333333-3333-4333-a333-333333333333', 'Bimestral S.A.', {
    tipo: 'BIMESTRAL',
    diaLimite: 15,
    mesInicioCiclo: 3,
  }),
  cliente('44444444-4444-4444-a444-444444444444', 'Campania S.A.', {
    tipo: 'POR_CAMPANIA',
    diaLimite: 28,
    mesInicioCiclo: null,
  }),
];

/** Celda de la columna Periodicidad en la fila del cliente. */
function celdaDePeriodicidad(razonSocial: string) {
  const columnas = screen.getAllByRole('columnheader').map((th) => th.textContent);
  const fila = screen.getByRole('row', { name: new RegExp(razonSocial) });
  // La primera columna es el encabezado de fila (`th`), no una celda.
  const celda = within(fila).getAllByRole('cell')[columnas.indexOf('Periodicidad') - 1];
  if (celda === undefined) throw new Error('No hay columna Periodicidad');
  return celda;
}

describe('ClientesTabla: periodicidad (HU1.5)', () => {
  beforeEach(() => {
    render(<ClientesTabla clientes={clientes} onLimpiarFiltros={() => undefined} />);
  });

  it('agrega la columna Periodicidad entre Canal y Acciones', () => {
    const columnas = screen.getAllByRole('columnheader').map((th) => th.textContent);

    expect(columnas.slice(-3)).toEqual(['Canal', 'Periodicidad', 'Acciones']);
  });

  it('sin periodicidad muestra "Sin configurar"', () => {
    expect(celdaDePeriodicidad('Sin Periodicidad')).toHaveTextContent(/^Sin configurar$/);
  });

  it.each([
    ['Mensual S.A.', 'Mensual', 'Día 10'],
    ['Bimestral S.A.', 'Bimestral', 'Día 15 · desde Marzo'],
    ['Campania S.A.', 'Por campaña', 'Día 28'],
  ])('%s muestra el tipo y el detalle en texto legible', (razonSocial, tipo, detalle) => {
    const celda = within(celdaDePeriodicidad(razonSocial));

    expect(celda.getByText(tipo)).toBeVisible();
    expect(celda.getByText(detalle)).toBeVisible();
  });

  it('nunca muestra los valores técnicos', () => {
    const tabla = screen.getByRole('table');

    expect(tabla).not.toHaveTextContent(/MENSUAL|BIMESTRAL|POR_CAMPANIA|mesInicioCiclo/);
  });
});

describe('ClientesTabla: estado y menú de acciones (HU1.8)', () => {
  const activo = cliente('55555555-5555-4555-a555-555555555555', 'Activa S.A.', null);
  const inactivo = ClienteSchema.parse({
    ...base,
    id: '66666666-6666-4666-a666-666666666666',
    razonSocial: 'Inactiva S.A.',
    estado: 'INACTIVO',
    periodicidad: null,
  });

  const filaDe = (razonSocial: string) =>
    within(screen.getByRole('row', { name: new RegExp(razonSocial) }));
  const botonDelMenu = (razonSocial: string) =>
    screen.getByRole('button', { name: `Acciones de ${razonSocial}` });
  const abrirMenu = async (razonSocial: string) => {
    await userEvent.click(botonDelMenu(razonSocial));
    return within(await screen.findByRole('menu'));
  };
  const opciones = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

  it('cada fila tiene un solo botón de menú, con la razón social en su nombre accesible', () => {
    render(<ClientesTabla clientes={[activo, inactivo]} onLimpiarFiltros={() => undefined} />);

    expect(botonDelMenu('Activa S.A.')).toBeInTheDocument();
    expect(botonDelMenu('Inactiva S.A.')).toBeInTheDocument();
    // Las acciones no están sueltas en la fila: solo existe el botón del menú.
    expect(filaDe('Activa').getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('el botón del menú está en la columna Acciones, a la derecha de la fila', () => {
    render(<ClientesTabla clientes={[activo]} onLimpiarFiltros={() => undefined} />);

    const encabezados = screen.getAllByRole('columnheader');
    expect(encabezados.at(-1)).toHaveTextContent('Acciones');
    expect(encabezados.at(-1)).toHaveClass('text-right');
    const celdas = filaDe('Activa').getAllByRole('cell');
    expect(within(celdas.at(-1) as HTMLElement).getByRole('button')).toBe(
      botonDelMenu('Activa S.A.'),
    );
  });

  it('un cliente activo se identifica sin badge y su menú ofrece Editar, Contactos y Desactivar', async () => {
    render(<ClientesTabla clientes={[activo]} onLimpiarFiltros={() => undefined} />);

    expect(filaDe('Activa').queryByText('Inactivo')).not.toBeInTheDocument();
    const menu = await abrirMenu('Activa S.A.');

    expect(opciones()).toEqual(['Editar', 'Contactos', 'Desactivar']);
    expect(menu.queryByRole('menuitem', { name: 'Reactivar' })).not.toBeInTheDocument();
  });

  it('un cliente inactivo lleva el badge "Inactivo" y su menú ofrece Editar, Contactos y Reactivar', async () => {
    render(<ClientesTabla clientes={[inactivo]} onLimpiarFiltros={() => undefined} />);

    expect(filaDe('Inactiva').getByText('Inactivo')).toBeInTheDocument();
    const menu = await abrirMenu('Inactiva S.A.');

    expect(opciones()).toEqual(['Editar', 'Contactos', 'Reactivar']);
    expect(menu.queryByRole('menuitem', { name: 'Desactivar' })).not.toBeInTheDocument();
  });

  it('Desactivar es destructivo y va separado; Reactivar es normal y también va separado', async () => {
    render(<ClientesTabla clientes={[activo, inactivo]} onLimpiarFiltros={() => undefined} />);

    const menuActivo = await abrirMenu('Activa S.A.');
    expect(menuActivo.getByRole('menuitem', { name: 'Desactivar' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    expect(menuActivo.getByRole('menuitem', { name: 'Editar' })).toHaveAttribute(
      'data-variant',
      'default',
    );
    expect(menuActivo.getByRole('separator')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    const menuInactivo = await abrirMenu('Inactiva S.A.');
    expect(menuInactivo.getByRole('menuitem', { name: 'Reactivar' })).toHaveAttribute(
      'data-variant',
      'default',
    );
    expect(menuInactivo.getByRole('separator')).toBeInTheDocument();
  });

  it.each([
    ['Editar', 'onEditar', 'Activa S.A.', activo],
    ['Contactos', 'onAdministrarContactos', 'Activa S.A.', activo],
    ['Desactivar', 'onDesactivar', 'Activa S.A.', activo],
    ['Reactivar', 'onReactivar', 'Inactiva S.A.', inactivo],
  ] as const)(
    'elegir %s avisa con el cliente de su fila y cierra el menú',
    async (opcion, callback, razonSocial, esperado) => {
      const acciones = {
        onEditar: vi.fn(),
        onAdministrarContactos: vi.fn(),
        onDesactivar: vi.fn(),
        onReactivar: vi.fn(),
      };
      render(
        <ClientesTabla
          clientes={[activo, inactivo]}
          onLimpiarFiltros={() => undefined}
          {...acciones}
        />,
      );

      const menu = await abrirMenu(razonSocial);
      await userEvent.click(menu.getByRole('menuitem', { name: opcion }));

      expect(acciones[callback]).toHaveBeenCalledTimes(1);
      expect(acciones[callback]).toHaveBeenCalledWith(esperado);
      await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    },
  );

  it('se maneja con el teclado: Enter abre el menú, las flechas se mueven y Escape lo cierra', async () => {
    const onEditar = vi.fn();
    const onAdministrarContactos = vi.fn();
    render(
      <ClientesTabla
        clientes={[activo]}
        onLimpiarFiltros={() => undefined}
        onEditar={onEditar}
        onAdministrarContactos={onAdministrarContactos}
      />,
    );

    await userEvent.tab();
    expect(botonDelMenu('Activa S.A.')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const menu = within(await screen.findByRole('menu'));
    expect(menu.getAllByRole('menuitem')).toHaveLength(3);
    // Al abrir con el teclado queda enfocada la primera opción.
    expect(menu.getByRole('menuitem', { name: 'Editar' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(menu.getByRole('menuitem', { name: 'Contactos' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(onAdministrarContactos).toHaveBeenCalledWith(activo);
    expect(onEditar).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('Escape cierra el menú sin elegir nada', async () => {
    const onEditar = vi.fn();
    render(
      <ClientesTabla clientes={[activo]} onLimpiarFiltros={() => undefined} onEditar={onEditar} />,
    );

    await abrirMenu('Activa S.A.');
    await userEvent.keyboard('{Escape}');

    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(onEditar).not.toHaveBeenCalled();
  });

  it('deshabilita Desactivar/Reactivar del cliente cuyo cambio de estado está en curso', async () => {
    render(
      <ClientesTabla
        clientes={[activo, inactivo]}
        onLimpiarFiltros={() => undefined}
        idCambiandoEstado={activo.id}
      />,
    );

    const menuActivo = await abrirMenu('Activa S.A.');
    expect(menuActivo.getByRole('menuitem', { name: 'Desactivar' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    const menuInactivo = await abrirMenu('Inactiva S.A.');
    expect(menuInactivo.getByRole('menuitem', { name: 'Reactivar' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
