import { ClienteSchema } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';

import {
  CLIENTES_COLUMNAS_CONFIGURABLES,
  CLIENTES_COLUMNAS_CONFIGURABLES_IDS,
  CLIENTES_COLUMNAS_DEFAULT,
  type ClienteColumnaConfigurableId,
} from '@/modules/clientes/clientes.columnas';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';

// Chequeo de tipos (lo verifica `tsc`): solo se aceptan ids de columnas configurables.
// @ts-expect-error: 'telefono' no es una columna de Clientes.
const _idInexistente: ClienteColumnaConfigurableId = 'telefono';
// @ts-expect-error: 'cliente' es una columna fija, no configurable.
const _columnaFija: ClienteColumnaConfigurableId = 'cliente';

// Dato ficticio, validado con el schema compartido como los que devuelve la API.
const cliente = ClienteSchema.parse({
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Empresa de Ejemplo S.A.',
  denominacion: 'Empresa Ejemplo',
  cuit: '20-12345678-6',
  sector: 'PRIVADO',
  ivaCondicion: 'RESPONSABLE_INSCRIPTO',
  emailContacto: 'admin@empresa.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
});

describe('columnas de Clientes', () => {
  it('las configurables son las seis opcionales, sin Cliente ni Acciones', () => {
    expect(CLIENTES_COLUMNAS_CONFIGURABLES_IDS).toEqual([
      'cuit',
      'sector',
      'subtipo',
      'email',
      'canal',
      'periodicidad',
    ]);
  });

  it('los defaults con sus labels reproducen los encabezados de la tabla actual', () => {
    const labels = new Map(CLIENTES_COLUMNAS_CONFIGURABLES.map((c) => [c.id, c.label]));
    render(
      <ClientesTabla
        clientes={[cliente]}
        columnasVisibles={CLIENTES_COLUMNAS_DEFAULT}
        onLimpiarFiltros={() => undefined}
      />,
    );

    const encabezados = screen.getAllByRole('columnheader').map((th) => th.textContent);

    expect(encabezados).toEqual([
      'Cliente',
      ...CLIENTES_COLUMNAS_DEFAULT.map((id) => labels.get(id)),
      'Acciones',
    ]);
  });
});
