import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import type * as DocumentosApi from '@/modules/documentos/api/documentos.api';
import { useAplicarDocumento } from '@/modules/documentos/hooks/useDocumentos';
import type * as RendicionesApi from '@/modules/rendiciones/api/rendiciones.api';
import { rendicionesKeys } from '@/modules/rendiciones/api/rendiciones.keys';
import {
  useAbrirRendicion,
  useAgregarRequisitoARendicion,
  useAnularRendicion,
} from '@/modules/rendiciones/hooks/useRendiciones';

// Lo que cambia la vigencia o el avance de una rendición refresca también la pantalla Rendiciones:
// el listado del mes y las atrasadas (la tarjeta Atrasadas). La API se simula: acá importa la caché.
vi.mock('@/modules/rendiciones/api/rendiciones.api', async (original) => ({
  ...(await original<typeof RendicionesApi>()),
  anularRendicion: vi.fn().mockResolvedValue(undefined),
  abrirRendicion: vi.fn().mockResolvedValue(undefined),
  agregarRequisitoARendicion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/modules/documentos/api/documentos.api', async (original) => ({
  ...(await original<typeof DocumentosApi>()),
  aplicarDocumento: vi.fn().mockResolvedValue(undefined),
}));

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OTRO_CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456700';
const RENDICION = 'e1f2a3b4-c5d6-4789-8abc-def012345678';

/** Una caché con datos en cada consulta, todas frescas. */
function cacheConDatos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = {
    mes: rendicionesKeys.delMes({ anio: 2026, mes: 11 }),
    otroMes: rendicionesKeys.delMes({ anio: 2026, mes: 10 }),
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
  return { keys, invalidada, wrapper };
}

describe('invalidarRendiciones', () => {
  it('anular una rendición invalida las atrasadas, el listado del mes y las del cliente', async () => {
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useAnularRendicion(), { wrapper });

    await act(() => result.current.mutateAsync({ clienteId: CLIENTE, rendicionId: RENDICION }));

    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.mes)).toBe(true);
    // Todos los meses: la anulada puede ser de cualquiera.
    expect(invalidada(keys.otroMes)).toBe(true);
    expect(invalidada(keys.lista)).toBe(true);
    expect(invalidada(keys.detalle)).toBe(true);
    // Las rendiciones de otro cliente no se tocan.
    expect(invalidada(keys.deOtroCliente)).toBe(false);
  });

  it('abrir una rendición también invalida el mes y las atrasadas', async () => {
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useAbrirRendicion(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE,
        datos: { anio: 2026, mes: 9, numeroFactura: 'B 00002-00001482' },
      }),
    );

    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.lista)).toBe(true);
  });

  it('agregar un requisito a una rendición invalida el mes y las atrasadas (cambia el avance)', async () => {
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useAgregarRequisitoARendicion(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE,
        rendicionId: RENDICION,
        requisitoId: 'c1d2e3f4-a5b6-4789-8abc-def012345678',
      }),
    );

    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.otroMes)).toBe(true);
    expect(invalidada(keys.detalle)).toBe(true);
    expect(invalidada(keys.deOtroCliente)).toBe(false);
  });

  it('aplicar un documento invalida el mes, las atrasadas y las de cada cliente involucrado', async () => {
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useAplicarDocumento(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        documentoId: 'd1e2f3a4-b5c6-4789-8abc-def012345678',
        itemIds: ['f1a2b3c4-d5e6-4789-8abc-def012345678'],
        clienteIds: [CLIENTE],
      }),
    );

    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.lista)).toBe(true);
    expect(invalidada(keys.detalle)).toBe(true);
    expect(invalidada(keys.deOtroCliente)).toBe(false);
  });
});
