import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { Select, type SelectOption } from '@/components/ui/select';

const opciones: SelectOption[] = [
  { value: 'A', label: 'Opción A' },
  { value: 'B', label: 'Opción B' },
  { value: 'C', label: 'Opción C' },
];

function Controlado({
  inicial = '',
  options = opciones,
  ...props
}: {
  inicial?: string;
  options?: SelectOption[];
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [valor, setValor] = useState(inicial);
  return (
    <>
      <label htmlFor="campo">Campo</label>
      <Select
        id="campo"
        value={valor}
        onValueChange={setValor}
        options={options}
        placeholder="Elegí una opción"
        {...props}
      />
      <output data-testid="valor">{valor}</output>
    </>
  );
}

describe('Select', () => {
  it('se nombra con su label y muestra el placeholder mientras no hay valor', () => {
    render(<Controlado />);

    const select = screen.getByRole('combobox', { name: 'Campo' });
    expect(select).toHaveTextContent('Elegí una opción');
  });

  it('muestra la etiqueta de la opción elegida, no su valor', () => {
    render(<Controlado inicial="B" />);

    expect(screen.getByRole('combobox', { name: 'Campo' })).toHaveTextContent('Opción B');
  });

  it('abre el popup con el mouse, elige una opción y lo cierra', async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.click(screen.getByRole('combobox', { name: 'Campo' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Opción C' }));

    expect(screen.getByTestId('valor')).toHaveTextContent('C');
    expect(screen.getByRole('combobox', { name: 'Campo' })).toHaveTextContent('Opción C');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('marca la opción elegida como seleccionada', async () => {
    const user = userEvent.setup();
    render(<Controlado inicial="B" />);

    await user.click(screen.getByRole('combobox', { name: 'Campo' }));

    expect(await screen.findByRole('option', { name: 'Opción B' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: 'Opción A' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('se maneja con el teclado: abre con Enter, recorre con flechas y elige con Enter', async () => {
    const user = userEvent.setup();
    render(<Controlado />);

    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Campo' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    // Sin valor previo, al abrir queda resaltada la primera opción: una flecha lleva a la segunda.
    await user.keyboard('{ArrowDown}{Enter}');

    expect(screen.getByTestId('valor')).toHaveTextContent('B');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    // Al cerrar, el foco vuelve al disparador.
    expect(screen.getByRole('combobox', { name: 'Campo' })).toHaveFocus();
  });

  it('Escape cierra el popup sin cambiar el valor', async () => {
    const user = userEvent.setup();
    render(<Controlado inicial="A" />);

    await user.click(screen.getByRole('combobox', { name: 'Campo' }));
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByTestId('valor')).toHaveTextContent('A');
  });

  it('trata la opción con valor vacío como una opción más ("Todos"), no como el placeholder', () => {
    render(<Controlado options={[{ value: '', label: 'Todos' }, ...opciones]} />);

    expect(screen.getByRole('combobox', { name: 'Campo' })).toHaveTextContent('Todos');
  });

  it('permite volver a una opción con valor vacío', async () => {
    const user = userEvent.setup();
    render(<Controlado inicial="A" options={[{ value: '', label: 'Todos' }, ...opciones]} />);

    await user.click(screen.getByRole('combobox', { name: 'Campo' }));
    await user.click(await screen.findByRole('option', { name: 'Todos' }));

    expect(screen.getByTestId('valor')).toBeEmptyDOMElement();
    expect(screen.getByRole('combobox', { name: 'Campo' })).toHaveTextContent('Todos');
  });

  it('deshabilitado no abre el popup', async () => {
    const user = userEvent.setup();
    render(<Controlado disabled />);

    await user.click(screen.getByRole('combobox', { name: 'Campo' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('con error se expone como inválido', () => {
    render(<Controlado invalid />);

    expect(screen.getByRole('combobox', { name: 'Campo' })).toBeInvalid();
  });
});
