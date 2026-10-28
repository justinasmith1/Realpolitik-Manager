import { IndicacionesArmadoSchema } from '@realpolitik/shared';

import { obtenerIndicacionesArmado } from '@/modules/clientes/api/indicaciones-armado.api';

// La lectura usa `IndicacionesArmadoLecturaSchema`: un registro viejo con un carácter de control
// que hoy la escritura rechaza (una tabulación) se sigue pudiendo ver.

const fetchMock = vi.fn<typeof fetch>();

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const CON_TAB = 'Factura\tprimero.\nTodo en un PDF.';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('obtenerIndicacionesArmado', () => {
  it('lee un texto guardado con una tabulación, tal cual', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ indicacionesArmado: CON_TAB }));

    await expect(obtenerIndicacionesArmado(CLIENTE)).resolves.toEqual({
      indicacionesArmado: CON_TAB,
    });
  });

  it('ese mismo texto no se puede guardar: la escritura sigue siendo estricta', () => {
    expect(IndicacionesArmadoSchema.safeParse({ indicacionesArmado: CON_TAB }).success).toBe(false);
  });
});
