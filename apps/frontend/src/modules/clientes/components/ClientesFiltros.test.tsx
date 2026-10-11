import { MAX_BUSQUEDA_CLIENTES } from '@realpolitik/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ClientesFiltros } from '@/modules/clientes/components/ClientesFiltros';

function renderFiltros(textoBusqueda = '') {
  const onTextoChange = vi.fn();
  render(
    <ClientesFiltros
      textoBusqueda={textoBusqueda}
      estado="ACTIVO"
      sector={undefined}
      subtipo={undefined}
      hayFiltros={false}
      total={0}
      onTextoChange={onTextoChange}
      onEstadoChange={() => undefined}
      onSectorChange={() => undefined}
      onSubtipoChange={() => undefined}
      onLimpiar={() => undefined}
    />,
  );
  return { onTextoChange, buscador: screen.getByLabelText('Buscar cliente') };
}

describe('ClientesFiltros: límite del buscador', () => {
  it('el input limita el largo con la misma constante que valida la API', () => {
    const { buscador } = renderFiltros();

    expect(MAX_BUSQUEDA_CLIENTES).toBe(150);
    expect(buscador).toHaveAttribute('maxlength', String(MAX_BUSQUEDA_CLIENTES));
  });

  it('no deja escribir más del máximo: la interfaz normal no puede generar un 400 por largo', async () => {
    const user = userEvent.setup();
    const { buscador, onTextoChange } = renderFiltros();

    await user.click(buscador);
    await user.paste('a'.repeat(MAX_BUSQUEDA_CLIENTES + 50));

    const enviados = onTextoChange.mock.calls.map(([texto]) => (texto as string).length);
    expect(Math.max(...enviados)).toBe(MAX_BUSQUEDA_CLIENTES);
  });
});
