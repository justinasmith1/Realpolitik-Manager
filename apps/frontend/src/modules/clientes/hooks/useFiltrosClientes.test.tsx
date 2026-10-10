import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { useFiltrosClientes } from '@/modules/clientes/hooks/useFiltrosClientes';

// Muestra la vista que el hook decide y deja inspeccionar la URL y el historial del router.
function Sonda() {
  const { estado, filtros } = useFiltrosClientes();
  return (
    <p>
      vista:{estado} q:{filtros.q ?? '-'} sector:{filtros.sector ?? '-'} subtipo:
      {filtros.subtipo ?? '-'}
    </p>
  );
}

function renderEn(...entradas: string[]) {
  const router = createMemoryRouter([{ path: '/clientes', element: <Sonda /> }], {
    initialEntries: entradas,
    initialIndex: entradas.length - 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

const busqueda = (router: ReturnType<typeof renderEn>) => router.state.location.search;

describe('useFiltrosClientes: URL canónica del estado', () => {
  it.each([
    ['un valor inventado', '?estado=foo'],
    ['SUSPENDIDO (reservado: la interfaz no lo ofrece)', '?estado=SUSPENDIDO'],
    ['ACTIVO explícito (los activos son la vista sin parámetro)', '?estado=ACTIVO'],
  ])('con %s muestra activos y quita el parámetro de la URL', async (_caso, query) => {
    const router = renderEn(`/clientes${query}`);

    expect(screen.getByText(/vista:ACTIVO/)).toBeInTheDocument();
    await waitFor(() => expect(busqueda(router)).toBe(''));
    // Reemplaza la entrada en vez de agregar otra: "atrás" no vuelve a la URL inválida.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('conserva los demás filtros al quitar el estado inválido', async () => {
    const router = renderEn('/clientes?q=zeta&estado=foo&sector=PRIVADO');

    await waitFor(() => expect(busqueda(router)).toBe('?q=zeta&sector=PRIVADO'));
    expect(screen.getByText(/vista:ACTIVO q:zeta sector:PRIVADO subtipo:\s*-/)).toBeInTheDocument();
  });

  it('estado=INACTIVO es la URL canónica de los inactivos: se conserva', async () => {
    const router = renderEn('/clientes?estado=INACTIVO');

    expect(screen.getByText(/vista:INACTIVO/)).toBeInTheDocument();
    // Ningún reemplazo: la navegación inicial sigue siendo la única.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(busqueda(router)).toBe('?estado=INACTIVO');
    expect(router.state.historyAction).toBe('POP');
  });

  it('atrás desde una URL inválida vuelve a la entrada anterior, sin pasar por la inválida', async () => {
    const router = renderEn('/clientes?estado=INACTIVO', '/clientes?estado=foo');
    await waitFor(() => expect(busqueda(router)).toBe(''));

    await act(() => router.navigate(-1));

    expect(busqueda(router)).toBe('?estado=INACTIVO');
    expect(screen.getByText(/vista:INACTIVO/)).toBeInTheDocument();
  });

  it('adelante después de "atrás" llega a la URL ya canónica', async () => {
    const router = renderEn('/clientes?estado=INACTIVO', '/clientes?estado=SUSPENDIDO');
    await waitFor(() => expect(busqueda(router)).toBe(''));

    await act(() => router.navigate(-1));
    await act(() => router.navigate(1));

    expect(busqueda(router)).toBe('');
    expect(screen.getByText(/vista:ACTIVO/)).toBeInTheDocument();
  });
});

describe('useFiltrosClientes: URL canónica de sector y subtipo', () => {
  it.each([
    ['un sector inválido', '?sector=foo', ''],
    ['un sector en minúscula', '?sector=privado', ''],
    ['un sector vacío', '?sector=', ''],
    ['un subtipo inválido', '?subtipo=foo', ''],
    ['un subtipo en minúscula', '?subtipo=municipal', ''],
  ])('con %s lo quita de la URL, con replace', async (_caso, query, esperada) => {
    const router = renderEn(`/clientes${query}`);

    await waitFor(() => expect(busqueda(router)).toBe(esperada));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByText(/sector:-\s+subtipo:\s*-/)).toBeInTheDocument();
  });

  it('sector PRIVADO con subtipo: quita el subtipo y conserva el sector', async () => {
    const router = renderEn('/clientes?sector=PRIVADO&subtipo=MUNICIPAL');

    await waitFor(() => expect(busqueda(router)).toBe('?sector=PRIVADO'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByText(/sector:PRIVADO subtipo:\s*-/)).toBeInTheDocument();
  });

  it('sector PUBLICO con un subtipo válido se conserva tal cual, sin reemplazos', async () => {
    const router = renderEn('/clientes?sector=PUBLICO&subtipo=MUNICIPAL');

    expect(screen.getByText(/sector:PUBLICO subtipo:\s*MUNICIPAL/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(busqueda(router)).toBe('?sector=PUBLICO&subtipo=MUNICIPAL');
    expect(router.state.historyAction).toBe('POP');
  });

  it('un subtipo válido sin sector se conserva (no hay sector que lo contradiga)', async () => {
    const router = renderEn('/clientes?subtipo=SINDICAL_OBRA_SOCIAL');

    expect(screen.getByText(/subtipo:\s*SINDICAL_OBRA_SOCIAL/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(busqueda(router)).toBe('?subtipo=SINDICAL_OBRA_SOCIAL');
  });

  it('con todo junto quita solo lo inválido y conserva q y estado válidos, en un único reemplazo', async () => {
    const router = renderEn(
      '/clientes?q=zeta&estado=INACTIVO&sector=PRIVADO&subtipo=MUNICIPAL&foo=bar',
    );

    await waitFor(() =>
      expect(busqueda(router)).toBe('?q=zeta&estado=INACTIVO&sector=PRIVADO&foo=bar'),
    );
    expect(router.state.historyAction).toBe('REPLACE');
    expect(
      screen.getByText(/vista:INACTIVO q:zeta sector:PRIVADO subtipo:\s*-/),
    ).toBeInTheDocument();
  });

  it('con estado, sector y subtipo inválidos a la vez los quita juntos y conserva q', async () => {
    const router = renderEn('/clientes?q=ana&estado=SUSPENDIDO&sector=foo&subtipo=bar');

    await waitFor(() => expect(busqueda(router)).toBe('?q=ana'));
    expect(screen.getByText(/vista:ACTIVO q:ana sector:-\s+subtipo:\s*-/)).toBeInTheDocument();
  });

  it('atrás desde una URL inválida no pasa por ella: vuelve a la entrada anterior', async () => {
    const router = renderEn(
      '/clientes?sector=PUBLICO&subtipo=MUNICIPAL',
      '/clientes?sector=PRIVADO&subtipo=MUNICIPAL',
    );
    await waitFor(() => expect(busqueda(router)).toBe('?sector=PRIVADO'));

    await act(() => router.navigate(-1));

    expect(busqueda(router)).toBe('?sector=PUBLICO&subtipo=MUNICIPAL');
    expect(screen.getByText(/sector:PUBLICO subtipo:\s*MUNICIPAL/)).toBeInTheDocument();

    await act(() => router.navigate(1));
    expect(busqueda(router)).toBe('?sector=PRIVADO');
  });
});
