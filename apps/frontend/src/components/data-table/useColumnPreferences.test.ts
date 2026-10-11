import { act, renderHook } from '@testing-library/react';

import type { ColumnPreferencesScope } from '@/components/data-table/columnPreferences';
import type { ColumnPreferencesStorage } from '@/components/data-table/columnPreferencesStorage';
import {
  useColumnPreferences,
  type UseColumnPreferencesOptions,
} from '@/components/data-table/useColumnPreferences';

type Columna = 'cuit' | 'sector' | 'email' | 'canal';

const disponibles: readonly Columna[] = ['cuit', 'sector', 'email', 'canal'];
const defaults: readonly Columna[] = ['cuit', 'sector', 'email'];

/** Storage en memoria: cualquier implementación de la interfaz sirve, no solo localStorage. */
function crearStorage(inicial: Record<string, readonly string[]> = {}) {
  const datos = new Map(Object.entries(inicial));
  const clave = ({ tableId, ownerKey }: ColumnPreferencesScope) => `${tableId}/${ownerKey}`;
  const storage = {
    load: vi.fn((scope: ColumnPreferencesScope) => datos.get(clave(scope)) ?? null),
    save: vi.fn((scope: ColumnPreferencesScope, ids: readonly string[]) => {
      datos.set(clave(scope), ids);
    }),
    remove: vi.fn((scope: ColumnPreferencesScope) => {
      datos.delete(clave(scope));
    }),
  } satisfies ColumnPreferencesStorage;
  return { storage, datos };
}

function renderPreferencias(
  storage: ColumnPreferencesStorage,
  opciones: Partial<UseColumnPreferencesOptions<Columna>> = {},
) {
  return renderHook(
    (props: Partial<UseColumnPreferencesOptions<Columna>>) =>
      useColumnPreferences({
        tableId: 'clientes',
        availableIds: disponibles,
        defaultIds: defaults,
        storage,
        ...props,
      }),
    { initialProps: opciones },
  );
}

