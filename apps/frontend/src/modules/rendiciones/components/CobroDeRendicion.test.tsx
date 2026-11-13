import type { EstadoRendicionType } from '@realpolitik/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cn } from 'cn';

import { buttonVariants } from '@/components/ui/button';
import { CobroDeRendicion } from '@/modules/rendiciones/components/CobroDeRendicion';

// La franja del cobro en el detalle (HU3.10), a ancho completo bajo la línea Estado · Vigencia ·
// Avance: "Registrar cobro" si se puede y no hay, el cobro con "Editar" y "Quitar" si lo hay, y solo
// lectura si la rendición está anulada.

const COBRO = { fecha: '2026-11-10', nota: 'Avisó por mail Juan, de Tesorería' };

interface Props {
  estado?: EstadoRendicionType;
  anulada?: boolean;
  cobro?: { fecha: string; nota: string | null } | null;
}

function renderFranja({ estado = 'ENVIADA', anulada = false, cobro = null }: Props = {}) {
  const acciones = { onRegistrar: vi.fn(), onEditar: vi.fn(), onQuitar: vi.fn() };
  const { container } = render(
    <CobroDeRendicion estado={estado} anulada={anulada} cobro={cobro} {...acciones} />,
  );
  return { container, user: userEvent.setup(), ...acciones };
}

const franja = () => screen.getByRole('region', { name: 'Cobro' });
/** El botón tiene las clases de esa variante y ese tamaño (el `Button` no las expone como atributos). */
const esDe = (variant: 'outline' | 'ghost', size: 'sm') =>
  cn(buttonVariants({ variant, size })).split(' ');
const boton = (nombre: string) => screen.queryByRole('button', { name: nombre });

describe('CobroDeRendicion: sin cobro', () => {
  it.each<EstadoRendicionType>(['ENVIADA', 'APROBADA'])(
    'una %s activa ofrece registrarlo, con la franja en el estilo de la cabecera',
    (estado) => {
      renderFranja({ estado });

      expect(within(franja()).getByText('Cobro')).toBeVisible();
      expect(within(franja()).getByText('Sin cobro registrado')).toBeVisible();
      expect(franja()).toHaveClass('rounded-panel', 'border', 'bg-panel', 'px-4', 'py-3');
      expect(franja()).not.toHaveClass('bg-success-soft');
      expect(boton('Registrar cobro')).toBeVisible();
      expect(boton('Editar cobro')).not.toBeInTheDocument();
      expect(boton('Quitar cobro')).not.toBeInTheDocument();
    },
  );

  it('"Registrar cobro" es un botón outline sm, y al tocarlo avisa', async () => {
    const { user, onRegistrar } = renderFranja();

    const registrar = screen.getByRole('button', { name: 'Registrar cobro' });
    expect(registrar).toHaveClass(...esDe('outline', 'sm'));
    await user.click(registrar);
    expect(onRegistrar).toHaveBeenCalledTimes(1);
  });

  it('el ícono es decorativo', () => {
    renderFranja();

    expect(franja().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it.each<EstadoRendicionType>(['EN_CURSO', 'COMPLETA', 'RECHAZADA'])(
    'una %s no se cobra: no se dibuja nada',
    (estado) => {
      const { container } = renderFranja({ estado });

      expect(container).toBeEmptyDOMElement();
    },
  );

  it('una anulada sin cobro no se dibuja', () => {
    const { container } = renderFranja({ anulada: true });

    expect(container).toBeEmptyDOMElement();
  });
});

describe('CobroDeRendicion: con cobro', () => {
  it('marca la franja con los tokens de éxito y dice "Cobrada el dd/mm/aaaa" en negrita, con ícono', () => {
    renderFranja({ cobro: COBRO });

    expect(franja()).toHaveClass('bg-success-soft', 'border-success-border');
    const texto = within(franja()).getByText('Cobrada el 10/11/2026');
    expect(texto).toHaveClass('font-semibold', 'text-success');
    expect(franja().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('la nota va debajo, en 2 líneas como máximo, con el texto completo en el title', () => {
    renderFranja({ cobro: COBRO });

    const nota = within(franja()).getByText(COBRO.nota);
    expect(nota).toHaveClass('line-clamp-2');
    expect(nota).toHaveAttribute('title', COBRO.nota);
  });

  it('sin nota, solo la fecha', () => {
    renderFranja({ cobro: { fecha: '2026-11-10', nota: null } });

    expect(within(franja()).getByText('Cobrada el 10/11/2026')).toBeVisible();
    expect(franja().querySelector('[title]')).toBeNull();
  });

  it('el día no se corre por la zona horaria: el 01/01 se lee 01/01', () => {
    renderFranja({ cobro: { fecha: '2026-01-01', nota: null } });

    expect(within(franja()).getByText('Cobrada el 01/01/2026')).toBeVisible();
  });

  it('en una activa Enviada o Aprobada ofrece "Editar cobro" (outline sm) y "Quitar cobro" (ghost sm)', async () => {
    const { user, onEditar, onQuitar } = renderFranja({ estado: 'APROBADA', cobro: COBRO });

    expect(boton('Registrar cobro')).not.toBeInTheDocument();
    const editar = screen.getByRole('button', { name: 'Editar cobro' });
    const quitar = screen.getByRole('button', { name: 'Quitar cobro' });
    expect(editar).toHaveClass(...esDe('outline', 'sm'));
    expect(quitar).toHaveClass(...esDe('ghost', 'sm'));
    expect(quitar).not.toHaveClass(...esDe('outline', 'sm'));

    await user.click(editar);
    await user.click(quitar);
    expect(onEditar).toHaveBeenCalledTimes(1);
    expect(onQuitar).toHaveBeenCalledTimes(1);
  });

  it('si la rendición ya no es cobrable pero tiene cobro (p. ej. rechazada con el cobro viejo), no se edita pero se puede quitar', () => {
    renderFranja({ estado: 'RECHAZADA', cobro: COBRO });

    expect(within(franja()).getByText('Cobrada el 10/11/2026')).toBeVisible();
    expect(boton('Editar cobro')).not.toBeInTheDocument();
    expect(boton('Quitar cobro')).toBeVisible();
  });

  it('una anulada con cobro muestra la misma franja, sin botones', () => {
    renderFranja({ anulada: true, cobro: COBRO });

    expect(franja()).toHaveClass('bg-success-soft', 'border-success-border');
    expect(within(franja()).getByText('Cobrada el 10/11/2026')).toBeVisible();
    expect(within(franja()).getByText(COBRO.nota)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('CobroDeRendicion: presentación y accesibilidad', () => {
  it('es una región con el nombre accesible "Cobro", también con cobro', () => {
    renderFranja({ cobro: COBRO });

    expect(screen.getByRole('region', { name: 'Cobro' })).toBeInTheDocument();
  });

  it('a ancho chico, el texto y los botones se apilan; a ancho amplio van en fila', () => {
    renderFranja({ cobro: COBRO });

    expect(franja()).toHaveClass(
      'flex-col',
      'sm:flex-row',
      'sm:items-center',
      'sm:justify-between',
    );
    const botones = screen.getByRole('button', { name: 'Editar cobro' }).parentElement;
    expect(botones).toHaveClass('flex', 'flex-wrap', 'gap-2');
  });

  it('el texto puede encogerse (min-w-0) para que la nota larga no empuje a los botones', () => {
    renderFranja({ cobro: COBRO });

    const nota = within(franja()).getByText(COBRO.nota);
    expect(nota.closest('div')).toHaveClass('min-w-0');
  });
});
