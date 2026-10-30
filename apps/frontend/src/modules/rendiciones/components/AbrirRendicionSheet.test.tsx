import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';

import { AbrirRendicionSheet } from '@/modules/rendiciones/components/AbrirRendicionSheet';
import {
  CLIENTE_ID,
  errorJson,
  HOY,
  itemJson,
  json,
  OTRA_ID,
  rendicionJson,
} from '@/modules/rendiciones/test/rendiciones.fixtures';
import { elegirOpcion } from '@/test/select';

// La pausa de éxito (500 ms) no es el tema de estos tests.
vi.mock('@/hooks/use-exito-breve', () => import('@/test/exito-breve-sin-espera'));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  // Solo la fecha: los temporizadores siguen reales para user-event.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderPanel({ conMatriz = true }: { conMatriz?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    onAbiertoChange: vi.fn(),
    onAbierta: vi.fn(),
    onVerRendicion: vi.fn(),
    onConfigurarMatriz: vi.fn(),
  };
  render(
    <QueryClientProvider client={queryClient}>
      <AbrirRendicionSheet
        abierto
        cliente={{ id: CLIENTE_ID, denominacion: 'Muni Ejemplo', emisor: 'SOCIEDAD' }}
        {...props}
        onConfigurarMatriz={conMatriz ? props.onConfigurarMatriz : undefined}
      />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), queryClient, ...props };
}

const campo = (etiqueta: string) => screen.getByLabelText(etiqueta);
const botonAbrir = () => screen.getByRole('button', { name: 'Abrir rendición' });

async function enviarFactura(user: UserEvent, factura = 'a 1-1') {
  await user.type(campo('Número de factura'), factura);
  await user.click(botonAbrir());
}

