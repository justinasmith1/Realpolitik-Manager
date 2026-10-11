import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ClienteColumnaConfigurableId } from '@/modules/clientes/clientes.columnas';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';

// Datos ficticios, validados con el schema compartido como los que devuelve la API.
const base = {
  denominacion: 'Empresa Ejemplo',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  estado: 'ACTIVO',
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

const privada: Cliente = ClienteSchema.parse({
  ...base,
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Privada S.A.',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  emailContacto: 'privada@empresa.example',
  periodicidad: { tipo: 'MENSUAL', diaLimite: 10, mesInicioCiclo: null },
});
const municipio: Cliente = ClienteSchema.parse({
  ...base,
  id: '22222222-2222-4222-a222-222222222222',
  razonSocial: 'Municipio Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  emailContacto: 'muni@ejemplo.example',
  periodicidad: null,
});

function renderTabla(columnasVisibles: readonly ClienteColumnaConfigurableId[]) {
  render(
    <ClientesTabla
      clientes={[privada, municipio]}
      columnasVisibles={columnasVisibles}
      onLimpiarFiltros={() => undefined}
      onEditar={() => undefined}
    />,
  );
}

const encabezados = () => screen.getAllByRole('columnheader').map((th) => th.textContent);

/** Texto de cada celda de la fila, en orden; el primero es el encabezado de fila (Cliente). */
function celdasDe(razonSocial: string) {
  const fila = within(screen.getByRole('row', { name: new RegExp(razonSocial) }));
  return [fila.getByRole('rowheader'), ...fila.getAllByRole('cell')];
}

describe('ClientesTabla: columnas visibles en escritorio', () => {
  it('ocultar Email lo saca del encabezado y de cada fila', () => {
    renderTabla(['cuit', 'sector', 'subtipo', 'canal', 'periodicidad']);

    expect(encabezados()).toEqual([
      'Cliente',
      'CUIT',
      'Sector',
      'Subtipo',
      'Canal',
      'Periodicidad',
      'Acciones',
    ]);
    expect(screen.queryByText('privada@empresa.example')).not.toBeInTheDocument();
    expect(screen.queryByText('muni@ejemplo.example')).not.toBeInTheDocument();
    expect(celdasDe('Privada S.A.')).toHaveLength(7);
    expect(celdasDe('Municipio Ejemplo')).toHaveLength(7);
  });

  it('respeta el orden recibido en los encabezados y en las celdas de cada fila', () => {
    renderTabla(['email', 'cuit', 'canal']);

    expect(encabezados()).toEqual(['Cliente', 'Email de contacto', 'CUIT', 'Canal', 'Acciones']);
    const [cliente, email, cuit, canal, acciones] = celdasDe('Privada S.A.');
    expect(cliente).toHaveTextContent('Privada S.A.');
    expect(email).toHaveTextContent('privada@empresa.example');
    expect(cuit).toHaveTextContent('20-12345678-6');
    expect(canal).toHaveTextContent('Correo');
    expect(within(acciones ?? document.body).getByRole('button')).toHaveAccessibleName(
      'Acciones de Privada S.A.',
    );
  });

  it('mantiene el formato de cada celda al moverla', () => {
    renderTabla(['periodicidad', 'subtipo', 'email', 'cuit']);

    const [, periodicidad, subtipo, email, cuit] = celdasDe('Privada S.A.');
    expect(periodicidad).toHaveTextContent('MensualDía 10');
    expect(within(subtipo ?? document.body).getByLabelText('Sin subtipo')).toBeInTheDocument();
    expect(within(email ?? document.body).getByTitle('privada@empresa.example')).toHaveClass(
      'truncate',
    );
    expect(cuit).toHaveClass('font-mono', 'whitespace-nowrap');

    const [, periodicidadMuni, subtipoMuni] = celdasDe('Municipio Ejemplo');
    expect(periodicidadMuni).toHaveTextContent('Sin configurar');
    expect(subtipoMuni).toHaveTextContent('Municipio');
  });

  it('Cliente queda siempre primera y Acciones siempre última, fija a la derecha', () => {
    renderTabla(['canal', 'periodicidad']);

    const columnas = screen.getAllByRole('columnheader');
    expect(columnas.at(0)).toHaveTextContent('Cliente');
    expect(columnas.at(-1)).toHaveTextContent('Acciones');
    expect(columnas.at(-1)).toHaveClass('sticky', 'right-0');
    expect(celdasDe('Privada S.A.').at(-1)).toHaveClass('sticky', 'right-0');
    // La primera celda sigue siendo el encabezado de fila, con denominación y estado.
    expect(celdasDe('Privada S.A.').at(0)).toHaveTextContent('Privada S.A.Empresa Ejemplo');
  });

  it('sin columnas opcionales quedan solo Cliente y Acciones, sin encabezados vacíos', () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderTabla([]);

    expect(encabezados()).toEqual(['Cliente', 'Acciones']);
    for (const razonSocial of ['Privada S.A.', 'Municipio Ejemplo']) {
      const [cliente, acciones] = celdasDe(razonSocial);
      expect(celdasDe(razonSocial)).toHaveLength(2);
      expect(cliente).toHaveTextContent(razonSocial);
      expect(acciones).toHaveClass('sticky', 'right-0');
    }
    expect(errores).not.toHaveBeenCalled();
    errores.mockRestore();
  });

  it('con pocas columnas el menú de acciones sigue funcionando', async () => {
    const onEditar = vi.fn();
    render(
      <ClientesTabla
        clientes={[privada]}
        columnasVisibles={['sector']}
        onLimpiarFiltros={() => undefined}
        onEditar={onEditar}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Acciones de Privada S.A.' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar' }));

    expect(onEditar).toHaveBeenCalledExactlyOnceWith(privada);
  });

  it('cambiar el orden no genera advertencias de React (keys por columna)', () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const props = { clientes: [privada, municipio], onLimpiarFiltros: () => undefined };
    const { rerender } = render(<ClientesTabla {...props} columnasVisibles={['cuit', 'email']} />);

    rerender(<ClientesTabla {...props} columnasVisibles={['email', 'canal', 'cuit']} />);

    expect(encabezados()).toEqual(['Cliente', 'Email de contacto', 'Canal', 'CUIT', 'Acciones']);
    expect(errores).not.toHaveBeenCalled();
    errores.mockRestore();
  });
});
