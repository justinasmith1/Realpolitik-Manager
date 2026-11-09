import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';

import { useMesDeRendiciones } from '@/modules/rendiciones/hooks/useMesDeRendiciones';

// El mes de la pantalla Rendiciones (HU3.2), guardado en la URL. Hoy: noviembre de 2026 en Buenos
// Aires.
const HOY = new Date('2026-11-15T12:00:00-03:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
});

afterEach(() => {
  vi.useRealTimers();
});

/** El hook, con la ubicación actual y `navigate` para ir atrás y adelante. */
function renderMes(entradas: string[], indice = entradas.length - 1) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={entradas} initialIndex={indice}>
      {children}
    </MemoryRouter>
  );
  return renderHook(
    () => ({ mes: useMesDeRendiciones(), location: useLocation(), navigate: useNavigate() }),
    { wrapper },
  );
}

describe('useMesDeRendiciones', () => {
  it('sin parámetros es el mes actual, sin escribirlo en la URL', () => {
    const { result } = renderMes(['/rendiciones']);

    expect(result.current.mes.periodo).toEqual({ anio: 2026, mes: 11 });
    expect(result.current.mes.anterior).toEqual({ anio: 2026, mes: 10 });
    expect(result.current.mes.siguiente).toEqual({ anio: 2026, mes: 12 });
    expect(result.current.location.search).toBe('');
  });

  it('avanza de diciembre a enero del año siguiente, y lo guarda en la URL', () => {
    const { result } = renderMes(['/rendiciones?anio=2026&mes=12']);

    expect(result.current.mes.siguiente).toEqual({ anio: 2027, mes: 1 });
    act(() => result.current.mes.elegir({ anio: 2027, mes: 1 }));

    expect(result.current.location.search).toBe('?anio=2027&mes=1');
    expect(result.current.mes.periodo).toEqual({ anio: 2027, mes: 1 });
  });

  it('retrocede de enero a diciembre del año anterior', () => {
    const { result } = renderMes(['/rendiciones?anio=2027&mes=1']);

    expect(result.current.mes.anterior).toEqual({ anio: 2026, mes: 12 });
    act(() => {
      const { anterior } = result.current.mes;
      if (anterior !== null) result.current.mes.elegir(anterior);
    });

    expect(result.current.location.search).toBe('?anio=2026&mes=12');
  });

  it('elegir un mes deja una entrada en el historial: Atrás vuelve al anterior', () => {
    const { result } = renderMes(['/rendiciones?anio=2026&mes=11']);

    act(() => result.current.mes.elegir({ anio: 2026, mes: 10 }));
    act(() => {
      void result.current.navigate(-1);
    });

    expect(result.current.mes.periodo).toEqual({ anio: 2026, mes: 11 });
  });

  it.each([
    ['enero de 2020: no hay anterior', '?anio=2020&mes=1', 'anterior'],
    ['diciembre de 2100: no hay siguiente', '?anio=2100&mes=12', 'siguiente'],
  ] as const)('límites del rango, %s', (_caso, query, borde) => {
    const { result } = renderMes([`/rendiciones${query}`]);

    expect(result.current.mes[borde]).toBeNull();
    expect(result.current.mes[borde === 'anterior' ? 'siguiente' : 'anterior']).not.toBeNull();
  });

  it.each([
    ['un mes 13', '?anio=2026&mes=13'],
    ['un año que no es número', '?anio=abc&mes=3'],
    ['un mes repetido', '?anio=2026&mes=3&mes=4'],
    ['solo el año', '?anio=2026'],
    ['solo el mes', '?mes=3'],
  ])('con %s vuelve al mes actual y quita los parámetros, con replace', (_caso, query) => {
    // Una entrada anterior en el historial: si la limpieza usara push, Atrás volvería a la inválida.
    const { result } = renderMes(['/rendiciones?anterior=1', `/rendiciones${query}&q=solano`]);

    expect(result.current.mes.periodo).toEqual({ anio: 2026, mes: 11 });
    // Se quitan solo el año y el mes: los demás parámetros quedan.
    expect(result.current.location.search).toBe('?q=solano');

    act(() => {
      void result.current.navigate(-1);
    });
    expect(result.current.location.search).toBe('?anterior=1');
  });

  it('elegir un mes no toca los demás parámetros (los filtros)', () => {
    const { result } = renderMes(['/rendiciones?estado=ENVIADA&q=solano']);

    act(() => result.current.mes.elegir({ anio: 2026, mes: 9 }));

    const params = new URLSearchParams(result.current.location.search);
    expect(Object.fromEntries(params)).toEqual({
      estado: 'ENVIADA',
      q: 'solano',
      anio: '2026',
      mes: '9',
    });
  });
});
