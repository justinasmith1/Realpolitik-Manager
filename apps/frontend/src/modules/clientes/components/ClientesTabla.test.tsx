import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';

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
