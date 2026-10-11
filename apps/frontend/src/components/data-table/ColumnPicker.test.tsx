import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { ColumnPicker } from '@/components/data-table/ColumnPicker';

// Columnas de ejemplo: el picker no sabe de qué tabla son.
const items = [
  { id: 'codigo', label: 'Código' },
  { id: 'zona', label: 'Zona' },
  { id: 'email', label: 'Email de contacto' },
  { id: 'estado', label: 'Estado' },
] as const;
type Id = (typeof items)[number]['id'];

function renderPicker({
  visibles = ['email', 'codigo'],
  isCustomized = true,
}: { visibles?: readonly Id[]; isCustomized?: boolean } = {}) {
  const onVisibleIdsChange = vi.fn<(ids: Id[]) => void>();
  const onReset = vi.fn();
  render(
    <ColumnPicker
      items={items}
      visibleIds={visibles}
      onVisibleIdsChange={onVisibleIdsChange}
      onReset={onReset}
      isCustomized={isCustomized}
      fixedColumnsNote="Nombre y Acciones siempre están visibles."
    />,
  );
  return { onVisibleIdsChange, onReset, user: userEvent.setup() };
}

/** Como lo usa una página: el picker refleja cada cambio que avisa. */
function PickerConEstado({ inicial }: { inicial: readonly Id[] }) {
  const [visibles, setVisibles] = useState(inicial);
  return (
    <ColumnPicker
      items={items}
      visibleIds={visibles}
      onVisibleIdsChange={setVisibles}
      onReset={() => setVisibles(inicial)}
      isCustomized
    />
  );
}

const trigger = () => screen.getByRole('button', { name: 'Columnas' });
const panel = () => screen.findByRole('dialog', { name: 'Columnas visibles' });
const checkbox = (nombre: string) => screen.getByRole('checkbox', { name: nombre });
const manijas = () =>
  screen.queryAllByRole('button', { name: /^Reordenar / }).map((b) => b.getAttribute('aria-label'));

