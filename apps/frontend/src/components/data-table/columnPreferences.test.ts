import {
  reorderVisibleIds,
  resolveVisibleIds,
  sanitizeColumnIds,
  toggleVisibleId,
} from '@/components/data-table/columnPreferences';

const disponibles = ['a', 'b', 'c', 'd'] as const;
const defaults = ['a', 'b', 'c'] as const;

describe('resolveVisibleIds', () => {
  it('sin preferencia guardada usa los defaults', () => {
    expect(resolveVisibleIds(null, disponibles, defaults)).toEqual(['a', 'b', 'c']);
  });

  it('con una preferencia válida respeta su orden', () => {
    expect(resolveVisibleIds(['d', 'a', 'c'], disponibles, defaults)).toEqual(['d', 'a', 'c']);
  });

  it('una preferencia vacía es válida: no muestra columnas opcionales', () => {
    expect(resolveVisibleIds([], disponibles, defaults)).toEqual([]);
  });

  it('una preferencia igual a los defaults sigue siendo esa preferencia', () => {
    expect(resolveVisibleIds(['a', 'b', 'c'], disponibles, ['d'])).toEqual(['a', 'b', 'c']);
  });

  it('una columna nueva no aparece sola para quien ya personalizó', () => {
    const conNueva = [...disponibles, 'nueva'] as const;

    expect(resolveVisibleIds(['b'], conNueva, [...defaults, 'nueva'])).toEqual(['b']);
  });

  it('quien no personalizó recibe los defaults nuevos', () => {
    const conNueva = [...disponibles, 'nueva'] as const;

    expect(resolveVisibleIds(null, conNueva, ['nueva', 'a'])).toEqual(['nueva', 'a']);
  });

  it('si ningún id guardado existe queda vacía, no vuelve a los defaults', () => {
    expect(resolveVisibleIds(['x', 'y'], disponibles, defaults)).toEqual([]);
  });
});

describe('sanitizeColumnIds', () => {
  it('descarta los ids que la tabla no ofrece', () => {
    expect(sanitizeColumnIds(['a', 'quitada', 'c'], disponibles)).toEqual(['a', 'c']);
  });

  it('elimina duplicados conservando la primera aparición', () => {
    expect(sanitizeColumnIds(['c', 'a', 'c', 'b', 'a'], disponibles)).toEqual(['c', 'a', 'b']);
  });
});

describe('toggleVisibleId', () => {
  it('ocultar una columna conserva el orden relativo de las demás', () => {
    expect(toggleVisibleId(['c', 'a', 'd'], 'a')).toEqual(['c', 'd']);
  });

  it('mostrar una oculta la agrega al final, no en su posición "original"', () => {
    expect(toggleVisibleId(['b', 'd'], 'a')).toEqual(['b', 'd', 'a']);
  });

  it('ocultar la última deja la lista vacía y desde vacía se puede volver a mostrar', () => {
    expect(toggleVisibleId(['a'], 'a')).toEqual([]);
    expect(toggleVisibleId([], 'c')).toEqual(['c']);
  });
});

describe('reorderVisibleIds', () => {
  it('hacia abajo: la columna toma la posición de la otra y las del medio suben', () => {
    expect(reorderVisibleIds(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('hacia arriba: la columna toma la posición de la otra y las del medio bajan', () => {
    expect(reorderVisibleIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('entre vecinas las intercambia', () => {
    expect(reorderVisibleIds(['a', 'b', 'c'], 'b', 'c')).toEqual(['a', 'c', 'b']);
  });

  it.each([
    ['soltar sobre sí misma', 'b', 'b'],
    ['mover una que no está visible', 'x', 'b'],
    ['soltar sobre una que no está visible', 'b', 'x'],
  ])('%s no cambia el orden', (_caso, activa, destino) => {
    expect(reorderVisibleIds(['a', 'b', 'c'], activa, destino)).toEqual(['a', 'b', 'c']);
  });

  it('no modifica la lista recibida', () => {
    const visibles = ['a', 'b', 'c'] as const;

    reorderVisibleIds(visibles, 'a', 'c');

    expect(visibles).toEqual(['a', 'b', 'c']);
  });
});
