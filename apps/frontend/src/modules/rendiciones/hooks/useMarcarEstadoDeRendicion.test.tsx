import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import * as api from '@/modules/rendiciones/api/rendiciones.api';
import type * as RendicionesApi from '@/modules/rendiciones/api/rendiciones.api';
import { rendicionesKeys } from '@/modules/rendiciones/api/rendiciones.keys';
import { useMarcarEstadoDeRendicion } from '@/modules/rendiciones/hooks/useRendiciones';

// Cambiar el estado (HU3.6): el detalle queda con lo que devolvió el servidor y se vuelve a pedir
// todo lo que muestra el estado: el listado del cliente, el del mes y las atrasadas. La API se
// simula: acá importa la caché y lo que se le pide.
vi.mock('@/modules/rendiciones/api/rendiciones.api', async (original) => ({
  ...(await original<typeof RendicionesApi>()),
  cambiarEstadoDeRendicion: vi.fn(),
}));

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OTRO_CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456700';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';
const DEVUELTA = { id: RENDICION, estado: 'COMPLETA' };

function cacheConDatos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = {
    mes: rendicionesKeys.delMes({ anio: 2026, mes: 11 }),
    atrasadas: rendicionesKeys.atrasadas,
    lista: rendicionesKeys.lista(CLIENTE, {}),
    detalle: rendicionesKeys.detalle(CLIENTE, RENDICION),
    deOtroCliente: rendicionesKeys.lista(OTRO_CLIENTE, {}),
  };
  for (const key of Object.values(keys)) queryClient.setQueryData(key, []);
  const invalidada = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated ?? false;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, keys, invalidada, wrapper };
}

const PEDIDO = {
  clienteId: CLIENTE,
  rendicionId: RENDICION,
  datos: { estado: 'COMPLETA' },
} as const;

beforeEach(() => {
  vi.mocked(api.cambiarEstadoDeRendicion).mockReset();
});

describe('useMarcarEstadoDeRendicion', () => {
  it('pide el cambio con el id de la rendición y el estado elegido', async () => {
    vi.mocked(api.cambiarEstadoDeRendicion).mockResolvedValue(DEVUELTA as never);
    const { wrapper } = cacheConDatos();
    const { result } = renderHook(() => useMarcarEstadoDeRendicion(), { wrapper });

    await act(() => result.current.mutateAsync(PEDIDO));

    expect(api.cambiarEstadoDeRendicion).toHaveBeenCalledWith(RENDICION, { estado: 'COMPLETA' });
  });

  it('si sale bien, deja el detalle con lo que devolvió el servidor e invalida el resto', async () => {
    vi.mocked(api.cambiarEstadoDeRendicion).mockResolvedValue(DEVUELTA as never);
    const { queryClient, keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useMarcarEstadoDeRendicion(), { wrapper });

    await act(() => result.current.mutateAsync(PEDIDO));

    expect(queryClient.getQueryData(keys.detalle)).toEqual(DEVUELTA);
    expect(invalidada(keys.lista)).toBe(true);
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.deOtroCliente)).toBe(false);
  });

  it('si falla, también vuelve a pedir las rendiciones del cliente y la pantalla Rendiciones', async () => {
    vi.mocked(api.cambiarEstadoDeRendicion).mockRejectedValue(new Error('409'));
    const { queryClient, keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useMarcarEstadoDeRendicion(), { wrapper });

    await act(() => result.current.mutateAsync(PEDIDO).catch(() => undefined));

    expect(queryClient.getQueryData(keys.detalle)).toEqual([]);
    expect(invalidada(keys.detalle)).toBe(true);
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.atrasadas)).toBe(true);
  });
});
