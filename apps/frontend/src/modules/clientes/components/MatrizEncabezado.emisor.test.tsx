import type { Cliente } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';

import { etiquetasEmisor, TEXTO_EMISOR_PENDIENTE } from '@/modules/clientes/clientes.etiquetas';
import { MatrizEncabezado } from '@/modules/clientes/components/MatrizEncabezado';

// Datos ficticios.
const cliente = {
  id: 'c3d4e5f6-a7b8-4901-8def-012345678901',
  razonSocial: 'Municipio de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'compras@municipio.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: new Date('2026-10-08T12:00:00.000Z'),
  actualizadoEn: new Date('2026-10-08T12:00:00.000Z'),
} as Cliente;

const renderEncabezado = (aMostrar: Cliente) =>
  render(<MatrizEncabezado cliente={aMostrar} tituloRef={null} />);

/** El valor del dato "Emisor" de la ficha. */
const valorDelEmisor = () => {
  const termino = screen.getByText('Emisor', { selector: 'dt' });
  return within(termino.parentElement as HTMLElement).getByRole('definition');
};

describe('MatrizEncabezado: emisor', () => {
  it.each(['PERSONA_FISICA', 'SOCIEDAD'] as const)(
    'muestra el emisor %s con su etiqueta y sin el marcador de pendiente',
    (emisor) => {
      renderEncabezado({ ...cliente, emisor });

      expect(valorDelEmisor()).toHaveTextContent(etiquetasEmisor[emisor]);
      expect(screen.queryByText(TEXTO_EMISOR_PENDIENTE)).not.toBeInTheDocument();
    },
  );

  it('sin emisor lo marca como pendiente con texto y con un punto de color de diseño', () => {
    renderEncabezado(cliente);

    const marcador = within(valorDelEmisor()).getByText(TEXTO_EMISOR_PENDIENTE);
    expect(marcador).toHaveClass('text-warning');
    expect(marcador.querySelector('.bg-warning')).not.toBeNull();
  });

  it('un cliente inactivo también muestra su emisor', () => {
    renderEncabezado({ ...cliente, estado: 'INACTIVO', emisor: 'SOCIEDAD' });

    expect(valorDelEmisor()).toHaveTextContent(etiquetasEmisor.SOCIEDAD);
  });
});
