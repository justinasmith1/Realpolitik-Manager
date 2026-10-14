import { act, renderHook } from '@testing-library/react';

import { DURACION_EXITO_MS, useExitoBreve } from '@/hooks/use-exito-breve';

/** Arranca `mostrar()` y deja a mano si la promesa ya resolvió. */
function mostrar(exito: ReturnType<typeof useExitoBreve>) {
  const estado = { resuelta: false };
  let promesa: Promise<void> = Promise.resolve();
  act(() => {
    promesa = exito.mostrar();
  });
  void promesa.then(() => {
    estado.resuelta = true;
  });
  return { estado, promesa };
}

async function avanzar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useExitoBreve', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('la duración acordada es 500 ms', () => {
    expect(DURACION_EXITO_MS).toBe(500);
  });

  it('arranca inactivo', () => {
    const { result } = renderHook(() => useExitoBreve());

    expect(result.current.activo).toBe(false);
  });

  it('mostrar() activa en el acto y resuelve a los 500 ms, no antes', async () => {
    const { result } = renderHook(() => useExitoBreve());

    const { estado } = mostrar(result.current);
    expect(result.current.activo).toBe(true);

    await avanzar(DURACION_EXITO_MS - 1);
    expect(estado.resuelta).toBe(false);

    await avanzar(1);
    expect(estado.resuelta).toBe(true);
  });

  it('al resolver sigue activo: lo apaga quien lo usa', async () => {
    const { result } = renderHook(() => useExitoBreve());

    mostrar(result.current);
    await avanzar(DURACION_EXITO_MS);

    expect(result.current.activo).toBe(true);
  });

  it('reiniciar() lo apaga', async () => {
    const { result } = renderHook(() => useExitoBreve());
    mostrar(result.current);
    await avanzar(DURACION_EXITO_MS);

    act(() => result.current.reiniciar());

    expect(result.current.activo).toBe(false);
  });

  it('reiniciar() con la espera en curso la cancela', async () => {
    const { result } = renderHook(() => useExitoBreve());
    const { estado } = mostrar(result.current);

    act(() => result.current.reiniciar());
    await avanzar(DURACION_EXITO_MS * 2);

    expect(result.current.activo).toBe(false);
    expect(estado.resuelta).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('una segunda llamada en curso devuelve la misma espera, sin otro temporizador', async () => {
    const { result } = renderHook(() => useExitoBreve());

    const primera = mostrar(result.current);
    await avanzar(200);
    const segunda = mostrar(result.current);

    expect(segunda.promesa).toBe(primera.promesa);
    expect(vi.getTimerCount()).toBe(1);

    // Ambas siguen a los 500 ms de la primera llamada.
    await avanzar(DURACION_EXITO_MS - 200);
    expect(primera.estado.resuelta).toBe(true);
    expect(segunda.estado.resuelta).toBe(true);
  });

  it('una llamada después de resolver arranca una espera nueva', async () => {
    const { result } = renderHook(() => useExitoBreve());
    const primera = mostrar(result.current);
    await avanzar(DURACION_EXITO_MS);

    const segunda = mostrar(result.current);

    expect(segunda.promesa).not.toBe(primera.promesa);
    await avanzar(DURACION_EXITO_MS - 1);
    expect(segunda.estado.resuelta).toBe(false);
    await avanzar(1);
    expect(segunda.estado.resuelta).toBe(true);
  });

  it('al desmontarse limpia el temporizador y no resuelve ni actualiza nada', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useExitoBreve());
    const { estado } = mostrar(result.current);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await avanzar(DURACION_EXITO_MS * 2);
    expect(estado.resuelta).toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('mostrar y reiniciar son estables entre renders', () => {
    const { result, rerender } = renderHook(() => useExitoBreve());
    const { mostrar: mostrarAntes, reiniciar: reiniciarAntes } = result.current;

    rerender();

    expect(result.current.mostrar).toBe(mostrarAntes);
    expect(result.current.reiniciar).toBe(reiniciarAntes);
  });
});
