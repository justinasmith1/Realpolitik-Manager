import type { ClienteEstadoType } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { IndicacionesArmadoSection } from '@/modules/clientes/components/IndicacionesArmadoSection';

const ID = 'indicaciones';

interface Opciones {
  inicial?: string;
  error?: string | null;
  estadoCliente?: ClienteEstadoType;
  cargando?: boolean;
  errorAlCargar?: boolean;
}

/** La sección es controlada: el estado lo tiene quien la usa (en la app, `ClienteForm`). */
function ConEstado({ inicial = '', error = null, ...resto }: Opciones) {
  const [valor, setValor] = useState(inicial);
  return (
    <IndicacionesArmadoSection id={ID} valor={valor} onCambio={setValor} error={error} {...resto} />
  );
}

function renderSeccion(opciones: Opciones = {}) {
  render(<ConEstado {...opciones} />);
  return { user: userEvent.setup() };
}

const textarea = () => screen.getByLabelText('Instrucciones para el legajo');

describe('IndicacionesArmadoSection (HU2.4)', () => {
  it('avisa una sola vez que no se guarden contraseñas', () => {
    renderSeccion();

    expect(
      screen.getAllByText('No guardes contraseñas ni credenciales de portales en este campo.'),
    ).toHaveLength(1);
  });

  it('muestra un solo contador, que arranca en 0 y sigue lo que se escribe', async () => {
    const { user } = renderSeccion();

    expect(screen.getAllByTestId('contador-caracteres')).toHaveLength(1);
    expect(screen.getByTestId('contador-caracteres')).toHaveTextContent('0 / 1000');

    await user.type(textarea(), 'Todo en un PDF');

    expect(screen.getByTestId('contador-caracteres')).toHaveTextContent('14 / 1000');
  });

  it('conserva los saltos de línea', async () => {
    const { user } = renderSeccion();

    await user.click(textarea());
    await user.paste('Factura primero.\nDespués los prints.');

    expect(textarea()).toHaveValue('Factura primero.\nDespués los prints.');
  });

  it('describe el campo con ids que existen: aviso, ayuda y contador', () => {
    renderSeccion();

    const ids = textarea().getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toEqual([`${ID}-aviso`, `${ID}-ayuda`, `${ID}-contador`]);
    for (const id of ids) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('con un error, lo muestra, marca el campo y lo suma a la descripción', () => {
    renderSeccion({ error: 'Las indicaciones no pueden superar los 1000 caracteres.' });

    expect(textarea()).toHaveAttribute('aria-invalid', 'true');
    expect(textarea()).toHaveAccessibleDescription(
      expect.stringContaining('Las indicaciones no pueden superar los 1000 caracteres.'),
    );
    expect(document.getElementById(`${ID}-error`)).not.toBeNull();
  });

  it('marca el contador cuando se pasa del límite', () => {
    renderSeccion({ inicial: 'x'.repeat(1001) });

    expect(screen.getByTestId('contador-caracteres')).toHaveTextContent('1001 / 1000');
    expect(screen.getByTestId('contador-caracteres')).toHaveClass('text-destructive');
  });

  it('no tiene un botón propio de guardar: se envía con el formulario del cliente', () => {
    renderSeccion();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['INACTIVO', 'inactivo'],
    ['SUSPENDIDO', 'suspendido'],
  ] as const)(
    'con el cliente %s se lee pero no se edita, y se dice por qué',
    (estado, etiqueta) => {
      renderSeccion({ inicial: 'Factura primero.', estadoCliente: estado });

      expect(textarea()).toBeDisabled();
      expect(textarea()).toHaveValue('Factura primero.');
      expect(
        screen.getByText(
          `El cliente está ${etiqueta}: reactivalo para editar sus indicaciones de armado.`,
        ),
      ).toBeInTheDocument();
    },
  );

  it('con el cliente ACTIVO se puede editar', () => {
    renderSeccion({ estadoCliente: 'ACTIVO' });

    expect(textarea()).toBeEnabled();
  });

  it('mientras cargan las guardadas no se edita', () => {
    renderSeccion({ cargando: true });

    expect(textarea()).toBeDisabled();
    expect(textarea()).toHaveAttribute('aria-busy', 'true');
  });

  it('si no se pudieron cargar, no se edita y se avisa', () => {
    renderSeccion({ errorAlCargar: true });

    expect(textarea()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos cargar las indicaciones de armado.',
    );
  });
});