describe('useColumnPreferences', () => {
  describe('estado inicial', () => {
    it('sin preferencia muestra los defaults y no está personalizada', () => {
      const { storage } = crearStorage();

      const { result } = renderPreferencias(storage);

      expect(result.current.visibleIds).toEqual(['cuit', 'sector', 'email']);
      expect(result.current.isCustomized).toBe(false);
    });

    it('montar sin preferencia no guarda los defaults', () => {
      const { storage, datos } = crearStorage();

      renderPreferencias(storage);

      expect(storage.save).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
      expect(datos.size).toBe(0);
    });

    it('lee la preferencia del dueño anónimo y respeta su orden', () => {
      const { storage } = crearStorage({ 'clientes/anonymous': ['canal', 'cuit'] });

      const { result } = renderPreferencias(storage);

      expect(storage.load).toHaveBeenCalledWith({ tableId: 'clientes', ownerKey: 'anonymous' });
      expect(result.current.visibleIds).toEqual(['canal', 'cuit']);
      expect(result.current.isCustomized).toBe(true);
    });

    it('una preferencia vacía se distingue de no haber personalizado', () => {
      const { storage } = crearStorage({ 'clientes/anonymous': [] });

      const { result } = renderPreferencias(storage);

      expect(result.current.visibleIds).toEqual([]);
      expect(result.current.isCustomized).toBe(true);
    });

    it('ignora ids desconocidos o repetidos sin reescribir lo guardado al montar', () => {
      const { storage } = crearStorage({
        'clientes/anonymous': ['email', 'quitada', 'cuit', 'email'],
      });

      const { result } = renderPreferencias(storage);

      expect(result.current.visibleIds).toEqual(['email', 'cuit']);
      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe('cambios', () => {
    it('setVisibleIds actualiza la selección y la guarda en el momento', () => {
      const { storage, datos } = crearStorage();
      const { result } = renderPreferencias(storage);

      act(() => result.current.setVisibleIds(['email', 'canal']));

      expect(result.current.visibleIds).toEqual(['email', 'canal']);
      expect(result.current.isCustomized).toBe(true);
      expect(storage.save).toHaveBeenCalledTimes(1);
      expect(datos.get('clientes/anonymous')).toEqual(['email', 'canal']);
    });

    it('guardar todas fuera queda como preferencia vacía', () => {
      const { storage, datos } = crearStorage();
      const { result } = renderPreferencias(storage);

      act(() => result.current.setVisibleIds([]));

      expect(result.current.visibleIds).toEqual([]);
      expect(result.current.isCustomized).toBe(true);
      expect(datos.get('clientes/anonymous')).toEqual([]);
    });

    it('elegir lo mismo que los defaults también es una personalización', () => {
      const { storage, datos } = crearStorage();
      const { result } = renderPreferencias(storage);

      act(() => result.current.setVisibleIds(['cuit', 'sector', 'email']));

      expect(result.current.isCustomized).toBe(true);
      expect(datos.get('clientes/anonymous')).toEqual(['cuit', 'sector', 'email']);
    });

    it('no guarda ids repetidos', () => {
      const { storage, datos } = crearStorage();
      const { result } = renderPreferencias(storage);

      act(() => result.current.setVisibleIds(['canal', 'cuit', 'canal']));

      expect(result.current.visibleIds).toEqual(['canal', 'cuit']);
      expect(datos.get('clientes/anonymous')).toEqual(['canal', 'cuit']);
    });

    it('la preferencia guardada se recupera al volver a montar', () => {
      const { storage } = crearStorage();
      const primera = renderPreferencias(storage);
      act(() => primera.result.current.setVisibleIds(['sector', 'cuit']));
      primera.unmount();

      const { result } = renderPreferencias(storage);

      expect(result.current.visibleIds).toEqual(['sector', 'cuit']);
    });
  });

  describe('reset', () => {
    it('borra la preferencia y vuelve a los defaults sin guardarlos', () => {
      const { storage, datos } = crearStorage({ 'clientes/anonymous': ['canal'] });
      const { result } = renderPreferencias(storage);

      act(() => result.current.reset());

      expect(result.current.visibleIds).toEqual(['cuit', 'sector', 'email']);
      expect(result.current.isCustomized).toBe(false);
      expect(storage.remove).toHaveBeenCalledWith({ tableId: 'clientes', ownerKey: 'anonymous' });
      expect(storage.save).not.toHaveBeenCalled();
      expect(datos.has('clientes/anonymous')).toBe(false);
    });

    it('después de un reset recibe los defaults vigentes, aunque hayan cambiado', () => {
      const { storage } = crearStorage({ 'clientes/anonymous': ['canal'] });
      const primera = renderPreferencias(storage);
      act(() => primera.result.current.reset());
      primera.unmount();

      const { result } = renderPreferencias(storage, { defaultIds: ['canal', 'email'] });

      expect(result.current.visibleIds).toEqual(['canal', 'email']);
      expect(result.current.isCustomized).toBe(false);
    });
  });

  describe('cambio de dueño o de tabla', () => {
    it('al cambiar el dueño lee la preferencia del nuevo y guarda en la suya', () => {
      const { storage, datos } = crearStorage({ 'clientes/usuario-a': ['canal'] });
      const { result, rerender } = renderPreferencias(storage, { ownerKey: 'usuario-a' });
      expect(result.current.visibleIds).toEqual(['canal']);

      rerender({ ownerKey: 'usuario-b' });

      expect(result.current.visibleIds).toEqual(['cuit', 'sector', 'email']);
      expect(result.current.isCustomized).toBe(false);

      act(() => result.current.setVisibleIds(['email']));

      expect(datos.get('clientes/usuario-b')).toEqual(['email']);
      expect(datos.get('clientes/usuario-a')).toEqual(['canal']);

      rerender({ ownerKey: 'usuario-a' });

      expect(result.current.visibleIds).toEqual(['canal']);
    });

    it('al cambiar la tabla lee la preferencia de esa tabla', () => {
      const { storage } = crearStorage({ 'clientes/anonymous': ['canal'], 'otra/anonymous': [] });
      const { result, rerender } = renderPreferencias(storage);

      rerender({ tableId: 'otra' });

      expect(result.current.visibleIds).toEqual([]);
      expect(result.current.isCustomized).toBe(true);
    });

    it('reset después de cambiar de dueño borra solo la del dueño actual', () => {
      const { storage, datos } = crearStorage({
        'clientes/usuario-a': ['canal'],
        'clientes/usuario-b': ['email'],
      });
      const { result, rerender } = renderPreferencias(storage, { ownerKey: 'usuario-a' });

      rerender({ ownerKey: 'usuario-b' });
      act(() => result.current.reset());

      expect(datos.has('clientes/usuario-b')).toBe(false);
      expect(datos.get('clientes/usuario-a')).toEqual(['canal']);
    });

    it('volver a renderizar con el mismo dueño y tabla no vuelve a leer', () => {
      const { storage } = crearStorage();
      const { rerender } = renderPreferencias(storage);

      rerender({});
      rerender({});

      expect(storage.load).toHaveBeenCalledTimes(1);
    });
  });

  describe('con localStorage (storage por defecto)', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('persiste entre montajes, como al cerrar y volver a abrir el navegador', () => {
      const primera = renderHook(() =>
        useColumnPreferences({
          tableId: 'clientes',
          availableIds: disponibles,
          defaultIds: defaults,
        }),
      );
      expect(window.localStorage).toHaveLength(0);

      act(() => primera.result.current.setVisibleIds(['email', 'cuit']));
      primera.unmount();

      expect(
        window.localStorage.getItem('realpolitik-manager:table-columns:v1:clientes:anonymous'),
      ).toBe('{"version":1,"ids":["email","cuit"]}');

      const segunda = renderHook(() =>
        useColumnPreferences({
          tableId: 'clientes',
          availableIds: disponibles,
          defaultIds: defaults,
        }),
      );

      expect(segunda.result.current.visibleIds).toEqual(['email', 'cuit']);

      act(() => segunda.result.current.reset());

      expect(window.localStorage).toHaveLength(0);
    });
  });
});