describe('ColumnPicker', () => {
  it('el trigger abre un panel con todas las columnas, cada checkbox con su nombre', async () => {
    const { user } = renderPicker();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());

    const dialogo = within(await panel());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(dialogo.getAllByRole('checkbox')).toHaveLength(4);
    for (const { label } of items) expect(checkbox(label)).toBeInTheDocument();
    expect(dialogo.getByText('Nombre y Acciones siempre están visibles.')).toBeVisible();
  });

  it('marca las visibles y deja sin marcar las ocultas', async () => {
    const { user } = renderPicker({ visibles: ['email', 'codigo'] });
    await user.click(trigger());
    await panel();

    expect(checkbox('Email de contacto')).toBeChecked();
    expect(checkbox('Código')).toBeChecked();
    expect(checkbox('Zona')).not.toBeChecked();
    expect(checkbox('Estado')).not.toBeChecked();
  });

  it('lista las visibles en su orden y las ocultas debajo, en el orden de la tabla', async () => {
    const { user } = renderPicker({ visibles: ['email', 'codigo'] });
    await user.click(trigger());
    await panel();

    const nombres = (lista: string) =>
      within(screen.getByRole('list', { name: lista }))
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent);
    expect(nombres('Visibles, en orden')).toEqual(['Email de contacto', 'Código']);
    expect(nombres('Ocultas')).toEqual(['Zona', 'Estado']);
  });

  it('muestra cuántas de todas están visibles, sin usarlo como límite', async () => {
    const { user, onVisibleIdsChange } = renderPicker({
      visibles: ['email', 'codigo', 'zona', 'estado'],
    });
    await user.click(trigger());
    const dialogo = within(await panel());

    expect(dialogo.getByText('4/4')).toBeInTheDocument();
    expect(dialogo.getByText('4 de 4')).toHaveClass('sr-only');
    expect(onVisibleIdsChange).not.toHaveBeenCalled();
  });

  it('ocultar una columna avisa las restantes en el mismo orden', async () => {
    const { user, onVisibleIdsChange } = renderPicker({ visibles: ['estado', 'email', 'codigo'] });
    await user.click(trigger());
    await panel();

    await user.click(checkbox('Email de contacto'));

    expect(onVisibleIdsChange).toHaveBeenCalledExactlyOnceWith(['estado', 'codigo']);
  });

  it('mostrar una oculta la agrega al final de las visibles', async () => {
    const { user, onVisibleIdsChange } = renderPicker({ visibles: ['email', 'codigo'] });
    await user.click(trigger());
    await panel();

    await user.click(checkbox('Zona'));

    expect(onVisibleIdsChange).toHaveBeenCalledExactlyOnceWith(['email', 'codigo', 'zona']);
  });

  it('un clic en el nombre también alterna la columna', async () => {
    const { user, onVisibleIdsChange } = renderPicker({ visibles: ['email'] });
    await user.click(trigger());
    const dialogo = within(await panel());

    await user.click(dialogo.getByText('Estado'));

    expect(onVisibleIdsChange).toHaveBeenCalledExactlyOnceWith(['email', 'estado']);
  });

  it('solo las visibles tienen manija para reordenar, con un nombre que dice cuál', async () => {
    const { user } = renderPicker({ visibles: ['email', 'codigo'] });
    await user.click(trigger());
    await panel();

    expect(manijas()).toEqual(['Reordenar Email de contacto', 'Reordenar Código']);
  });

  it('la manija es un botón real: un clic no alterna la columna', async () => {
    const { user, onVisibleIdsChange } = renderPicker({ visibles: ['email', 'codigo'] });
    await user.click(trigger());
    await panel();

    const manija = screen.getByRole('button', { name: 'Reordenar Código' });
    expect(manija.tagName).toBe('BUTTON');
    await user.click(manija);

    expect(onVisibleIdsChange).not.toHaveBeenCalled();
    expect(checkbox('Código')).toBeChecked();
  });

  it('sin columnas visibles: todo sin marcar, sin manijas y el contador en 0', async () => {
    const { user, onVisibleIdsChange } = renderPicker({ visibles: [] });
    await user.click(trigger());
    const dialogo = within(await panel());

    expect(dialogo.getByText('0/4')).toBeInTheDocument();
    expect(manijas()).toEqual([]);
    expect(dialogo.queryByRole('list', { name: 'Visibles, en orden' })).not.toBeInTheDocument();
    for (const { label } of items) expect(checkbox(label)).not.toBeChecked();

    await user.click(checkbox('Zona'));
    expect(onVisibleIdsChange).toHaveBeenCalledExactlyOnceWith(['zona']);
  });

  describe('Restablecer', () => {
    it('avisa el pedido de restablecer', async () => {
      const { user, onReset, onVisibleIdsChange } = renderPicker({ isCustomized: true });
      await user.click(trigger());
      await panel();

      await user.click(screen.getByRole('button', { name: 'Restablecer' }));

      expect(onReset).toHaveBeenCalledTimes(1);
      expect(onVisibleIdsChange).not.toHaveBeenCalled();
    });

    it('sin personalización se ve pero está deshabilitado', async () => {
      const { user, onReset } = renderPicker({ isCustomized: false });
      await user.click(trigger());
      await panel();

      const boton = screen.getByRole('button', { name: 'Restablecer' });
      expect(boton).toBeVisible();
      expect(boton).toHaveAttribute('aria-disabled', 'true');

      await user.click(boton);
      expect(onReset).not.toHaveBeenCalled();
    });
  });

  describe('teclado y foco', () => {
    it('se abre con Enter, alterna con Espacio sin cerrarse y Escape devuelve el foco', async () => {
      render(<PickerConEstado inicial={['email', 'codigo']} />);
      const user = userEvent.setup();

      await user.tab();
      expect(trigger()).toHaveFocus();
      await user.keyboard('{Enter}');
      await panel();

      // El foco entra al panel: el primer control es la manija de la primera visible.
      expect(screen.getByRole('button', { name: 'Reordenar Email de contacto' })).toHaveFocus();
      await user.tab();
      expect(checkbox('Email de contacto')).toHaveFocus();

      await user.keyboard(' ');
      expect(checkbox('Email de contacto')).not.toBeChecked();
      // Pasó a las ocultas y el foco la siguió; el panel sigue abierto.
      expect(checkbox('Email de contacto')).toHaveFocus();
      expect(screen.getByRole('dialog', { name: 'Columnas visibles' })).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Columnas visibles' })).not.toBeInTheDocument();
      expect(trigger()).toHaveFocus();
    });

    it('Escape durante un arrastre con teclado lo cancela sin cerrar el panel', async () => {
      render(<PickerConEstado inicial={['email', 'codigo']} />);
      const user = userEvent.setup();
      await user.click(trigger());
      await panel();
      const manija = screen.getByRole('button', { name: 'Reordenar Email de contacto' });
      manija.focus();

      await user.keyboard(' ');
      expect(manija).toHaveAttribute('aria-pressed', 'true');
      // dnd-kit empieza a escuchar el teclado un instante después de tomar la columna.
      await new Promise((resolver) => setTimeout(resolver));
      await user.keyboard('{Escape}');

      expect(manija).not.toHaveAttribute('aria-pressed');
      expect(screen.getByRole('dialog', { name: 'Columnas visibles' })).toBeInTheDocument();
      expect(manijas()).toEqual(['Reordenar Email de contacto', 'Reordenar Código']);

      await new Promise((resolver) => setTimeout(resolver));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Columnas visibles' })).not.toBeInTheDocument();
    });
  });
});
