import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';

import { RETARDO_BUSQUEDA_MS } from '@/modules/clientes/hooks/useFiltrosClientes';
import { useFiltrosRendicionesDelMes } from '@/modules/rendiciones/hooks/useFiltrosRendicionesDelMes';
import { useMesDeRendiciones } from '@/modules/rendiciones/hooks/useMesDeRendiciones';

// Filtros de la pantalla Rendiciones (HU3.3 y la vista de atrasadas de la HU3.4), guardados en la
// URL. Hoy: noviembre de 2026 en Buenos Aires.
const HOY = new Date('2026-11-15T12:00:00-03:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(HOY);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Los filtros y el mes, con la ubicación actual y `navigate` para ir atrás y adelante. */
function renderFiltros(entradas: string[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => ({
      filtros: useFiltrosRendicionesDelMes(),
      mes: useMesDeRendiciones(),
      location: useLocation(),
      navigate: useNavigate(),
    }),
    { wrapper },
  );
}

const parametros = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useFiltrosRendicionesDelMes', () => {
  describe('buscador', () => {
    it(`llega a la URL ${RETARDO_BUSQUEDA_MS} ms después de la última tecla, recortado`, () => {
      const { result } = renderFiltros(['/rendiciones']);

      act(() => result.current.filtros.cambiarTexto(' solano '));
      // El campo muestra lo escrito enseguida; la URL y el filtro, todavía no.
      expect(result.current.filtros.textoBusqueda).toBe(' solano ');
      act(() => {
        vi.advanceTimersByTime(RETARDO_BUSQUEDA_MS - 1);
      });
      expect(result.current.location.search).toBe('');
      expect(result.current.filtros.filtros.q).toBeUndefined();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.location.search).toBe('?q=solano');
      expect(result.current.filtros.filtros.q).toBe('solano');
    });

    it('una búsqueda nueva cancela la anterior: solo llega la última', () => {
      const { result } = renderFiltros(['/rendiciones']);

      act(() => result.current.filtros.cambiarTexto('sol'));
      act(() => {
        vi.advanceTimersByTime(RETARDO_BUSQUEDA_MS - 100);
      });
      act(() => result.current.filtros.cambiarTexto('solano'));
      act(() => {
        vi.advanceTimersByTime(RETARDO_BUSQUEDA_MS - 1);
      });
      // La primera ya habría llegado si no se hubiera cancelado.
      expect(result.current.location.search).toBe('');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.location.search).toBe('?q=solano');
    });

    it('borrar el texto quita el parámetro', () => {
      const { result } = renderFiltros(['/rendiciones?q=solano']);

      act(() => result.current.filtros.cambiarTexto('  '));
      act(() => {
        vi.advanceTimersByTime(RETARDO_BUSQUEDA_MS);
      });

      expect(result.current.location.search).toBe('');
    });

    it('la búsqueda llega con replace: no deja entradas en el historial', () => {
      const { result } = renderFiltros(['/rendiciones?anterior=1', '/rendiciones']);

      act(() => result.current.filtros.cambiarTexto('solano'));
      act(() => {
        vi.advanceTimersByTime(RETARDO_BUSQUEDA_MS);
      });
      act(() => {
        void result.current.navigate(-1);
      });

      expect(result.current.location.search).toBe('?anterior=1');
    });
  });

  describe('limpieza de la URL (con replace)', () => {
    it.each([
      ['un estado desconocido', '?estado=ATRASADA', ''],
      ['un tipo desconocido', '?tipo=OTRO', ''],
      ['una búsqueda vacía', '?q=%20%20', ''],
      ['un estado repetido', '?estado=ENVIADA&estado=COMPLETA&tipo=PRIVADO', '?tipo=PRIVADO'],
      ['un tipo repetido', '?tipo=PRIVADO&tipo=MUNICIPAL', ''],
      ['una vista desconocida', '?vista=otra', ''],
      [
        'un estado junto con la vista de atrasadas',
        '?vista=atrasadas&estado=ENVIADA',
        '?vista=atrasadas',
      ],
    ])('quita %s', (_caso, query, queda) => {
      const { result } = renderFiltros(['/rendiciones?anterior=1', `/rendiciones${query}`]);

      expect(result.current.location.search).toBe(queda);
      act(() => {
        void result.current.navigate(-1);
      });
      expect(result.current.location.search).toBe('?anterior=1');
    });

    it('en la vista de atrasadas el estado no aplica, aunque viniera en la URL', () => {
      const { result } = renderFiltros(['/rendiciones?vista=atrasadas&estado=ENVIADA']);

      expect(result.current.filtros.vistaAtrasadas).toBe(true);
      expect(result.current.filtros.filtros.estado).toBeUndefined();
    });

    it('los valores válidos quedan como están', () => {
      const { result } = renderFiltros(['/rendiciones?estado=ENVIADA&tipo=MUNICIPAL&q=solano']);

      expect(result.current.filtros.filtros).toEqual({
        estado: 'ENVIADA',
        tipo: 'MUNICIPAL',
        q: 'solano',
      });
      expect(result.current.location.search).toBe('?estado=ENVIADA&tipo=MUNICIPAL&q=solano');
    });
  });

  it('al cambiar de mes los filtros y la vista se mantienen', () => {
    const { result } = renderFiltros([
      '/rendiciones?anio=2026&mes=11&tipo=PRIVADO&q=solano&vista=atrasadas',
    ]);

    act(() => result.current.mes.elegir({ anio: 2026, mes: 10 }));

    expect(parametros(result.current.location.search)).toEqual({
      anio: '2026',
      mes: '10',
      tipo: 'PRIVADO',
      q: 'solano',
      vista: 'atrasadas',
    });
    expect(result.current.filtros.filtros).toEqual({
      estado: undefined,
      tipo: 'PRIVADO',
      q: 'solano',
    });
    expect(result.current.filtros.vistaAtrasadas).toBe(true);
  });

  describe('historial del navegador', () => {
    it('Atrás y Adelante restauran los filtros', () => {
      const { result } = renderFiltros(['/rendiciones']);

      act(() => result.current.filtros.elegirEstado('ENVIADA'));
      act(() => result.current.filtros.elegirTipo('PRIVADO'));
      expect(result.current.filtros.filtros).toMatchObject({ estado: 'ENVIADA', tipo: 'PRIVADO' });

      act(() => {
        void result.current.navigate(-1);
      });
      expect(result.current.filtros.filtros).toMatchObject({ estado: 'ENVIADA', tipo: undefined });

      act(() => {
        void result.current.navigate(-1);
      });
      expect(result.current.filtros.filtros).toMatchObject({ estado: undefined, tipo: undefined });

      act(() => {
        void result.current.navigate(2);
      });
      expect(result.current.filtros.filtros).toMatchObject({ estado: 'ENVIADA', tipo: 'PRIVADO' });
    });

    it('el campo del buscador acompaña a la URL al ir atrás y adelante', () => {
      const { result } = renderFiltros(['/rendiciones?q=solano']);

      act(() => result.current.filtros.limpiar());
      expect(result.current.filtros.textoBusqueda).toBe('');

      act(() => {
        void result.current.navigate(-1);
      });
      expect(result.current.filtros.textoBusqueda).toBe('solano');

      act(() => {
        void result.current.navigate(1);
      });
      expect(result.current.filtros.textoBusqueda).toBe('');
    });

    it('entrar y salir de la vista de atrasadas también se recorre con Atrás', () => {
      const { result } = renderFiltros(['/rendiciones?estado=ENVIADA']);

      act(() => result.current.filtros.alternarAtrasadas());
      expect(result.current.location.search).toBe('?vista=atrasadas');

      act(() => {
        void result.current.navigate(-1);
      });
      expect(result.current.filtros.vistaAtrasadas).toBe(false);
      expect(result.current.filtros.filtros.estado).toBe('ENVIADA');
    });
  });
});
