import { act, renderHook } from '@testing-library/react';

import { DURACION_AVISO_MS, useAvisoDePagina } from '@/hooks/use-aviso-de-pagina';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** Adelanta el reloj falso y deja que React aplique lo que haya cambiado. */
function avanzarReloj(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** El hook con un título real como destino del foco. `avisoRef` arranca sin aviso montado. */
function renderAviso() {
  const titulo = document.createElement('h1');
  titulo.tabIndex = -1;
  document.body.append(titulo);
  const destinoDelFoco: { current: HTMLElement | null } = { current: titulo };
  const avisoRef: { current: HTMLElement | null } = { current: null };
  const vista = renderHook(() => useAvisoDePagina({ avisoRef, destinoDelFoco }));
  return { ...vista, titulo, avisoRef };
}

describe('useAvisoDePagina', () => {
  it('avisar muestra un aviso; uno nuevo reemplaza al anterior (nunca hay dos)', () => {
    const { result } = renderAviso();

    act(() => result.current.avisar('success', 'Primero'));
    const primero = result.current.aviso;
    act(() => result.current.avisar('destructive', 'Segundo'));

    expect(result.current.aviso).toMatchObject({
      variante: 'destructive',
      texto: 'Segundo',
      cerrando: false,
    });
    expect(result.current.aviso?.id).not.toBe(primero?.id);
  });

  it(`a los ${DURACION_AVISO_MS} ms empieza a cerrarse solo, y quitar() lo saca`, () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result } = renderAviso();
    act(() => result.current.avisar('success', 'Hecho'));

    avanzarReloj(DURACION_AVISO_MS - 100);
    expect(result.current.aviso?.cerrando).toBe(false);
    avanzarReloj(100);
    expect(result.current.aviso?.cerrando).toBe(true);

    const id = result.current.aviso?.id ?? 0;
    act(() => result.current.quitar(id));
    expect(result.current.aviso).toBeNull();
  });

  it('un aviso nuevo trae su propia cuenta: la del anterior no lo cierra', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result } = renderAviso();
    act(() => result.current.avisar('success', 'Primero'));
    avanzarReloj(5_000);

    act(() => result.current.avisar('success', 'Segundo'));
    avanzarReloj(DURACION_AVISO_MS - 1_000);

    expect(result.current.aviso).toMatchObject({ texto: 'Segundo', cerrando: false });
    avanzarReloj(1_000);
    expect(result.current.aviso).toMatchObject({ texto: 'Segundo', cerrando: true });
  });

  it('cerrar() o quitar() de un aviso anterior no tocan al actual', () => {
    const { result } = renderAviso();
    act(() => result.current.avisar('success', 'Primero'));
    const viejo = result.current.aviso?.id ?? 0;
    act(() => result.current.avisar('success', 'Segundo'));

    act(() => result.current.cerrar(viejo));
    act(() => result.current.quitar(viejo));

    expect(result.current.aviso).toMatchObject({ texto: 'Segundo', cerrando: false });
  });

  it('si el foco no estaba en el aviso, cerrarlo no lo mueve', () => {
    const { result, titulo, avisoRef } = renderAviso();
    act(() => result.current.avisar('success', 'Hecho'));
    avisoRef.current = document.createElement('div');
    const otro = document.createElement('button');
    document.body.append(otro);
    otro.focus();

    act(() => result.current.cerrar(result.current.aviso?.id ?? 0));

    expect(otro).toHaveFocus();
    expect(titulo).not.toHaveFocus();
  });

  it('limpiar() lo quita de inmediato, sin animación', () => {
    const { result } = renderAviso();
    act(() => result.current.avisar('success', 'Hecho'));

    act(() => result.current.limpiar());

    expect(result.current.aviso).toBeNull();
  });

  it('si el foco estaba en el aviso al cerrarlo, pasa al destino y no se pierde', () => {
    const { result, titulo, avisoRef } = renderAviso();
    act(() => result.current.avisar('success', 'Hecho'));
    // Simula el aviso montado (la página le pasa la ref al `Alert`), con el foco en su X.
    const aviso = document.createElement('div');
    const cerrar = document.createElement('button');
    aviso.append(cerrar);
    document.body.append(aviso);
    avisoRef.current = aviso;
    cerrar.focus();

    act(() => result.current.cerrar(result.current.aviso?.id ?? 0));

    expect(titulo).toHaveFocus();
    expect(result.current.aviso?.cerrando).toBe(true);
  });
});
