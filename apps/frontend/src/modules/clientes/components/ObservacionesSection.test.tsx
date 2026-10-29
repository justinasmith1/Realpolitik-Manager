import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { ObservacionesSection } from '@/modules/clientes/components/ObservacionesSection';
import { AVISO_SIN_CREDENCIALES } from '@/modules/clientes/components/textosFichaCliente';

// Sección "Observaciones internas" del formulario del cliente (HU2.10). Es presentacional: el
// texto y su validación los maneja `ClienteForm`.

const ID = 'observaciones';

interface Opciones {
  inicial?: string;
  error?: string | null;
  cargando?: boolean;
  errorAlCargar?: boolean;
}

/** La sección es controlada: el estado lo tiene quien la usa (en la app, `ClienteForm`). */
function ConEstado({ inicial = '', error = null, ...resto }: Opciones) {
  const [valor, setValor] = useState(inicial);
  return (
    <ObservacionesSection id={ID} valor={valor} onCambio={setValor} error={error} {...resto} />
  );
}

function renderSeccion(opciones: Opciones = {}) {
  render(<ConEstado {...opciones} />);
  return { user: userEvent.setup() };
}

const cuadro = () => screen.getByRole('textbox', { name: 'Observaciones internas' });

describe('ObservacionesSection (HU2.10)', () => {
  it('es un grupo "Observaciones internas" con un cuadro de texto etiquetado', () => {
    renderSeccion();

    const grupo = screen.getByRole('group', { name: 'Observaciones internas' });
    expect(within(grupo).getByRole('textbox', { name: 'Observaciones internas' })).toBe(cuadro());
  });

  it('avisa una sola vez que no se guarden contraseñas, con el mismo texto que las indicaciones', () => {
    renderSeccion();

    expect(screen.getAllByText(AVISO_SIN_CREDENCIALES)).toHaveLength(1);
    expect(AVISO_SIN_CREDENCIALES).toBe('No guardes contraseñas ni credenciales acá.');
  });

  it('explica que es una bitácora de hechos puntuales y que no reemplaza a las indicaciones', () => {
    renderSeccion();

    expect(cuadro()).toHaveAccessibleDescription(
      expect.stringContaining('No reemplaza a las indicaciones de armado.'),
    );
    expect(cuadro()).toHaveAccessibleDescription(expect.stringContaining('hechos puntuales'));
  });

  it('muestra un solo contador, que arranca en 0 y sigue lo que se escribe', async () => {
    const { user } = renderSeccion();

    expect(screen.getAllByTestId('contador-observaciones')).toHaveLength(1);
    expect(screen.getByTestId('contador-observaciones')).toHaveTextContent('0 / 1000');

    await user.type(cuadro(), 'Cambió el mail');

    expect(screen.getByTestId('contador-observaciones')).toHaveTextContent('14 / 1000');
  });

  it('conserva los saltos de línea', async () => {
    const { user } = renderSeccion();

    await user.click(cuadro());
    await user.paste('Pausó la pauta.\nRetoma en marzo.');

    expect(cuadro()).toHaveValue('Pausó la pauta.\nRetoma en marzo.');
  });

  it('pasarse del límite pone el contador en el color de error', () => {
    renderSeccion({ inicial: 'a'.repeat(1001) });

    expect(screen.getByTestId('contador-observaciones')).toHaveTextContent('1001 / 1000');
    expect(screen.getByTestId('contador-observaciones')).toHaveClass('text-destructive');
  });

  it('un error se muestra bajo el campo y el cuadro queda descrito por él', () => {
    renderSeccion({ error: 'Las observaciones no pueden superar los 1000 caracteres.' });

    const mensaje = screen.getByText('Las observaciones no pueden superar los 1000 caracteres.');
    expect(cuadro()).toHaveAttribute('aria-invalid', 'true');
    expect(cuadro().getAttribute('aria-describedby')).toContain(mensaje.id);
  });

  it('sin error no marca el cuadro como inválido', () => {
    renderSeccion();

    expect(cuadro()).not.toHaveAttribute('aria-invalid');
  });

  it('mientras cargan las guardadas no se edita', () => {
    renderSeccion({ cargando: true });

    expect(cuadro()).toBeDisabled();
    expect(cuadro()).toHaveAttribute('aria-busy', 'true');
    expect(cuadro()).toHaveAttribute('placeholder', 'Cargando observaciones…');
  });

  it('si no se pudieron cargar, no se edita y se explica cómo reintentar', () => {
    renderSeccion({ errorAlCargar: true });

    expect(cuadro()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'No pudimos cargar las observaciones internas. Cerrá el panel y volvé a abrirlo para reintentar.',
    );
  });

  it('es editable siempre: no depende del estado del cliente', async () => {
    const { user } = renderSeccion();

    expect(cuadro()).toBeEnabled();
    await user.type(cuadro(), 'Pausó la pauta.');
    expect(cuadro()).toHaveValue('Pausó la pauta.');
  });

  it('no usa colores directos: solo tokens del sistema de diseño', () => {
    renderSeccion({ inicial: 'a'.repeat(1001), error: 'Error.' });

    const html = screen.getByRole('group', { name: 'Observaciones internas' }).outerHTML;

    expect(html).not.toMatch(
      /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|blue|indigo|violet|purple|pink)-\d{2,3})\b/,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});
