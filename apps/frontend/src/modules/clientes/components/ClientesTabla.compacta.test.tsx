import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  CLIENTES_COLUMNAS_DEFAULT,
  type ClienteColumnaConfigurableId,
} from '@/modules/clientes/clientes.columnas';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';

// En pantallas angostas (< 1280px) el listado son tarjetas, no una tabla comprimida.
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

const base = {
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const privado: Cliente = ClienteSchema.parse({
  ...base,
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Privada S.A.',
  sector: 'PRIVADO',
  estado: 'ACTIVO',
  periodicidad: null,
});
const publicoInactivo: Cliente = ClienteSchema.parse({
  ...base,
  id: '22222222-2222-4222-a222-222222222222',
  razonSocial: 'Municipio Inactivo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  estado: 'INACTIVO',
  periodicidad: { tipo: 'BIMESTRAL', diaLimite: 15, mesInicioCiclo: 3 },
});

describe('ClientesTabla en pantallas angostas', () => {
  beforeEach(simularViewportCompacto);

  it('muestra una lista de tarjetas en lugar de la tabla, con un ítem por cliente', () => {
    render(
      <ClientesTabla
        clientes={[privado, publicoInactivo]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const lista = screen.getByRole('list', { name: 'Clientes' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
  });

  it('cada tarjeta conserva la información de la fila: clasificación, estado, CUIT, email, canal y periodicidad', () => {
    render(
      <ClientesTabla
        clientes={[publicoInactivo]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
      />,
    );

    const tarjeta = within(screen.getByRole('listitem'));
    expect(tarjeta.getByText('Municipio Inactivo')).toBeInTheDocument();
    expect(tarjeta.getByText('Público')).toBeInTheDocument();
    expect(tarjeta.getByText('Municipio')).toBeInTheDocument();
    expect(tarjeta.getByText('Inactivo')).toBeInTheDocument();
    expect(tarjeta.getByText('30-50001274-5')).toBeInTheDocument();
    expect(tarjeta.getByText('admin@empresa.example')).toBeInTheDocument();
    expect(tarjeta.getByText('Correo')).toBeInTheDocument();
    expect(tarjeta.getByText('Bimestral')).toBeInTheDocument();
    expect(tarjeta.getByText('Día 15 · desde Marzo')).toBeInTheDocument();
  });

  it('las columnas elegidas para la tabla de escritorio no cambian las tarjetas', () => {
    const contenidoDeTarjetas = (columnasVisibles: readonly ClienteColumnaConfigurableId[]) => {
      const { unmount } = render(
        <ClientesTabla
          clientes={[privado, publicoInactivo]}
          columnasVisibles={columnasVisibles}
          onLimpiarFiltros={() => undefined}
        />,
      );
      const contenido = screen.getAllByRole('listitem').map((tarjeta) => ({
        texto: tarjeta.textContent,
        datos: within(tarjeta)
          .getAllByRole('term')
          .map((dt) => dt.textContent),
        acciones: within(tarjeta).getAllByRole('button').length,
      }));
      unmount();
      return contenido;
    };

    const conDefaults = contenidoDeTarjetas(CLIENTES_COLUMNAS_DEFAULT);

    expect(conDefaults[0]?.datos).toEqual(['CUIT', 'Email', 'Canal', 'Periodicidad']);
    expect(contenidoDeTarjetas([])).toEqual(conDefaults);
    expect(contenidoDeTarjetas(['periodicidad', 'cuit'])).toEqual(conDefaults);
  });

  it('el menú ⋯ de la tarjeta ofrece las mismas acciones y avisa con el cliente', async () => {
    const onEditar = vi.fn();
    const onReactivar = vi.fn();
    render(
      <ClientesTabla
        clientes={[privado, publicoInactivo]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
        onEditar={onEditar}
        onReactivar={onReactivar}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Acciones de Privada S.A.' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Editar',
      'Contactos',
      'Matriz de requisitos',
      'Desactivar',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Editar' }));
    expect(onEditar).toHaveBeenCalledWith(privado);
    await vi.waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Acciones de Municipio Inactivo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivar' }));
    expect(onReactivar).toHaveBeenCalledWith(publicoInactivo);
  });

  it('sin resultados muestra el mismo aviso que en escritorio', () => {
    render(
      <ClientesTabla
        clientes={[]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No hay clientes que coincidan' })).toBeVisible();
  });
});
