import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { useFiltroMatrices } from '@/modules/clientes/hooks/useFiltroMatrices';

// Muestra el filtro que el hook decide y deja elegir otro; la URL se inspecciona en el router.
function Sonda() {
  const { filtroEstado, elegirEstado } = useFiltroMatrices();
  return (
    <>
      <p>filtro:{filtroEstado}</p>
      <button type="button" onClick={() => elegirEstado('TODAS')}>
        todas
      </button>
      <button type="button" onClick={() => elegirEstado('CONFIGURADAS')}>
        configuradas
      </button>
      <button type="button" onClick={() => elegirEstado('PENDIENTES')}>
        pendientes
      </button>
    </>
  );
}

function renderEn(...entradas: string[]) {
  const router = createMemoryRouter([{ path: '/clientes/matrices', element: <Sonda /> }], {
    initialEntries: entradas,
    initialIndex: entradas.length - 1,
  });
  render(<RouterProvider router={router} />);
  return router;
}

const busqueda = (router: ReturnType<typeof renderEn>) => router.state.location.search;
const clic = (nombre: string) => {
  act(() => screen.getByRole('button', { name: nombre }).click());
};

describe('useFiltroMatrices: lectura de la URL', () => {
  it.each([
    ['sin parámetro', '', 'TODAS'],
    ['matrizConfigurada=false', '?matrizConfigurada=false', 'PENDIENTES'],
    ['matrizConfigurada=true', '?matrizConfigurada=true', 'CONFIGURADAS'],
  ])('con %s el filtro es %s', async (_caso, query, esperado) => {
    const router = renderEn(`/clientes/matrices${query}`);

    expect(screen.getByText(`filtro:${esperado}`)).toBeInTheDocument();
    // Ningún reemplazo: un valor válido (o ausente) no toca la URL.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(busqueda(router)).toBe(query);
    expect(router.state.historyAction).toBe('POP');
  });
});

describe('useFiltroMatrices: URL canónica', () => {
  it.each([
    ['un valor inventado', '?matrizConfigurada=foo'],
    ['en mayúscula', '?matrizConfigurada=FALSE'],
    ['vacío', '?matrizConfigurada='],
  ])('con %s muestra Todos y quita el parámetro con replace', async (_caso, query) => {
    const router = renderEn(`/clientes/matrices${query}`);

    expect(screen.getByText('filtro:TODAS')).toBeInTheDocument();
    await waitFor(() => expect(busqueda(router)).toBe(''));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('conserva los demás parámetros al quitar el inválido', async () => {
    const router = renderEn('/clientes/matrices?q=zeta&matrizConfigurada=foo&otro=1');

    await waitFor(() => expect(busqueda(router)).toBe('?q=zeta&otro=1'));
  });

  it('atrás desde una URL inválida no pasa por ella', async () => {
    const router = renderEn(
      '/clientes/matrices?matrizConfigurada=true',
      '/clientes/matrices?matrizConfigurada=foo',
    );
    await waitFor(() => expect(busqueda(router)).toBe(''));

    await act(() => router.navigate(-1));

    expect(busqueda(router)).toBe('?matrizConfigurada=true');
    expect(screen.getByText('filtro:CONFIGURADAS')).toBeInTheDocument();
  });
});

describe('useFiltroMatrices: elegir el filtro', () => {
  it('Pendientes escribe matrizConfigurada=false y Configurados =true', () => {
    const router = renderEn('/clientes/matrices');

    clic('pendientes');
    expect(busqueda(router)).toBe('?matrizConfigurada=false');
    expect(screen.getByText('filtro:PENDIENTES')).toBeInTheDocument();

    clic('configuradas');
    expect(busqueda(router)).toBe('?matrizConfigurada=true');
    expect(screen.getByText('filtro:CONFIGURADAS')).toBeInTheDocument();
  });

  it('Todos borra el parámetro', () => {
    const router = renderEn('/clientes/matrices?matrizConfigurada=false');

    clic('todas');

    expect(busqueda(router)).toBe('');
    expect(screen.getByText('filtro:TODAS')).toBeInTheDocument();
  });

  it('conserva los demás parámetros al cambiar el filtro', () => {
    const router = renderEn('/clientes/matrices?q=zeta&otro=1');

    clic('pendientes');

    expect(busqueda(router)).toBe('?q=zeta&otro=1&matrizConfigurada=false');
  });

  it('cada cambio agrega una entrada al historial: atrás restaura el filtro anterior', async () => {
    const router = renderEn('/clientes/matrices');

    clic('pendientes');
    expect(router.state.historyAction).toBe('PUSH');
    clic('configuradas');

    await act(() => router.navigate(-1));
    expect(busqueda(router)).toBe('?matrizConfigurada=false');
    expect(screen.getByText('filtro:PENDIENTES')).toBeInTheDocument();

    await act(() => router.navigate(-1));
    expect(busqueda(router)).toBe('');
    expect(screen.getByText('filtro:TODAS')).toBeInTheDocument();
  });
});
