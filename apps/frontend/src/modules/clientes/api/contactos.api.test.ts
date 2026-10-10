import { ApiClientError } from '@/lib/http';
import { guardarContactos } from '@/modules/clientes/api/contactos.api';

const fetchMock = vi.fn<typeof fetch>();

const CLIENTE = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const ID_A = 'c1111111-1111-4111-a111-111111111111';

const contactoJson = {
  id: ID_A,
  clienteId: CLIENTE,
  nombre: 'Ana Pérez',
  area: 'Tesorería',
  email: 'ana@ejemplo.example',
  recibeRendiciones: true,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
};

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

describe('guardarContactos', () => {
  it('hace UN solo PUT /clientes/:id/contactos con { contactos } en JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse([contactoJson]));

    await guardarContactos(CLIENTE, [
      {
        id: ID_A,
        nombre: 'Ana Pérez',
        area: 'Tesorería',
        email: 'ana@ejemplo.example',
        recibeRendiciones: true,
      },
      {
        nombre: 'Nueva Persona',
        area: 'Compras',
        email: 'nueva@ejemplo.example',
        recibeRendiciones: false,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example/clientes/${CLIENTE}/contactos`);
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    // El contacto nuevo viaja sin `id`: es lo que lo distingue de uno existente.
    expect(JSON.parse(init?.body as string)).toStrictEqual({
      contactos: [
        {
          id: ID_A,
          nombre: 'Ana Pérez',
          area: 'Tesorería',
          email: 'ana@ejemplo.example',
          recibeRendiciones: true,
        },
        {
          nombre: 'Nueva Persona',
          area: 'Compras',
          email: 'nueva@ejemplo.example',
          recibeRendiciones: false,
        },
      ],
    });
  });

  it('una lista vacía se envía como { contactos: [] }', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    const guardados = await guardarContactos(CLIENTE, []);

    expect(guardados).toEqual([]);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toStrictEqual({
      contactos: [],
    });
  });

  it('devuelve la colección final validada con el schema compartido', async () => {
    fetchMock.mockResolvedValue(jsonResponse([contactoJson]));

    const guardados = await guardarContactos(CLIENTE, []);

    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ id: ID_A, nombre: 'Ana Pérez' });
    expect(guardados[0]?.creadoEn).toBeInstanceOf(Date);
  });

  it('rechaza con el ApiClientError de http() sin modificarlo', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'CONFLICT', message: 'x', details: { motivo: 'EMAIL_DUPLICADO' } } },
        409,
      ),
    );

    const error = await guardarContactos(CLIENTE, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ kind: 'http', status: 409 });
  });

  it('rechaza si la respuesta no cumple el contrato', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ ...contactoJson, email: 'no-es-email' }]));

    await expect(guardarContactos(CLIENTE, [])).rejects.toThrow();
  });
});