describe('AbrirRendicionSheet', () => {
  it('arranca en el mes actual, sin factura', () => {
    renderPanel();

    expect(campo('Mes')).toHaveTextContent('Octubre');
    expect(campo('Año')).toHaveTextContent('2026');
    expect(campo('Número de factura')).toHaveValue('');
  });

  it('ofrece los años de 2020 hasta el del mes siguiente, del más reciente al más viejo', async () => {
    const { user } = renderPanel();

    await user.click(campo('Año'));
    const opciones = within(await screen.findByRole('listbox')).getAllByRole('option');

    expect(opciones.map((opcion) => opcion.textContent)).toEqual([
      '2026',
      '2025',
      '2024',
      '2023',
      '2022',
      '2021',
      '2020',
    ]);
  });

  it('sin número de factura marca el campo y no envía nada', async () => {
    const { user } = renderPanel();

    await user.click(botonAbrir());

    expect(campo('Número de factura')).toHaveAccessibleDescription(
      expect.stringContaining('El número de factura es obligatorio.'),
    );
    expect(campo('Número de factura')).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muestra el formato esperado del número de factura como ayuda del campo', () => {
    renderPanel();

    expect(campo('Número de factura')).toHaveAccessibleDescription(
      expect.stringContaining('Formato: B 00002-00001482'),
    );
  });

  it('la ayuda del número aclara que no se repite para el mismo emisor, aunque sea de otro cliente', () => {
    renderPanel();

    expect(campo('Número de factura')).toHaveAccessibleDescription(
      expect.stringContaining('No puede repetirse para el mismo emisor'),
    );
  });

  it.each([
    ['sin letra', '00002-00001482'],
    ['con la letra D', 'D 00002-00001482'],
    ['con un punto de venta de 6 dígitos', 'B 000002-00001482'],
    ['con letras en el número', 'B 00002-0000148A'],
  ])(
    'un número %s se marca debajo del campo con el formato y no se envía',
    async (_caso, factura) => {
      const { user } = renderPanel();

      await enviarFactura(user, factura);

      expect(campo('Número de factura')).toHaveAccessibleDescription(
        expect.stringContaining(
          'El número de factura debe tener el formato letra (A, B o C), punto de venta de 5 dígitos y número de 8 dígitos, por ejemplo B 00002-00001482.',
        ),
      );
      expect(campo('Número de factura')).toHaveFocus();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('un período posterior al mes siguiente se marca en el mes y no se envía', async () => {
    const { user } = renderPanel();

    await elegirOpcion(user, campo('Mes'), '12');
    await enviarFactura(user);

    expect(campo('Mes')).toHaveAccessibleDescription(
      expect.stringContaining('El período no puede ser posterior al mes siguiente al actual.'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('al abrir envía el período y la factura normalizada, avisa e invalida el listado', async () => {
    const abierta = { ...rendicionJson(), items: [itemJson()] };
    fetchMock.mockResolvedValue(json(abierta, 201));
    const { user, queryClient, onAbierta } = renderPanel();
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');

    await elegirOpcion(user, campo('Mes'), '11');
    await enviarFactura(user, '  a 1-1 ');

    await waitFor(() => expect(onAbierta).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example/clientes/${CLIENTE_ID}/rendiciones`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      anio: 2026,
      mes: 11,
      numeroFactura: 'A 00001-00000001',
      emisor: 'SOCIEDAD',
    });
    expect(onAbierta).toHaveBeenCalledWith(expect.objectContaining({ id: abierta.id }));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['clientes', CLIENTE_ID, 'rendiciones'] });
  });

  it('409 RENDICION_DUPLICADA: dice dónde está la factura y ofrece ir a esa rendición', async () => {
    fetchMock.mockResolvedValue(
      errorJson(409, 'CONFLICT', {
        motivo: 'RENDICION_DUPLICADA',
        rendicionExistente: {
          id: OTRA_ID,
          clienteId: CLIENTE_ID,
          anio: 2026,
          mes: 9,
          numeroFactura: 'A 00001-00000001',
        },
      }),
    );
    const { user, onVerRendicion, onAbierta } = renderPanel();

    await enviarFactura(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya hay una rendición abierta con la factura A 00001-00000001 (Septiembre 2026) para este emisor.',
    );
    expect(campo('Número de factura')).toHaveAccessibleDescription(
      expect.stringContaining('Ese número de factura ya existe para este emisor.'),
    );
    await user.click(screen.getByRole('button', { name: 'Ver rendición' }));
    expect(onVerRendicion).toHaveBeenCalledWith({ rendicionId: OTRA_ID, clienteId: CLIENTE_ID });
    expect(onAbierta).not.toHaveBeenCalled();
  });

  it('409 CLIENTE_NO_ACTIVO: dice que el cliente no está activo', async () => {
    fetchMock.mockResolvedValue(
      errorJson(409, 'CONFLICT', { motivo: 'CLIENTE_NO_ACTIVO', estado: 'SUSPENDIDO' }),
    );
    const { user } = renderPanel();

    await enviarFactura(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El cliente está suspendido: reactivalo para abrir rendiciones.',
    );
  });

  it('409 MATRIZ_VACIA: lo dice y ofrece ir a configurar la matriz', async () => {
    fetchMock.mockResolvedValue(errorJson(409, 'CONFLICT', { motivo: 'MATRIZ_VACIA' }));
    const { user, onConfigurarMatriz } = renderPanel();

    await enviarFactura(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El cliente no tiene requisitos activos: agregá al menos uno antes de abrir una rendición.',
    );
    await user.click(screen.getByRole('button', { name: 'Agregar requisito' }));
    expect(onConfigurarMatriz).toHaveBeenCalledTimes(1);
  });

  it('409 MATRIZ_VACIA sin permiso para editar la matriz: no ofrece configurarla', async () => {
    fetchMock.mockResolvedValue(errorJson(409, 'CONFLICT', { motivo: 'MATRIZ_VACIA' }));
    const { user } = renderPanel({ conMatriz: false });

    await enviarFactura(user);

    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Agregar requisito' })).not.toBeInTheDocument();
  });

  it('ante un error del servidor avisa sin detalles técnicos y conserva los datos', async () => {
    fetchMock.mockResolvedValue(errorJson(500, 'INTERNAL_ERROR'));
    const { user } = renderPanel();

    await enviarFactura(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos abrir la rendición. Probá de nuevo en unos segundos.',
    );
    expect(campo('Número de factura')).toHaveValue('a 1-1');
  });
});
