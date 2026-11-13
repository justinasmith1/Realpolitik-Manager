import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import type * as DocumentosApi from '@/modules/documentos/api/documentos.api';
import { useAplicarDocumento } from '@/modules/documentos/hooks/useDocumentos';
import type * as RendicionesApi from '@/modules/rendiciones/api/rendiciones.api';
import * as api from '@/modules/rendiciones/api/rendiciones.api';
import { rendicionesKeys } from '@/modules/rendiciones/api/rendiciones.keys';
import {
  useAbrirRendicion,
  useAgregarRequisitoARendicion,
  useAnularRendicion,
  useQuitarCobro,
  useRegistrarCobro,
} from '@/modules/rendiciones/hooks/useRendiciones';

// Lo que cambia la vigencia o el avance de una rendición refresca también la pantalla Rendiciones:
// el listado del mes y las atrasadas (la tarjeta Atrasadas). La API se simula: acá importa la caché.
vi.mock('@/modules/rendiciones/api/rendiciones.api', async (original) => ({
  ...(await original<typeof RendicionesApi>()),
  anularRendicion: vi.fn().mockResolvedValue(undefined),
  abrirRendicion: vi.fn().mockResolvedValue(undefined),
  agregarRequisitoARendicion: vi.fn().mockResolvedValue(undefined),
  registrarCobro: vi.fn().mockResolvedValue(undefined),
  quitarCobro: vi.fn().mockResolvedValue(undefined),
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

// HU3.10: la marca "Cobrada" se ve en la pantalla Rendiciones y en el listado del cliente.
describe('invalidarRendiciones: el cobro (HU3.10)', () => {
  const detalleConCobro = { id: RENDICION, cobro: { fecha: '2026-11-10', nota: null } };

  it('registrar el cobro deja el detalle como lo devolvió el servidor e invalida el mes, las atrasadas y las del cliente', async () => {
    vi.mocked(api.registrarCobro).mockResolvedValueOnce(detalleConCobro as never);
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useRegistrarCobro(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        clienteId: CLIENTE,
        rendicionId: RENDICION,
        datos: { fecha: '2026-11-10', nota: null },
      }),
    );

    expect(api.registrarCobro).toHaveBeenCalledWith(RENDICION, { fecha: '2026-11-10', nota: null });
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.otroMes)).toBe(true);
    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.lista)).toBe(true);
    expect(invalidada(keys.detalle)).toBe(true);
    expect(invalidada(keys.deOtroCliente)).toBe(false);
  });

  it('quitar la marca invalida lo mismo', async () => {
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useQuitarCobro(), { wrapper });

    await act(() => result.current.mutateAsync({ clienteId: CLIENTE, rendicionId: RENDICION }));

    expect(api.quitarCobro).toHaveBeenCalledWith(RENDICION);
    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.atrasadas)).toBe(true);
    expect(invalidada(keys.lista)).toBe(true);
    expect(invalidada(keys.detalle)).toBe(true);
    expect(invalidada(keys.deOtroCliente)).toBe(false);
  });

  it('si el servidor rechaza el cobro (algo cambió), también se vuelve a pedir todo', async () => {
    vi.mocked(api.registrarCobro).mockRejectedValueOnce(new Error('409'));
    const { keys, invalidada, wrapper } = cacheConDatos();
    const { result } = renderHook(() => useRegistrarCobro(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({
          clienteId: CLIENTE,
          rendicionId: RENDICION,
          datos: { fecha: '2026-11-10', nota: null },
        })
        .catch(() => undefined);
    });

    expect(invalidada(keys.mes)).toBe(true);
    expect(invalidada(keys.detalle)).toBe(true);
  });

  it('no reintenta un cobro que falló', async () => {
    vi.mocked(api.registrarCobro).mockClear();
    vi.mocked(api.registrarCobro).mockRejectedValue(new Error('red'));
    const { wrapper } = cacheConDatos();
    const { result } = renderHook(() => useRegistrarCobro(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({
          clienteId: CLIENTE,
          rendicionId: RENDICION,
          datos: { fecha: '2026-11-10', nota: null },
        })
        .catch(() => undefined);
    });

    expect(api.registrarCobro).toHaveBeenCalledTimes(1);
    vi.mocked(api.registrarCobro)
      .mockReset()
      .mockResolvedValue(undefined as never);
  });
});
