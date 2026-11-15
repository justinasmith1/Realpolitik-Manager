import { ClienteSchema, type Cliente } from '@realpolitik/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ContactosClienteSheet } from '@/modules/clientes/components/ContactosClienteSheet';
import { GestionarContactosSheet } from '@/modules/clientes/components/GestionarContactosSheet';

const fetchMock = vi.fn<typeof fetch>();

const cliente: Cliente = ClienteSchema.parse({
  id: '11111111-1111-4111-a111-111111111111',
  razonSocial: 'Municipalidad de Ejemplo',
  denominacion: 'Muni Ejemplo',
  cuit: '30-50001274-5',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
  ivaCondicion: 'EXENTO',
  emailContacto: 'muni@ejemplo.example',
  emailsAdicionales: [],
  canalEntrega: 'CORREO',
  periodicidad: null,
  estado: 'ACTIVO',
  matrizConfigurada: false,
  creadoEn: '2026-10-08T12:00:00.000Z',
  actualizadoEn: '2026-10-08T12:00:00.000Z',
});

const contactos = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    clienteId: cliente.id,
    nombre: 'Zoe Tesorera',
    area: 'Tesorería',
    email: 'zoe@ejemplo.example',
    recibeRendiciones: true,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    clienteId: cliente.id,
    nombre: 'Ana Compras',
    area: 'Compras',
    email: 'ana@ejemplo.example',
    recibeRendiciones: false,
  },
];

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const urlDe = (entrada: Parameters<typeof fetch>[0]) =>
  typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ContactosClienteSheet cliente={cliente} onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const panel = async () =>
  within(await screen.findByRole('dialog', { name: `Contactos de ${cliente.razonSocial}` }));

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('ContactosClienteSheet (solo lectura)', () => {
  it('pide los contactos de ese cliente y los muestra en el orden de la API', async () => {
    fetchMock.mockResolvedValue(json(contactos));
    renderPanel();
    const p = await panel();

    const items = await p.findAllByRole('listitem');
    expect(items.map((li) => within(li).getAllByText(/./)[0]?.textContent)).toEqual([
      'Zoe Tesorera',
      'Ana Compras',
    ]);
    expect(fetchMock.mock.calls.map(([e]) => urlDe(e))).toEqual([
      `https://api.example/clientes/${cliente.id}/contactos`,
    ]);
  });

  it('de cada contacto muestra nombre, área, email y si recibe rendiciones', async () => {
    fetchMock.mockResolvedValue(json(contactos));
    renderPanel();
    const p = await panel();

    const [zoe, ana] = await p.findAllByRole('listitem');
    if (zoe === undefined || ana === undefined) throw new Error('faltan contactos');
    const dato = (item: HTMLElement, etiqueta: string) =>
      within(item).getByText(etiqueta, { selector: 'dt' }).nextElementSibling;

    expect(within(zoe).getByText('Zoe Tesorera')).toBeVisible();
    expect(dato(zoe, 'Área')).toHaveTextContent('Tesorería');
    expect(dato(zoe, 'Email')).toHaveTextContent('zoe@ejemplo.example');
    expect(dato(zoe, 'Recibe rendiciones')).toHaveTextContent('Sí');
    expect(dato(ana, 'Recibe rendiciones')).toHaveTextContent('No');
  });

  it('sin contactos lo dice, sin invitar a agregar', async () => {
    fetchMock.mockResolvedValue(json([]));
    renderPanel();
    const p = await panel();

    expect(await p.findByText('Este cliente no tiene contactos registrados.')).toBeVisible();
    expect(p.queryByRole('button', { name: /Agregar/ })).not.toBeInTheDocument();
  });

  it('si falla la lectura lo dice y deja reintentar', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json(contactos));
    const { user } = renderPanel();
    const p = await panel();

    expect(await p.findByText('No pudimos cargar los contactos.')).toBeVisible();
    expect(p.queryByText('Este cliente no tiene contactos registrados.')).not.toBeInTheDocument();
    await user.click(p.getByRole('button', { name: 'Reintentar' }));

    expect(await p.findByText('Zoe Tesorera')).toBeVisible();
  });

  it('no tiene controles de edición: ni campos, ni casillas, ni más botón que Cerrar', async () => {
    fetchMock.mockResolvedValue(json(contactos));
    renderPanel();
    const p = await panel();
    await p.findByText('Zoe Tesorera');

    expect(p.queryByRole('textbox')).not.toBeInTheDocument();
    expect(p.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(p.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cerrar']);
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});

describe('GestionarContactosSheet (roles operativos)', () => {
  it('sigue siendo el editor: campos y "Guardar contactos"', async () => {
    fetchMock.mockResolvedValue(json(contactos));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GestionarContactosSheet
          cliente={cliente}
          onClose={() => undefined}
          onGuardado={() => undefined}
        />
      </QueryClientProvider>,
    );
    const p = await panel();

    expect((await p.findAllByRole('textbox')).length).toBeGreaterThan(0);
    expect(p.getByRole('button', { name: 'Guardar contactos' })).toBeInTheDocument();
  });
});
