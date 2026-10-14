import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';

import { LoadingButton } from '@/components/ui/loading-button';

const spinner = (boton: HTMLElement) => boton.querySelector('svg.animate-spin');
const check = (boton: HTMLElement) => boton.querySelector('svg.lucide-check');

describe('LoadingButton', () => {
  it('en reposo muestra su texto, no está ocupado y responde al click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<LoadingButton onClick={onClick}>Guardar cambios</LoadingButton>);

    const boton = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(boton).not.toHaveAttribute('aria-busy');
    expect(boton).not.toHaveAttribute('aria-disabled');
    expect(boton).not.toHaveAttribute('data-success');
    expect(boton).toBeEnabled();
    expect(spinner(boton)).toBeNull();
    expect(check(boton)).toBeNull();

    await user.click(boton);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe('cargando', () => {
    it('muestra el spinner y el texto de proceso, ocupado y bloqueado sin disabled nativo', () => {
      render(
        <LoadingButton loading loadingText="Guardando…">
          Guardar cambios
        </LoadingButton>,
      );

      const boton = screen.getByRole('button', { name: 'Guardando…' });
      expect(boton).toHaveAttribute('aria-busy', 'true');
      expect(boton).toHaveAttribute('aria-disabled', 'true');
      // Sin `disabled` nativo: no se atenúa ni suelta el foco.
      expect(boton).not.toHaveAttribute('disabled');
      expect(spinner(boton)).toHaveAttribute('aria-hidden', 'true');
      expect(check(boton)).toBeNull();
    });

    it('sin loadingText mantiene su texto', () => {
      render(<LoadingButton loading>Guardar cambios</LoadingButton>);

      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });

    it('no responde al click ni al teclado', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <LoadingButton loading loadingText="Guardando…" onClick={onClick}>
          Guardar cambios
        </LoadingButton>,
      );

      const boton = screen.getByRole('button', { name: 'Guardando…' });
      await user.click(boton);
      boton.focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('no envía el formulario', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((evento: FormEvent) => evento.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <LoadingButton type="submit" loading loadingText="Guardando…">
            Guardar cambios
          </LoadingButton>
        </form>,
      );

      await user.click(screen.getByRole('button', { name: 'Guardando…' }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('Enter en un campo no reenvía el formulario mientras carga ni mientras confirma', async () => {
      // Sin `disabled` nativo, el navegador sí intenta el envío implícito: dispara un click en el
      // botón, que el botón ocupado cancela.
      const user = userEvent.setup();
      const onSubmit = vi.fn((evento: FormEvent) => evento.preventDefault());
      const formulario = (estado: { loading?: boolean; success?: boolean }) => (
        <form onSubmit={onSubmit}>
          <input aria-label="Nombre" />
          <LoadingButton type="submit" loadingText="Guardando…" successText="Guardado" {...estado}>
            Guardar cambios
          </LoadingButton>
        </form>
      );
      const { rerender } = render(formulario({}));
      await user.type(screen.getByLabelText('Nombre'), 'x{Enter}');
      expect(onSubmit).toHaveBeenCalledTimes(1);

      rerender(formulario({ loading: true }));
      await user.type(screen.getByLabelText('Nombre'), '{Enter}');
      rerender(formulario({ success: true }));
      await user.type(screen.getByLabelText('Nombre'), '{Enter}');

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('conserva el foco al pasar a cargando y a éxito', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<LoadingButton>Guardar cambios</LoadingButton>);
      await user.tab();
      const boton = screen.getByRole('button', { name: 'Guardar cambios' });
      expect(boton).toHaveFocus();

      rerender(
        <LoadingButton loading loadingText="Guardando…">
          Guardar cambios
        </LoadingButton>,
      );
      expect(boton).toHaveFocus();

      rerender(
        <LoadingButton loading success successText="Guardado">
          Guardar cambios
        </LoadingButton>,
      );
      expect(boton).toHaveFocus();
    });
  });

  describe('éxito', () => {
    it('muestra el check y el texto de éxito, bloqueado y sin aria-busy', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <LoadingButton success successText="Guardado" onClick={onClick}>
          Guardar cambios
        </LoadingButton>,
      );

      const boton = screen.getByRole('button', { name: 'Guardado' });
      expect(check(boton)).toHaveAttribute('aria-hidden', 'true');
      expect(spinner(boton)).toBeNull();
      expect(boton).toHaveAttribute('data-success');
      expect(boton).toHaveClass('data-success:bg-success-soft', 'data-success:text-success');
      expect(boton).toHaveAttribute('aria-disabled', 'true');
      expect(boton).not.toHaveAttribute('aria-busy');
      expect(boton).not.toHaveAttribute('disabled');

      await user.click(boton);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('no anuncia nada por su cuenta: el texto visible alcanza', () => {
      render(
        <LoadingButton success successText="Guardado">
          Guardar cambios
        </LoadingButton>,
      );

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('gana sobre loading: check y texto de éxito, nunca el spinner', () => {
      render(
        <LoadingButton loading loadingText="Guardando…" success successText="Guardado">
          Guardar cambios
        </LoadingButton>,
      );

      const boton = screen.getByRole('button', { name: 'Guardado' });
      expect(check(boton)).not.toBeNull();
      expect(spinner(boton)).toBeNull();
      expect(boton).not.toHaveAttribute('aria-busy');
      expect(screen.queryByText('Guardando…')).not.toBeInTheDocument();
    });
  });

  describe('disabled de afuera', () => {
    it('sigue siendo el disabled nativo de siempre (p. ej. "sin cambios")', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <LoadingButton disabled onClick={onClick}>
          Guardar cambios
        </LoadingButton>,
      );

      const boton = screen.getByRole('button', { name: 'Guardar cambios' });
      expect(boton).toBeDisabled();
      expect(boton).not.toHaveAttribute('aria-disabled');
      expect(boton).not.toHaveAttribute('aria-busy');

      await user.click(boton);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('vuelve a habilitarse al quitarlo', () => {
      const { rerender } = render(<LoadingButton disabled>Guardar cambios</LoadingButton>);
      rerender(<LoadingButton>Guardar cambios</LoadingButton>);

      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    });
  });
});
